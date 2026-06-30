# YOURFM — Product Requirements

## Problem statement
YOURFM is a personalized AI-DJ radio web app. As of June 2026 it streams **licensed music
via Feed.fm** (replacing the previous Spotify Web Playback integration). Users create named
stations, pick a Feed.fm station (genre/vibe), choose an AI DJ voice, and select bumper
topics. The AI DJ talks between songs.

## Why Feed.fm (vs Spotify)
- Spotify model streamed through each user's own Premium account → single-device limit,
  queue leaking into their Spotify, account hijacking. Inherent Spotify API limits.
- Feed.fm = B2B licensed/indemnified catalog, hosted + streamed directly (no user account).
  Operates under non-interactive (DMCA radio) rules.

## Licensing constraints (important product limits)
- Stations are provider-defined. Demo creds expose 'Station One' (33714093) + 'Station Two'.
  Production = Feed.fm curates stations to spec (genre/mood/artist-radio), more of them.
- Users CANNOT build free on-demand artist stations (that needs full interactive label deals).
- DMCA: no pre-announcing the upcoming song; bumpers mention only the just-played track.
- Skips are limited by radio rules (Feed.fm may reject /skip).

## Current flow
Landing ("Start Listening") → My Stations → Create Station (name + Feed.fm station + DJ voice
+ optional bumper topics) → Player (HTML5 audio, one track at a time, AI bumper every 3 songs).

## Architecture
- Frontend: React (CRA) + Tailwind. Player uses HTML5 <audio>, decorative canvas visualizer.
  App.js creates a Feed.fm session on mount and keeps <Player> persistently mounted.
- Backend: FastAPI + MongoDB (motor). All routes `/api`.
- Integrations: Feed.fm (licensed music, demo creds), Google Gemini via EMERGENT_LLM_KEY
  (gemini-2.5-flash) for bumper scripts, ElevenLabs TTS, WeatherAPI, SeatGeek.

## Key endpoints
- POST /api/feedfm/session → client_id
- GET  /api/feedfm/stations?client_id= → available stations
- POST /api/feedfm/play?client_id=&station_id= → one track (audio_file.url, track, artist, art)
- POST /api/feedfm/play/{play_id}/{start|complete|skip} → report playback events
- POST /api/bumpers/generate → Gemini script + ElevenLabs audio (current track only)
- CRUD /api/stations, GET /api/elevenlabs/voices, /api/weather, /api/concerts/{artist}

## DB (radio_app_db)
- stations: {id, name, genres[], artists[], bumper_topics[], voice_id, voice_name,
             feedfm_station_id, feedfm_station_name, user_id}
- spotify_tokens: legacy, unused by current flow.

## Implemented (2026-06)
- Switched playback from Spotify SDK to Feed.fm licensed radio (demo creds). Verified E2E.
- New StationCreator (Feed.fm station picker + voice + topics; artist search removed).
- New HTML5-audio Player with play/skip, event reporting, AI bumper.
- DJ behaviour (iteration_8, verified): bumper fires on a RANDOMIZED 3-4 count where both
  completed songs AND skips increment one shared counter; music DUCKS (fade 1.0->0.12->1.0)
  while the DJ talks over the next track instead of going silent.
- Restored browser geolocation in the Player -> user_location passed to /api/bumpers/generate
  for local-weather/concert mentions (falls back to IP-based weather if denied). Added the
  'concert tours' bumper topic. Weather appears in ~25% of bumpers by design.
- Landing page recopy ("licensed radio, no account needed").

## Voice quality (2026-06, iteration_12 verified)
- TTS model upgraded eleven_turbo_v2_5 -> eleven_multilingual_v2 (richer, more natural).
- Voice picker now shows a curated 12 premade ElevenLabs DJ voices grouped by vibe
  (Top 40, Chill Lofi, Rock / Metal, Accents) via CURATED_DJ_VOICES; cloned/pro voices removed.
- New "DJ Delivery Style" presets energetic/smooth/announcer (VOICE_STYLE_PRESETS -> VoiceSettings),
  saved on the station (voice_style) and sent to /api/bumpers/generate.

## Known minor items (from code review, not blocking)
- Reactive visualizer now sits BEHIND the album art on the now-playing screen (canvas 520x300,
  z-index 1 vs art z-index 10), driven by the Web Audio AnalyserNode (crossOrigin audio +
  Feed.fm CDN CORS). Visualizer useEffect uses [loading] deps so it mounts after the spinner.
- audioCtxRef is never closed on unmount (Player stays mounted; low risk).
- fadeVolume setInterval not cleared on unmount.
- Voice <select> placeholder allows submit before ElevenLabs voices load (~1-2s) -> validation toast.
- StationCreate.feedfm_station_id is Optional but product-required (add server validation).

## Backlog / remaining (P1/P2)
- P1: Obtain Feed.fm PRODUCTION token/secret → real curated catalog/stations (env-swappable).
- P2: Remove dead Spotify code (spotipy, /spotify/* routes, spotify_tokens) now that flow is Feed.fm.
- P2: Refactor server.py (1158 lines) into routers (stations.py, feedfm.py, bumpers.py).
- P2: Server-side validation requiring feedfm_station_id on new stations.
- P2: Clean bumper <audio> onended/onerror handlers on unmount (minor leak).
