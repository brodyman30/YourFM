"""Backend tests for curated DJ voices + voice_style on bumpers/generate."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    # Read from frontend/.env
    env_path = '/app/frontend/.env'
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    BASE_URL = line.split('=', 1)[1].strip().rstrip('/')

EXPECTED_VIBES = {"Top 40", "Chill Lofi", "Rock / Metal", "Accents"}
CURATED_IDS = {
    "TX3LPaxmHKxFdv7VOQHJ", "IKne3meq5aSn9XLyUdCD", "FGY2WhTYpPnrIDTdsKH5",
    "bIHbv24MWmeRgasZH58o", "SAz9YHcvj6GT2YYXdXww", "EXAVITQu4vr4xnSDxMaL",
    "pNInz6obpgDQGcFmaJgB", "nPczCjzI2devNBz1zQrb", "N2lVS1w4EtoT3dr4eOWO",
    "JBFqnCBsd6RMkjVDRZzb", "onwK4e9ZLuTAKqWW03F9", "pFZP5JQG7iQjIQuC4Bku",
}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestCuratedVoices:
    def test_voices_endpoint_returns_12_curated(self, client):
        r = client.get(f"{BASE_URL}/api/elevenlabs/voices", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "voices" in data
        voices = data["voices"]
        assert len(voices) == 12, f"Expected exactly 12 voices, got {len(voices)}"
        ids = set()
        vibes = set()
        for v in voices:
            assert "voice_id" in v and v["voice_id"]
            assert "name" in v and v["name"]
            assert "description" in v
            assert "vibe" in v
            assert v["vibe"] in EXPECTED_VIBES, f"Unexpected vibe: {v['vibe']}"
            ids.add(v["voice_id"])
            vibes.add(v["vibe"])
        assert ids == CURATED_IDS, f"ID mismatch. Missing: {CURATED_IDS - ids}, Extra: {ids - CURATED_IDS}"
        assert vibes == EXPECTED_VIBES, f"Vibe groups missing: {EXPECTED_VIBES - vibes}"


class TestBumperGenerateVoiceStyles:
    """Validate /api/bumpers/generate works with each voice_style preset."""

    def _payload(self, voice_id, voice_style=None):
        p = {
            "station_id": "TEST_voice_style_station",
            "topics": ["music trivia"],
            "genres": ["Rock"],
            "artists": [],
            "voice_id": voice_id,
            "current_track_name": "Test Song",
            "current_track_artist": "Test Artist",
            "next_track_name": "Next Song",
            "next_track_artist": "Next Artist",
        }
        if voice_style is not None:
            p["voice_style"] = voice_style
        return p

    @pytest.mark.parametrize("style", ["energetic", "smooth", "announcer"])
    def test_bumper_generate_with_style(self, client, style):
        payload = self._payload("pNInz6obpgDQGcFmaJgB", style)
        r = client.post(f"{BASE_URL}/api/bumpers/generate", json=payload, timeout=60)
        assert r.status_code == 200, f"style={style} -> {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "text" in data and data["text"], "Missing bumper text"
        assert "audio_url" in data
        assert data["audio_url"].startswith("data:audio/mpeg;base64,"), data["audio_url"][:80]
        assert len(data["audio_url"]) > 200, "audio_url base64 looks too short"

    def test_bumper_generate_default_style(self, client):
        """voice_style omitted should default to 'energetic'."""
        payload = self._payload("pNInz6obpgDQGcFmaJgB")
        assert "voice_style" not in payload
        r = client.post(f"{BASE_URL}/api/bumpers/generate", json=payload, timeout=60)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data.get("audio_url", "").startswith("data:audio/mpeg;base64,")


class TestStationVoiceStylePersistence:
    """Create a station with voice_style, verify GET returns it."""

    created_id = None

    def test_create_station_with_voice_style(self, client):
        payload = {
            "name": "TEST_voice_style_station",
            "genres": ["Rock"],
            "artists": [],
            "bumper_topics": ["music trivia"],
            "voice_id": "N2lVS1w4EtoT3dr4eOWO",
            "voice_name": "Callum — Gritty Husky",
            "voice_style": "smooth",
            "feedfm_station_id": "test_station",
            "feedfm_station_name": "Test Feed Station",
        }
        r = client.post(f"{BASE_URL}/api/stations", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["voice_style"] == "smooth"
        assert data["voice_id"] == "N2lVS1w4EtoT3dr4eOWO"
        assert data["voice_name"] == "Callum — Gritty Husky"
        TestStationVoiceStylePersistence.created_id = data["id"]

    def test_get_stations_includes_voice_style(self, client):
        sid = TestStationVoiceStylePersistence.created_id
        assert sid, "Previous create test must run first"
        r = client.get(f"{BASE_URL}/api/stations", timeout=15)
        assert r.status_code == 200
        stations = r.json()
        found = next((s for s in stations if s["id"] == sid), None)
        assert found, "Created station not in list"
        assert found["voice_style"] == "smooth"
        assert found["voice_id"] == "N2lVS1w4EtoT3dr4eOWO"

    def test_update_station_voice_style(self, client):
        sid = TestStationVoiceStylePersistence.created_id
        assert sid
        payload = {
            "name": "TEST_voice_style_station",
            "genres": ["Rock"],
            "artists": [],
            "bumper_topics": ["music trivia"],
            "voice_id": "JBFqnCBsd6RMkjVDRZzb",
            "voice_name": "George — British Storyteller",
            "voice_style": "announcer",
            "feedfm_station_id": "test_station",
            "feedfm_station_name": "Test Feed Station",
        }
        r = client.put(f"{BASE_URL}/api/stations/{sid}", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        # Verify persisted
        r2 = client.get(f"{BASE_URL}/api/stations/{sid}", timeout=15)
        assert r2.status_code == 200
        data = r2.json()
        assert data["voice_style"] == "announcer"
        assert data["voice_id"] == "JBFqnCBsd6RMkjVDRZzb"

    def test_cleanup_delete_station(self, client):
        sid = TestStationVoiceStylePersistence.created_id
        if sid:
            r = client.delete(f"{BASE_URL}/api/stations/{sid}", timeout=15)
            assert r.status_code in (200, 204)
