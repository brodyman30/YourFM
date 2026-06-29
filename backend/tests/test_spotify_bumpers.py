"""
Backend tests for YOURFM:
- /api/spotify/token (auto-refresh)
- /api/spotify/tracks (genre adherence, no 429, performance)
- /api/elevenlabs/voices
- /api/bumpers/generate (with current/next track references)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://audio-lab-build.preview.emergentagent.com').rstrip('/')

# ---- Fixtures ----

@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def spotify_token(api_client):
    r = api_client.get(f"{BASE_URL}/api/spotify/token", timeout=30)
    if r.status_code != 200:
        pytest.skip(f"Spotify not authenticated: {r.status_code} {r.text}")
    return r.json().get("access_token")


# ---- Spotify token tests ----

class TestSpotifyToken:
    def test_token_endpoint_returns_200_with_access_token(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/spotify/token", timeout=30)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "access_token" in data
        assert isinstance(data["access_token"], str)
        assert len(data["access_token"]) > 20, "access_token looks too short"

    def test_token_is_valid_against_spotify_api(self, api_client, spotify_token):
        # Hit spotify directly to verify the access token actually works
        r = requests.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {spotify_token}"},
            timeout=15,
        )
        # 200 means token is valid. 403 means token valid but user not in scope (still fine).
        assert r.status_code in (200, 403), f"Spotify rejected token: {r.status_code} {r.text}"


# ---- Spotify tracks: genre adherence, performance, no 429 ----

CLASSIC_ROCK_ARTISTS = {
    "guns n' roses", "guns n roses", "led zeppelin", "aerosmith",
    "bon jovi", "def leppard", "motley crue", "mötley crüe",
    "ac/dc", "kiss", "van halen", "the rolling stones", "queen",
    "skid row", "whitesnake", "poison", "ratt", "warrant", "europe",
}

METAL_INDICATORS = {
    "metal", "core", "hardcore", "djent", "deathcore", "screamo",
    "metalcore", "death", "post-hardcore",
}


class TestSpotifyTracks:
    """Discovery with strict genre adherence and no rate limit hangs."""

    def _metal_payload(self):
        return {
            "genres": ["metal"],
            "artists": [
                {"id": "3Ri4H12KFyu98LMjSoij5V", "name": "Bad Omens"},
                {"id": "4MzJMcHQBl9SIYSjwWn8QW", "name": "Spiritbox"},
            ],
        }

    def test_metalcore_station_returns_30plus_tracks_quickly(self, api_client, spotify_token):
        payload = self._metal_payload()
        start = time.time()
        r = api_client.post(f"{BASE_URL}/api/spotify/tracks", json=payload, timeout=30)
        elapsed = time.time() - start
        assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
        data = r.json()
        tracks = data.get("tracks", [])
        assert len(tracks) >= 30, f"Expected 30+ tracks, got {len(tracks)}"
        # ~6s budget per spec; allow some headroom but flag if > 10s
        assert elapsed < 15, f"Discovery too slow ({elapsed:.1f}s) – suggests 429 retry/hang"
        print(f"metal discovery: {len(tracks)} tracks in {elapsed:.2f}s")

    def test_metalcore_station_blocks_classic_rock(self, api_client, spotify_token):
        payload = self._metal_payload()
        r = api_client.post(f"{BASE_URL}/api/spotify/tracks", json=payload, timeout=30)
        assert r.status_code == 200
        tracks = r.json().get("tracks", [])
        offending = []
        for t in tracks:
            artist = (t.get("artist") or "").lower()
            if artist in CLASSIC_ROCK_ARTISTS:
                offending.append(f"{t.get('name')} - {t.get('artist')}")
        assert not offending, f"Classic-rock acts leaked into metalcore station: {offending}"

    def test_metalcore_station_has_metal_flavoured_results(self, api_client, spotify_token):
        """At least a meaningful chunk of results should look metal/-core flavoured.
        Note: we cannot fetch artist genres for every track here without rate-limiting ourselves,
        so this is a sanity check on selected artists actually appearing among results."""
        payload = self._metal_payload()
        r = api_client.post(f"{BASE_URL}/api/spotify/tracks", json=payload, timeout=30)
        tracks = r.json().get("tracks", [])
        selected_names = {a["name"].lower() for a in payload["artists"]}
        selected_hits = sum(1 for t in tracks if (t.get("artist") or "").lower() in selected_names)
        assert selected_hits >= 1, "Selected artists missing from playlist"

    def test_hiphop_station_excludes_metal(self, api_client, spotify_token):
        payload = {"genres": ["hip-hop"], "artists": []}
        r = api_client.post(f"{BASE_URL}/api/spotify/tracks", json=payload, timeout=30)
        assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
        tracks = r.json().get("tracks", [])
        # With no selected artists, discovery should still return *something*; spec doesn't force a min
        # but assert no obvious metal contamination.
        bad = [t for t in tracks if any(ind in (t.get("artist") or "").lower() for ind in ["metallica", "slipknot", "lamb of god"])]
        assert not bad, f"Metal acts leaked into hip-hop station: {[t['artist'] for t in bad]}"
        print(f"hip-hop discovery: {len(tracks)} tracks")

    def test_pop_station_excludes_metal(self, api_client, spotify_token):
        payload = {"genres": ["pop"], "artists": []}
        r = api_client.post(f"{BASE_URL}/api/spotify/tracks", json=payload, timeout=30)
        assert r.status_code == 200
        tracks = r.json().get("tracks", [])
        bad = [t for t in tracks if any(ind in (t.get("artist") or "").lower() for ind in ["metallica", "slipknot", "bad omens", "spiritbox"])]
        assert not bad, f"Metal artists leaked into pop station: {[t['artist'] for t in bad]}"
        print(f"pop discovery: {len(tracks)} tracks")

    def test_repeated_calls_no_429(self, api_client, spotify_token):
        """Hit the discovery endpoint 3 times in a row; none should 429 or hang."""
        payload = self._metal_payload()
        timings = []
        for i in range(3):
            start = time.time()
            r = api_client.post(f"{BASE_URL}/api/spotify/tracks", json=payload, timeout=30)
            elapsed = time.time() - start
            timings.append(elapsed)
            assert r.status_code == 200, f"Call #{i+1} failed: {r.status_code} {r.text}"
            data = r.json()
            assert "tracks" in data
            # If any call takes excessively long it suggests Spotify 429 retry-after backoff
            assert elapsed < 20, f"Call #{i+1} took {elapsed:.1f}s – possible 429 retry hang"
        print(f"3x discovery timings: {[f'{t:.2f}s' for t in timings]}")


# ---- ElevenLabs + Bumper generation ----

class TestBumpers:
    @pytest.fixture(scope="class")
    def voice_id(self):
        r = requests.get(f"{BASE_URL}/api/elevenlabs/voices", timeout=30)
        assert r.status_code == 200, f"voices endpoint failed: {r.status_code} {r.text}"
        body = r.json()
        voices = body.get("voices", [])
        if not voices:
            pytest.skip(f"No custom ElevenLabs voices available – {body.get('message','')}")
        return voices[0]["voice_id"]

    def test_voices_endpoint_returns_200(self):
        r = requests.get(f"{BASE_URL}/api/elevenlabs/voices", timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        body = r.json()
        assert "voices" in body
        assert isinstance(body["voices"], list)

    def test_bumper_generate_references_tracks(self, voice_id):
        payload = {
            "station_id": "test",
            "topics": ["fun facts"],
            "genres": ["metal"],
            "artists": [{"id": "3Ri4H12KFyu98LMjSoij5V", "name": "Bad Omens"}],
            "voice_id": voice_id,
            "current_track_name": "Limits",
            "current_track_artist": "Bad Omens",
            "next_track_name": "The Void",
            "next_track_artist": "Spiritbox",
        }
        r = requests.post(f"{BASE_URL}/api/bumpers/generate", json=payload, timeout=90)
        assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
        data = r.json()
        assert "text" in data and isinstance(data["text"], str) and len(data["text"]) > 0
        assert "audio_url" in data and data["audio_url"].startswith("data:audio/mpeg;base64,")
        # Should reference at least one of the tracks/artists
        text_lower = data["text"].lower()
        referenced = any(kw in text_lower for kw in [
            "bad omens", "limits", "spiritbox", "the void",
        ])
        assert referenced, f"Bumper text doesn't reference current/next track: {data['text']}"
        print(f"Bumper text: {data['text']}")
