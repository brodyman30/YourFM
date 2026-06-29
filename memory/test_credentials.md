# Test Credentials — YOURFM

## App auth
- No custom username/password login. Auth is via Spotify OAuth.
- A Spotify token (access + refresh) is stored in MongoDB `radio_app_db.spotify_tokens`
  under user_id "default_user". The backend now AUTO-REFRESHES the access token when expired,
  so backend Spotify endpoints work as long as a valid refresh_token exists in the DB.

## Spotify Developer App
- SPOTIFY_CLIENT_ID / SECRET are in backend/.env.
- Redirect URI must be registered in the user's Spotify Developer Dashboard and must equal
  backend/.env SPOTIFY_REDIRECT_URI (= <REACT_APP_BACKEND_URL>/api/spotify/callback).
  This changes each fork → user must re-register it to perform a fresh OAuth login.

## 3rd-party keys (in backend/.env)
- EMERGENT_LLM_KEY (Gemini bumper scripts), ELEVEN_API_KEY, WEATHER_API_KEY, SEATGEEK_CLIENT_ID.

## Notes for testing
- Full bumper playback verification requires a Spotify PREMIUM account (Web Playback SDK).
- Backend track-discovery + bumper-generate endpoints are testable via curl using the
  stored/refreshed token (no user interaction needed).
