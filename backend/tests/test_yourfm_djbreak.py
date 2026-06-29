"""Iteration 8 - YOURFM DJ break / ducking / weather / concert tours coverage.

Validates the bumper backend supports:
- user_location (lat,lon) for concerts
- 'local weather' topic returning city + temp_f (via /api/weather)
- 'concert tours' topic
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://audio-lab-build.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

s = requests.Session()
s.headers.update({"Content-Type": "application/json"})


def _voice_id():
    r = s.get(f"{API}/elevenlabs/voices", timeout=30)
    assert r.status_code == 200, r.text
    voices = r.json().get("voices", [])
    assert voices, "no voices"
    return voices[0]["voice_id"]


class TestWeather:
    def test_weather_auto_ip(self):
        r = s.get(f"{API}/weather", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("city"), f"no city in {data}"
        assert isinstance(data.get("temp_f"), (int, float)), f"no temp_f in {data}"

    def test_weather_with_coords(self):
        r = s.get(f"{API}/weather", params={"location": "34.0522,-118.2437"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("city"), f"no city in {data}"
        # LA region check - city should be string
        assert isinstance(data["city"], str)


class TestBumperWithLocation:
    def test_bumper_local_weather_topic(self):
        """Even though weather is rate-limited to 25%, the endpoint must accept the topic
        and produce a non-empty bumper with audio."""
        payload = {
            "station_id": "test-station",
            "topics": ["local weather"],
            "genres": ["Station One"],
            "artists": [],
            "voice_id": _voice_id(),
            "current_track_name": "Aguacate",
            "current_track_artist": "Eddie Roberts",
            "user_location": "34.0522,-118.2437",
        }
        r = s.post(f"{API}/bumpers/generate", json=payload, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("text") and len(data["text"]) > 5
        assert data.get("audio_url", "").startswith("data:audio/mpeg;base64,")

    def test_bumper_concert_tours_topic(self):
        payload = {
            "station_id": "test-station",
            "topics": ["concert tours"],
            "genres": ["Station One"],
            "artists": [],
            "voice_id": _voice_id(),
            "current_track_name": "Aguacate",
            "current_track_artist": "Eddie Roberts",
            "user_location": "34.0522,-118.2437",
        }
        r = s.post(f"{API}/bumpers/generate", json=payload, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("text") and len(data["text"]) > 5
        assert data.get("audio_url", "").startswith("data:audio/mpeg;base64,")

    def test_bumper_combined_topics(self):
        payload = {
            "station_id": "test-station",
            "topics": ["local weather", "music trivia", "concert tours"],
            "genres": ["Station One"],
            "artists": [],
            "voice_id": _voice_id(),
            "current_track_name": "Aguacate",
            "current_track_artist": "Eddie Roberts",
            "user_location": "34.0522,-118.2437",
        }
        r = s.post(f"{API}/bumpers/generate", json=payload, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("text") and len(data["text"]) > 5

    def test_bumper_no_location_fallback(self):
        """When user_location is omitted backend should still succeed (auto:ip fallback)."""
        payload = {
            "station_id": "test-station",
            "topics": ["local weather"],
            "genres": ["Station One"],
            "artists": [],
            "voice_id": _voice_id(),
            "current_track_name": "Aguacate",
            "current_track_artist": "Eddie Roberts",
        }
        r = s.post(f"{API}/bumpers/generate", json=payload, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("text") and len(data["text"]) > 5
