# Test Credentials — YOURFM

## App auth
- No login. The new Feed.fm flow needs no user account.
- A Feed.fm listener session (client_id) is created server-side on app load.

## Feed.fm
- backend/.env: FEED_FM_TOKEN=demo, FEED_FM_SECRET=demo (development demo credentials).
  Demo placement exposes 2 stations: 'Station One' (33714093), 'Station Two' (33714094).
- For production, replace FEED_FM_TOKEN/FEED_FM_SECRET in backend/.env with Feed.fm-issued keys.

## 3rd-party keys (backend/.env)
- EMERGENT_LLM_KEY (Gemini bumper scripts), ELEVEN_API_KEY (DJ voices), WEATHER_API_KEY, SEATGEEK_CLIENT_ID.

## Notes
- Audio is not audible in headless automation; verify via <audio> src + /api/feedfm/* 200s.
- Legacy: db.spotify_tokens + /api/spotify/* still exist but are unused by the current flow.
