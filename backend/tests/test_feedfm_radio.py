"""Backend tests for the YOURFM Feed.fm pivot.

Covers:
- /api/feedfm/session, /api/feedfm/stations, /api/feedfm/play, /api/feedfm/play/<id>/<action>
- /api/elevenlabs/voices
- /api/stations CRUD with feedfm_station_id
- /api/bumpers/generate (Gemini + ElevenLabs)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://audio-lab-build.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

session = requests.Session()
session.headers.update({"Content-Type": "application/json"})


# ----- Feed.fm proxy -----
class TestFeedFm:
    def test_create_session(self):
        r = session.post(f"{API}/feedfm/session", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("client_id"), str) and len(data["client_id"]) > 0

    def test_list_stations(self):
        cid = session.post(f"{API}/feedfm/session", timeout=30).json()["client_id"]
        r = session.get(f"{API}/feedfm/stations", params={"client_id": cid}, timeout=30)
        assert r.status_code == 200, r.text
        stations = r.json().get("stations", [])
        assert isinstance(stations, list) and len(stations) > 0
        # demo placement should expose Station One / Station Two
        names = [s.get("name") for s in stations]
        assert any("Station" in (n or "") for n in names)
        # cache for next tests
        pytest.feedfm_stations = stations
        pytest.feedfm_client_id = cid

    def test_play_track_and_events(self):
        cid = getattr(pytest, 'feedfm_client_id', None) or session.post(f"{API}/feedfm/session", timeout=30).json()["client_id"]
        stations = getattr(pytest, 'feedfm_stations', None)
        if not stations:
            stations = session.get(f"{API}/feedfm/stations", params={"client_id": cid}, timeout=30).json().get("stations", [])
        sid = str(stations[0]["id"])

        r = session.post(f"{API}/feedfm/play", params={"client_id": cid, "station_id": sid}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # If geofenced -> success:false. Report rather than hard-fail.
        if body.get("success") is False:
            pytest.skip(f"Feed.fm returned success:false (likely geofence): {body}")
        play = body.get("play") or {}
        assert play.get("id"), f"no play.id in response: {body}"
        af = play.get("audio_file") or {}
        assert af.get("url", "").startswith("http"), f"no audio URL: {af}"

        play_id = play["id"]
        # start event
        rs = session.post(f"{API}/feedfm/play/{play_id}/start", params={"client_id": cid}, timeout=30)
        assert rs.status_code == 200, rs.text
        # skip event (should return JSON, may be success:true or false)
        rsk = session.post(f"{API}/feedfm/play/{play_id}/skip", params={"client_id": cid}, timeout=30)
        assert rsk.status_code == 200, rsk.text

    def test_invalid_action(self):
        cid = session.post(f"{API}/feedfm/session", timeout=30).json()["client_id"]
        r = session.post(f"{API}/feedfm/play/fake-id/garbage", params={"client_id": cid}, timeout=30)
        assert r.status_code == 400


# ----- ElevenLabs voices -----
class TestVoices:
    def test_list_voices(self):
        r = session.get(f"{API}/elevenlabs/voices", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "voices" in data
        # store first voice for later
        if data["voices"]:
            pytest.voice_id = data["voices"][0]["voice_id"]
            pytest.voice_name = data["voices"][0]["name"]


# ----- Station CRUD with Feed.fm mapping -----
class TestStationsCRUD:
    created_id = None

    def test_create_station_with_feedfm(self):
        # prep dependencies
        cid = session.post(f"{API}/feedfm/session", timeout=30).json()["client_id"]
        feed = session.get(f"{API}/feedfm/stations", params={"client_id": cid}, timeout=30).json().get("stations", [])
        assert feed, "no feed.fm stations available"
        voice_id = getattr(pytest, 'voice_id', None)
        voice_name = getattr(pytest, 'voice_name', None)
        if not voice_id:
            vr = session.get(f"{API}/elevenlabs/voices", timeout=30).json().get("voices", [])
            assert vr, "no ElevenLabs voices available"
            voice_id = vr[0]["voice_id"]; voice_name = vr[0]["name"]

        payload = {
            "name": f"TEST_Station_{int(time.time())}",
            "genres": [feed[0]["name"]],
            "artists": [],
            "bumper_topics": ["music trivia"],
            "voice_id": voice_id,
            "voice_name": voice_name,
            "feedfm_station_id": str(feed[0]["id"]),
            "feedfm_station_name": feed[0]["name"],
        }
        r = session.post(f"{API}/stations", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data["feedfm_station_id"] == payload["feedfm_station_id"]
        assert data["feedfm_station_name"] == payload["feedfm_station_name"]
        assert data["voice_id"] == voice_id
        assert "id" in data
        TestStationsCRUD.created_id = data["id"]
        pytest.test_station = data

    def test_get_stations_lists_created(self):
        assert TestStationsCRUD.created_id, "create test must run first"
        r = session.get(f"{API}/stations", timeout=30)
        assert r.status_code == 200, r.text
        ids = [s["id"] for s in r.json()]
        assert TestStationsCRUD.created_id in ids

    def test_delete_station(self):
        if not TestStationsCRUD.created_id:
            pytest.skip("nothing to delete")
        r = session.delete(f"{API}/stations/{TestStationsCRUD.created_id}", timeout=30)
        assert r.status_code == 200
        # verify gone
        rg = session.get(f"{API}/stations/{TestStationsCRUD.created_id}", timeout=30)
        assert rg.status_code == 404


# ----- Bumper generation (AI + voice) -----
class TestBumper:
    def test_generate_bumper(self):
        voice_id = getattr(pytest, 'voice_id', None)
        if not voice_id:
            vr = session.get(f"{API}/elevenlabs/voices", timeout=30).json().get("voices", [])
            if not vr:
                pytest.skip("no voices available")
            voice_id = vr[0]["voice_id"]
        payload = {
            "station_id": "test-station",
            "topics": ["music trivia"],
            "genres": ["Station One"],
            "artists": [],
            "voice_id": voice_id,
            "current_track_name": "Aguacate",
            "current_track_artist": "Eddie Roberts",
        }
        r = session.post(f"{API}/bumpers/generate", json=payload, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("text") and len(data["text"]) > 5
        assert data.get("audio_url", "").startswith("data:audio/mpeg;base64,")
