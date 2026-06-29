# YOURFM — Product Requirements

## Problem statement
YOURFM is a personalized radio web app: AI-powered DJ bumpers, smart playlists, and
professional audio mixing on top of Spotify. Core experience: pick genres + artists +
a DJ voice, then YOURFM streams a station with periodic AI DJ bumpers.

## Core requirements
- Generate playlists mixing ~80% discovery artists and ~20% selected artists.
- Strict genre adherence (a metalcore station must NOT play Guns N' Roses).
- AI DJ bumpers accurately read the track just played and the track coming up next.
- Bumpers may include real-time weather (WeatherAPI) and concerts (SeatGeek) by geolocation.
- Cohesive branding: custom PNG logo, yellow/golden accent (#FBBF24).

## Architecture
- Frontend: React + TailwindCSS (CRA), react-spotify-web-playback SDK, canvas visualizer.
- Backend: FastAPI + MongoDB (motor). All routes prefixed `/api`.
- Integrations: Spotify Web API & Playback SDK (user OAuth), Google Gemini via EMERGENT_LLM_KEY
  (gemini-2.0-flash) for bumper scripts, ElevenLabs TTS, WeatherAPI, SeatGeek.

## Key endpoints
- GET  /api/spotify/auth, /api/spotify/callback — OAuth flow
- GET  /api/spotify/token — returns access token (now AUTO-REFRESHES if expired)
- POST /api/spotify/tracks — discovery (80/20, strict genre filter, BATCHED artist lookups)
- POST /api/bumpers/generate — Gemini script + ElevenLabs voice
- GET  /api/elevenlabs/voices, /api/weather, /api/concerts/{artist}

## DB (radio_app_db)
- stations: {id, name, genres[], artists[{id,name}], bumper_topics[], voice_id, voice_name, user_id}
- spotify_tokens: {user_id, access_token, refresh_token, expires_at}
- bumpers: {id, station_id, text, audio_base64, voice_id}

## Implemented (2026-06)
- Spotify token auto-refresh (`get_valid_access_token` / `get_spotify_client`) — fixes the
  "expired token → can't see preview" lockout; uses stored refresh_token.
- Track discovery rate-limit fix: replaced per-track `sp.artist()` (N+1, ~150 calls → 429s)
  with batched `sp.artists()` (≤5 search + ~2-3 batch calls). ~2s response.
- Strict genre adherence: target genre profile derived from selected artists' real genres;
  discovery filtered by phrase-overlap; `-core` stations block classic/glam/hard rock
  (GNR no longer leaks onto metalcore stations). Verified via curl.
- Bumper accuracy: announcement now derived from Spotify's REAL playback state
  (justFinished + current_track) instead of local array index that could drift.

## Backlog / remaining
- P1: Spotify "Invalid redirect URI" — user must register the current preview callback URL
  in their Spotify Developer Dashboard (URI changes each fork). Permanent fix = custom domain.
- P2: Refactor bloated server.py (>1000 lines) into route modules.
- P2: Bumper live-playback verification needs a Spotify Premium account (manual).
