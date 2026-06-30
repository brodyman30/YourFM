"""Backend tests for 8 NEW Voice-Design DJ voices + voice_style on bumpers/generate (eleven_v3)."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    env_path = '/app/frontend/.env'
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    BASE_URL = line.split('=', 1)[1].strip().rstrip('/')

EXPECTED_VIBES = {"Top 40", "Chill Lofi", "Rock / Metal", "Accents"}
EXPECTED_VOICES = {
    "SFLy8KPQaTeMd5DxmOmd": ("Jaxon", "Top 40"),
    "9c8VzCq2zlhwrVFJPt3U": ("Mia", "Top 40"),
    "QRzSOQsyy2H3xOQE8rk5": ("Cole", "Chill Lofi"),
    "sVPIwFSChJOLXAqHYZTd": ("Luna", "Chill Lofi"),
    "Gvq68LFb6sMUY4Frjqzn": ("Axl", "Rock / Metal"),
    "oY2xTzmanHYCTs8SiucR": ("Reaper", "Rock / Metal"),
    "kF2ieC6SVxxWPBvElzuh": ("Oliver", "Accents"),
    "k6zqzLWJ0yII6gu0peMn": ("Kai", "Accents"),
}
OLD_VOICE_NAMES = {"adam", "rachel", "liam", "callum", "george", "will", "antoni", "josh", "dorothy", "elli", "bella", "domi"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestCurated8NewVoices:
    def test_voices_endpoint_returns_exactly_8(self, client):
        r = client.get(f"{BASE_URL}/api/elevenlabs/voices", timeout=15)
        assert r.status_code == 200, r.text
        voices = r.json().get("voices", [])
        assert len(voices) == 8, f"Expected exactly 8 new voices, got {len(voices)}"

    def test_voice_ids_match_new_voice_design_set(self, client):
        voices = client.get(f"{BASE_URL}/api/elevenlabs/voices", timeout=15).json()["voices"]
        ids = {v["voice_id"] for v in voices}
        assert ids == set(EXPECTED_VOICES.keys()), \
            f"ID mismatch. Missing: {set(EXPECTED_VOICES.keys()) - ids}, Extra: {ids - set(EXPECTED_VOICES.keys())}"

    def test_each_voice_has_name_description_vibe(self, client):
        voices = client.get(f"{BASE_URL}/api/elevenlabs/voices", timeout=15).json()["voices"]
        for v in voices:
            assert v.get("voice_id") and v.get("name") and v.get("description") and v.get("vibe")
            assert v["vibe"] in EXPECTED_VIBES
            expected_first_name, expected_vibe = EXPECTED_VOICES[v["voice_id"]]
            assert v["name"].lower().startswith(expected_first_name.lower()), \
                f"voice_id {v['voice_id']} name '{v['name']}' should start with '{expected_first_name}'"
            assert v["vibe"] == expected_vibe, f"{v['name']} expected vibe {expected_vibe} got {v['vibe']}"

    def test_no_old_stock_voice_names_present(self, client):
        voices = client.get(f"{BASE_URL}/api/elevenlabs/voices", timeout=15).json()["voices"]
        for v in voices:
            lower = v["name"].lower()
            for old in OLD_VOICE_NAMES:
                assert old not in lower, f"Old voice name '{old}' found in '{v['name']}'"

    def test_all_4_vibe_groups_present(self, client):
        voices = client.get(f"{BASE_URL}/api/elevenlabs/voices", timeout=15).json()["voices"]
        vibes = {v["vibe"] for v in voices}
        assert vibes == EXPECTED_VIBES


class TestBumperGenerateV3:
    """POST /api/bumpers/generate using new voice_ids + each style with eleven_v3 model."""

    def _payload(self, voice_id, voice_style=None):
        p = {
            "station_id": "TEST_v3_station",
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
    def test_bumper_each_style_with_jaxon(self, client, style):
        """Use Jaxon (Top 40) as the canonical voice; verify each style returns 200 with audio."""
        r = client.post(f"{BASE_URL}/api/bumpers/generate",
                        json=self._payload("SFLy8KPQaTeMd5DxmOmd", style), timeout=120)
        assert r.status_code == 200, f"style={style} -> {r.status_code}: {r.text[:400]}"
        data = r.json()
        assert data.get("text"), "Missing bumper text"
        assert data.get("audio_url", "").startswith("data:audio/mpeg;base64,"), data.get("audio_url", "")[:80]
        assert len(data["audio_url"]) > 1000, "audio_url base64 looks too short"

    @pytest.mark.parametrize("voice_id", list(EXPECTED_VOICES.keys()))
    def test_each_new_voice_can_generate_bumper(self, client, voice_id):
        """Smoke each of the 8 new voice_ids through eleven_v3 with energetic style."""
        r = client.post(f"{BASE_URL}/api/bumpers/generate",
                        json=self._payload(voice_id, "energetic"), timeout=120)
        assert r.status_code == 200, \
            f"voice_id {voice_id} ({EXPECTED_VOICES[voice_id][0]}) failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert data.get("audio_url", "").startswith("data:audio/mpeg;base64,")
        assert len(data["audio_url"]) > 1000


class TestStationPersistenceWithNewVoice:
    created_id = None

    def test_create_station_with_new_voice(self, client):
        payload = {
            "name": "TEST_v3_station",
            "genres": ["Rock"],
            "artists": [],
            "bumper_topics": ["music trivia"],
            "voice_id": "Gvq68LFb6sMUY4Frjqzn",
            "voice_name": "Axl — Rock Gravel",
            "voice_style": "smooth",
            "feedfm_station_id": "test_station",
            "feedfm_station_name": "Test Feed Station",
        }
        r = client.post(f"{BASE_URL}/api/stations", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["voice_id"] == "Gvq68LFb6sMUY4Frjqzn"
        assert data["voice_style"] == "smooth"
        TestStationPersistenceWithNewVoice.created_id = data["id"]

    def test_cleanup(self, client):
        sid = TestStationPersistenceWithNewVoice.created_id
        if sid:
            client.delete(f"{BASE_URL}/api/stations/{sid}", timeout=15)
