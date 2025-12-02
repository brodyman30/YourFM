from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import base64
from emergentintegrations.llm.chat import LlmChat, UserMessage
from elevenlabs import ElevenLabs
import io
import aiohttp

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Spotify OAuth Setup
SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID', '')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET', '')
SPOTIFY_REDIRECT_URI = os.getenv('SPOTIFY_REDIRECT_URI')
SPOTIFY_SCOPE = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state'

# ElevenLabs Client
ELEVEN_API_KEY = os.getenv('ELEVEN_API_KEY', '')
eleven_client = ElevenLabs(api_key=ELEVEN_API_KEY) if ELEVEN_API_KEY else None

# Gemini Client
EMERGENT_LLM_KEY = os.getenv('EMERGENT_LLM_KEY')

# Bandsintown API (for concert data)
BANDSINTOWN_APP_ID = os.getenv('BANDSINTOWN_APP_ID', 'yourfm_radio_app')

# WeatherAPI (for weather data)
WEATHER_API_KEY = os.getenv('WEATHER_API_KEY', '')

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Helper function to prepare data for MongoDB
def prepare_for_mongo(data: dict) -> dict:
    """Convert datetime objects to ISO strings for MongoDB storage"""
    result = {}
    for key, value in data.items():
        if isinstance(value, datetime):
            result[key] = value.isoformat()
        else:
            result[key] = value
    return result

# Helper function to fetch weather data
async def get_weather(location: str = "auto:ip") -> dict:
    """Fetch current weather from WeatherAPI.com
    location can be: city name, zip, IP address, or 'auto:ip' for auto-detect"""
    if not WEATHER_API_KEY:
        return {}
    
    try:
        url = "http://api.weatherapi.com/v1/current.json"
        params = {
            "key": WEATHER_API_KEY,
            "q": location,
            "aqi": "no"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=5)) as response:
                if response.status == 200:
                    data = await response.json()
                    location_data = data.get('location', {})
                    current = data.get('current', {})
                    condition = current.get('condition', {})
                    
                    return {
                        "city": location_data.get('name', ''),
                        "region": location_data.get('region', ''),
                        "country": location_data.get('country', ''),
                        "temp_f": current.get('temp_f', 0),
                        "temp_c": current.get('temp_c', 0),
                        "condition": condition.get('text', ''),
                        "humidity": current.get('humidity', 0),
                        "wind_mph": current.get('wind_mph', 0),
                        "feelslike_f": current.get('feelslike_f', 0)
                    }
                else:
                    logging.error(f"Weather API error: {response.status}")
                    return {}
    except Exception as e:
        logging.error(f"Error fetching weather: {str(e)}")
        return {}

# Helper function to fetch concert data from Bandsintown
async def get_artist_concerts(artist_name: str, limit: int = 3) -> List[dict]:
    """Fetch upcoming concerts for an artist from Bandsintown API"""
    try:
        # URL encode the artist name
        import urllib.parse
        encoded_name = urllib.parse.quote(artist_name)
        
        url = f"https://rest.bandsintown.com/artists/{encoded_name}/events"
        params = {
            "app_id": BANDSINTOWN_APP_ID,
            "date": "upcoming"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=5)) as response:
                if response.status == 200:
                    events = await response.json()
                    
                    if isinstance(events, list) and len(events) > 0:
                        concerts = []
                        for event in events[:limit]:
                            venue = event.get('venue', {})
                            concerts.append({
                                "date": event.get('datetime', ''),
                                "venue": venue.get('name', 'Unknown Venue'),
                                "city": venue.get('city', ''),
                                "region": venue.get('region', ''),
                                "country": venue.get('country', ''),
                                "url": event.get('url', '')
                            })
                        return concerts
                    
                logging.info(f"No concerts found for {artist_name}")
                return []
    except Exception as e:
        logging.error(f"Error fetching concerts for {artist_name}: {str(e)}")
        return []

# Models
class Artist(BaseModel):
    id: str
    name: str

class Station(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    genres: List[str]  # Changed to list for multiple genres
    artists: List[Artist]
    bumper_topics: List[str]
    voice_id: str
    voice_name: str
    user_id: str = "default_user"  # For demo purposes
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Backward compatibility
    genre: Optional[str] = None

class StationCreate(BaseModel):
    name: str
    genres: List[str]  # Changed to list
    artists: List[Artist]
    bumper_topics: List[str]
    voice_id: str
    voice_name: str

class Bumper(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    station_id: str
    text: str
    audio_base64: str
    voice_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BumperRequest(BaseModel):
    station_id: str
    topics: List[str]
    genres: List[str]  # Changed to list
    artists: List[Artist]
    voice_id: str
    current_track_name: Optional[str] = None
    current_track_artist: Optional[str] = None
    next_track_name: Optional[str] = None
    next_track_artist: Optional[str] = None
    user_location: Optional[str] = None  # For weather - city name or "auto:ip"

class VoiceInfo(BaseModel):
    voice_id: str
    name: str
    description: Optional[str] = None

# Weather API Route
@api_router.get("/weather")
async def get_current_weather(location: str = Query(default="auto:ip")):
    """Get current weather for a location"""
    weather = await get_weather(location)
    if weather:
        return weather
    raise HTTPException(status_code=404, detail="Could not fetch weather data")

# Spotify OAuth Routes
@api_router.get("/spotify/auth")
async def spotify_auth():
    """Redirect to Spotify authorization page"""
    if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Spotify credentials not configured")
    
    sp_oauth = SpotifyOAuth(
        client_id=SPOTIFY_CLIENT_ID,
        client_secret=SPOTIFY_CLIENT_SECRET,
        redirect_uri=SPOTIFY_REDIRECT_URI,
        scope=SPOTIFY_SCOPE
    )
    auth_url = sp_oauth.get_authorize_url()
    return {"auth_url": auth_url}

@api_router.get("/spotify/callback")
async def spotify_callback(code: str):
    """Handle Spotify OAuth callback"""
    if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Spotify credentials not configured")
    
    sp_oauth = SpotifyOAuth(
        client_id=SPOTIFY_CLIENT_ID,
        client_secret=SPOTIFY_CLIENT_SECRET,
        redirect_uri=SPOTIFY_REDIRECT_URI,
        scope=SPOTIFY_SCOPE
    )
    token_info = sp_oauth.get_access_token(code)
    
    # Store token in database (simplified for demo)
    await db.spotify_tokens.delete_many({"user_id": "default_user"})
    await db.spotify_tokens.insert_one({
        "user_id": "default_user",
        "access_token": token_info['access_token'],
        "refresh_token": token_info['refresh_token'],
        "expires_at": token_info['expires_at']
    })
    
    # Redirect to frontend - use the correct frontend URL
    frontend_url = os.getenv('FRONTEND_URL', 'https://custom-fm-station.preview.emergentagent.com')
    return RedirectResponse(url=f"{frontend_url}/?spotify_auth=success")

@api_router.get("/spotify/token")
async def get_spotify_token():
    """Get current Spotify access token"""
    token_doc = await db.spotify_tokens.find_one({"user_id": "default_user"}, {"_id": 0})
    
    if not token_doc:
        raise HTTPException(status_code=404, detail="No token found. Please authenticate with Spotify.")
    
    return {"access_token": token_doc['access_token']}

@api_router.get("/spotify/genres")
async def get_spotify_genres():
    """Get available Spotify genres"""
    # Return common genres
    genres = [
        "pop", "rock", "hip-hop", "jazz", "classical", "electronic",
        "country", "r-n-b", "indie", "metal", "folk", "blues",
        "reggae", "latin", "alternative", "dance", "soul", "funk"
    ]
    return {"genres": genres}

@api_router.post("/spotify/search/artists")
async def search_artists(query: str = Query(...), genre: str = Query(None)):
    """Search for artists by name (genre optional)"""
    token_doc = await db.spotify_tokens.find_one({"user_id": "default_user"})
    
    if not token_doc:
        raise HTTPException(status_code=401, detail="Not authenticated with Spotify")
    
    sp = spotipy.Spotify(auth=token_doc['access_token'])
    
    # Search for artists with optional genre filter
    search_query = f"{query} genre:{genre}" if genre else query
    results = sp.search(q=search_query, type='artist', limit=20)
    
    artists = []
    for item in results['artists']['items']:
        artists.append({
            "id": item['id'],
            "name": item['name'],
            "image": item['images'][0]['url'] if item['images'] else None,
            "genres": item['genres']
        })
    
    return {"artists": artists}

@api_router.get("/spotify/artists/by-genre")
async def get_artists_by_genre(genres: str = Query(...)):
    """Get popular artists for given genres"""
    token_doc = await db.spotify_tokens.find_one({"user_id": "default_user"})
    
    if not token_doc:
        raise HTTPException(status_code=401, detail="Not authenticated with Spotify")
    
    sp = spotipy.Spotify(auth=token_doc['access_token'])
    
    genre_list = genres.split(',')
    all_artists = []
    seen_ids = set()
    
    # Search for popular tracks in each genre to find top artists
    for genre in genre_list[:3]:  # Limit to 3 genres
        try:
            # Search for popular tracks in this genre
            results = sp.search(q=f"genre:{genre}", type='track', limit=10)
            
            for track in results['tracks']['items']:
                for artist in track['artists']:
                    if artist['id'] not in seen_ids:
                        seen_ids.add(artist['id'])
                        # Get full artist info
                        try:
                            artist_info = sp.artist(artist['id'])
                            # Only include if they match the genre
                            if any(g.lower() in genre.lower() or genre.lower() in g.lower() for g in artist_info['genres']):
                                all_artists.append({
                                    "id": artist_info['id'],
                                    "name": artist_info['name'],
                                    "image": artist_info['images'][0]['url'] if artist_info['images'] else None,
                                    "genres": artist_info['genres'],
                                    "popularity": artist_info['popularity']
                                })
                        except Exception:
                            continue
        except Exception as e:
            logging.error(f"Error fetching artists for genre {genre}: {str(e)}")
            continue
    
    # Sort by popularity and return top 12
    all_artists.sort(key=lambda x: x.get('popularity', 0), reverse=True)
    
    return {"artists": all_artists[:12]}

@api_router.get("/track-analysis")
async def get_track_analysis(song: str, artist: str = ""):
    """Get audio analysis from SoundStat.info"""
    import aiohttp
    
    # SoundStat API key
    soundstat_key = "Rjuofl_E5tkz-l-LuVUqKmTaxP6dNCJOBE1VPapbAF8"
    
    try:
        async with aiohttp.ClientSession() as session:
            # Step 1: Search for the track
            search_url = "https://soundstat.info/api/v1/tracks/search"
            search_data = {
                "artist": artist,
                "track": song,
                "limit": 1
            }
            headers = {
                "X-API-Key": soundstat_key,
                "accept": "application/json",
                "Content-Type": "application/json"
            }
            
            async with session.post(search_url, json=search_data, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as search_response:
                if search_response.status == 200:
                    search_data = await search_response.json()
                    track_ids = search_data.get('track_ids', [])
                    
                    if track_ids:
                        # Step 2: Get track analysis
                        track_id = track_ids[0]
                        track_url = f"https://soundstat.info/api/v1/track/{track_id}"
                        
                        async with session.get(track_url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as track_response:
                            if track_response.status == 200:
                                track_data = await track_response.json()
                                # Extract relevant fields
                                return {
                                    "tempo": track_data.get('tempo', {}).get('value', 120),
                                    "energy": int(track_data.get('energy', {}).get('value', 60) * 100),
                                    "danceability": int(track_data.get('danceability', {}).get('value', 60) * 100)
                                }
                            else:
                                logging.error(f"SoundStat track error: {track_response.status}")
                else:
                    logging.error(f"SoundStat search error: {search_response.status}")
        
        # Fallback to defaults
        return {"tempo": 120, "energy": 60, "danceability": 60}
        
    except Exception as e:
        logging.error(f"Error calling SoundStat: {str(e)}")
        return {"tempo": 120, "energy": 60, "danceability": 60}

@api_router.post("/spotify/tracks")
async def get_tracks(request: dict):
    """Get tracks with 80% discovery (similar artists) and 20% from selected artists.
    OPTIMIZED for speed - minimal API calls."""
    import random
    
    token_doc = await db.spotify_tokens.find_one({"user_id": "default_user"})
    
    if not token_doc:
        raise HTTPException(status_code=401, detail="Not authenticated with Spotify")
    
    sp = spotipy.Spotify(auth=token_doc['access_token'])
    
    # Extract artist IDs and names from the request
    artist_ids = [artist['id'] if isinstance(artist, dict) else artist for artist in request.get('artists', [])]
    artist_names = set()
    
    # Get selected artist names from request (no API call needed if names provided)
    for artist in request.get('artists', []):
        if isinstance(artist, dict) and 'name' in artist:
            artist_names.add(artist['name'].lower())
    
    logging.info(f"Selected artists: {artist_names}")
    
    # Get genres from request
    genres = request.get('genres', [])
    genres_lower = [g.lower() for g in genres]
    
    # Blocked genres map
    BLOCKED_GENRES_MAP = {
        'rock': ['hip hop', 'rap', 'trap', 'drill', 'reggaeton', 'latin', 'country', 'k-pop', 'j-pop', 'r&b'],
        'metal': ['hip hop', 'rap', 'trap', 'drill', 'reggaeton', 'latin', 'country', 'k-pop', 'j-pop', 'r&b', 'pop'],
        'hip-hop': ['metal', 'rock', 'punk', 'country', 'classical'],
        'pop': ['metal', 'death', 'black metal', 'hardcore', 'screamo'],
        'country': ['metal', 'hip hop', 'rap', 'electronic', 'techno'],
    }
    
    # Build blocked genres list based on station genres
    blocked_genres = set()
    for station_genre in genres_lower:
        for family, blocked in BLOCKED_GENRES_MAP.items():
            if family in station_genre or station_genre in family:
                for bg in blocked:
                    # Don't block if it's a selected genre
                    if not any(bg in sg or sg in bg for sg in genres_lower):
                        blocked_genres.add(bg)
    
    def is_blocked_artist(artist_genres):
        """Quick check if artist has blocked genres"""
        for ag in artist_genres:
            ag_lower = ag.lower()
            for blocked in blocked_genres:
                if blocked in ag_lower:
                    return True
        return False
    
    def is_selected_artist(track):
        """Check if track is from a selected artist"""
        return track['artists'][0]['id'] in artist_ids or track['artists'][0]['name'].lower() in artist_names
    
    # Track pools
    selected_artist_tracks = []
    discovery_tracks = []
    seen_uris = set()
    
    def add_track(track, target_list):
        if track['uri'] not in seen_uris:
            seen_uris.add(track['uri'])
            target_list.append({
                "uri": track['uri'],
                "name": track['name'],
                "artist": track['artists'][0]['name'],
                "album": track['album']['name'],
                "image": track['album']['images'][0]['url'] if track['album']['images'] else None,
                "duration_ms": track['duration_ms']
            })
    
    # Shuffle artist order
    shuffled_artist_ids = artist_ids.copy()
    random.shuffle(shuffled_artist_ids)
    
    # STEP 1: Get tracks from selected artists (fast - just top tracks)
    logging.info("STEP 1: Fetching tracks from selected artists...")
    for artist_id in shuffled_artist_ids[:5]:  # Limit to 5 artists
        try:
            results = sp.artist_top_tracks(artist_id, country='US')
            tracks = results['tracks']
            random.shuffle(tracks)
            for track in tracks[:4]:  # 4 tracks per artist
                add_track(track, selected_artist_tracks)
        except Exception as e:
            continue
    
    logging.info(f"Got {len(selected_artist_tracks)} tracks from selected artists")
    
    # STEP 2: Get discovery tracks via genre search (OPTIMIZED)
    logging.info("STEP 2: Fetching discovery tracks...")
    
    # Search for tracks directly instead of artists (fewer API calls)
    for genre in genres_lower[:3]:  # Only 3 genres
        if len(discovery_tracks) >= 40:
            break
        try:
            # Search for tracks in this genre
            query = f'genre:"{genre}"'
            results = sp.search(q=query, type='track', limit=50, market='US')
            
            for track in results['tracks']['items']:
                if len(discovery_tracks) >= 40:
                    break
                # Skip if from selected artist
                if is_selected_artist(track):
                    continue
                # Quick genre check using track's artist info (already in response)
                add_track(track, discovery_tracks)
                
        except Exception as e:
            logging.error(f"Search error: {str(e)}")
            continue
    
    # STEP 3: If still need more, search by selected artist names for similar
    if len(discovery_tracks) < 30:
        logging.info("STEP 3: Additional discovery via artist similarity...")
        for artist_name in list(artist_names)[:2]:  # Just 2 artists
            if len(discovery_tracks) >= 40:
                break
            try:
                # Search for tracks related to artist style
                query = f'"{artist_name}"'
                results = sp.search(q=query, type='track', limit=30, market='US')
                
                for track in results['tracks']['items']:
                    if len(discovery_tracks) >= 40:
                        break
                    if not is_selected_artist(track):
                        add_track(track, discovery_tracks)
            except:
                continue
    
    logging.info(f"Got {len(discovery_tracks)} discovery tracks")
    
    # STEP 4: Build final playlist (80/20 split)
    random.shuffle(discovery_tracks)
    random.shuffle(selected_artist_tracks)
    
    # Take 40 discovery + 10 selected = 50 total
    final_discovery = discovery_tracks[:40]
    final_selected = selected_artist_tracks[:10]
    
    # Interleave: 4 discovery, 1 selected
    all_tracks = []
    d_idx, s_idx = 0, 0
    while d_idx < len(final_discovery) or s_idx < len(final_selected):
        for _ in range(4):
            if d_idx < len(final_discovery):
                all_tracks.append(final_discovery[d_idx])
                d_idx += 1
        if s_idx < len(final_selected):
            all_tracks.append(final_selected[s_idx])
            s_idx += 1
    
    logging.info(f"=== FINAL: {len(all_tracks)} tracks ===")
    
    return {"tracks": all_tracks}


# Station Management Routes
@api_router.post("/stations", response_model=Station)
async def create_station(station_data: StationCreate):
    """Create a new station"""
    station = Station(**station_data.model_dump())
    # Set genre for backward compatibility (use first genre)
    if station.genres and len(station.genres) > 0:
        station.genre = station.genres[0]
    doc = prepare_for_mongo(station.model_dump())
    await db.stations.insert_one(doc)
    return station

@api_router.get("/stations", response_model=List[Station])
async def get_stations():
    """Get all stations for the user"""
    stations = await db.stations.find({"user_id": "default_user"}, {"_id": 0}).to_list(100)
    
    # Convert ISO strings back to datetime and fix artist format
    for station in stations:
        if isinstance(station['created_at'], str):
            station['created_at'] = datetime.fromisoformat(station['created_at'])
        
        # Fix old stations that have artists as strings instead of objects
        if station.get('artists') and isinstance(station['artists'][0], str):
            station['artists'] = [{"id": f"legacy_{i}", "name": artist} for i, artist in enumerate(station['artists'])]
        
        # Fix old stations with single genre instead of genres array
        if 'genre' in station and 'genres' not in station:
            station['genres'] = [station['genre']]
        elif 'genres' not in station:
            station['genres'] = []
    
    return stations

@api_router.get("/stations/{station_id}", response_model=Station)
async def get_station(station_id: str):
    """Get a specific station"""
    station = await db.stations.find_one({"id": station_id}, {"_id": 0})
    
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    
    if isinstance(station['created_at'], str):
        station['created_at'] = datetime.fromisoformat(station['created_at'])
    
    # Fix old stations that have artists as strings instead of objects
    if station.get('artists') and isinstance(station['artists'][0], str):
        station['artists'] = [{"id": f"legacy_{i}", "name": artist} for i, artist in enumerate(station['artists'])]
    
    return station

@api_router.put("/stations/{station_id}", response_model=Station)
async def update_station(station_id: str, station_data: StationCreate):
    """Update an existing station"""
    # Check if station exists
    existing = await db.stations.find_one({"id": station_id, "user_id": "default_user"})
    if not existing:
        raise HTTPException(status_code=404, detail="Station not found")
    
    # Create updated station
    updated_station = Station(**station_data.model_dump(), id=station_id, created_at=datetime.fromisoformat(existing['created_at']) if isinstance(existing['created_at'], str) else existing['created_at'])
    
    # Set genre for backward compatibility
    if updated_station.genres and len(updated_station.genres) > 0:
        updated_station.genre = updated_station.genres[0]
    
    doc = prepare_for_mongo(updated_station.model_dump())
    await db.stations.replace_one({"id": station_id}, doc)
    
    return updated_station

@api_router.delete("/stations/{station_id}")
async def delete_station(station_id: str):
    """Delete a station"""
    result = await db.stations.delete_one({"id": station_id, "user_id": "default_user"})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Station not found")
    
    return {"message": "Station deleted successfully"}

# Concert Data Routes (Bandsintown)
@api_router.get("/concerts/{artist_name}")
async def get_concerts(artist_name: str):
    """Get upcoming concerts for an artist"""
    concerts = await get_artist_concerts(artist_name)
    return {"artist": artist_name, "concerts": concerts}

# ElevenLabs Voice Routes
@api_router.get("/elevenlabs/voices")
async def get_voices():
    """Get user's custom voices from ElevenLabs"""
    if not eleven_client:
        raise HTTPException(status_code=500, detail="ElevenLabs API key not configured")
    
    try:
        voices_response = eleven_client.voices.get_all()
        
        voices = []
        for voice in voices_response.voices:
            # Get all voices - user's custom voices and premade ones
            # Filter to only show voices owned by the user (category = 'cloned' or 'generated')
            voice_category = getattr(voice, 'category', None)
            
            # Only include user's custom voices, not premade library voices
            if voice_category in ['cloned', 'generated', 'professional']:
                voices.append({
                    "voice_id": voice.voice_id,
                    "name": voice.name,
                    "description": getattr(voice, 'description', None),
                    "category": voice_category
                })
        
        # If no custom voices, include a helpful message
        if len(voices) == 0:
            logging.warning("No custom voices found for this API key")
            # Return empty list - user needs to create voices in ElevenLabs
            return {
                "voices": [],
                "message": "No custom voices found. Please create voices in your ElevenLabs account at elevenlabs.io"
            }
        
        return {"voices": voices}
    except Exception as e:
        logging.error(f"Error fetching voices: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching voices: {str(e)}")

# Bumper Generation Routes
@api_router.post("/bumpers/generate")
async def generate_bumper(request: BumperRequest):
    """Generate a professional radio bumper with AI-generated text, voice, and background music"""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Gemini API key not configured")
    
    if not eleven_client:
        raise HTTPException(status_code=500, detail="ElevenLabs API key not configured")
    
    try:
        # Log what we received
        logging.info(f"Bumper request - Track: '{request.current_track_name}' by {request.current_track_artist}, Topics: {request.topics}")
        
        # Get the actual track that just played and what's coming next
        track_artist = request.current_track_artist or "an amazing track"
        track_name = request.current_track_name or ""
        next_artist = request.next_track_artist or ""
        next_name = request.next_track_name or ""
        genres_str = " and ".join(request.genres) if request.genres else "music"
        
        # Fetch real-time data based on topics
        real_time_context = ""
        weather_context = ""
        
        # Check for weather topic - fetch real weather data
        if request.topics and any('weather' in t.lower() for t in request.topics):
            location = request.user_location or "auto:ip"
            weather = await get_weather(location)
            if weather and weather.get('city'):
                temp = round(weather.get('temp_f', 0))
                condition = weather.get('condition', '')
                city = weather.get('city', '')
                weather_context = f"REAL WEATHER: It's currently {temp}°F and {condition.lower()} in {city}. "
                logging.info(f"Weather for bumper: {weather_context}")
        
        # Limit weather to once every 3-4 bumpers (25% chance)
        import random
        if weather_context and random.random() > 0.25:
            logging.info("Skipping weather this bumper (rate limiting to 1 in 4)")
            weather_context = ""
        
        # Check for concert tours topic - fetch real concert data
        if request.topics and any('concert' in t.lower() or 'tour' in t.lower() for t in request.topics):
            concerts = await get_artist_concerts(track_artist, limit=2)
            if concerts:
                concert = concerts[0]
                concert_date = concert.get('date', '')
                if concert_date:
                    # Parse and format the date nicely
                    try:
                        dt = datetime.fromisoformat(concert_date.replace('T', ' ').split('+')[0])
                        formatted_date = dt.strftime('%B %d')  # e.g., "January 15"
                    except:
                        formatted_date = concert_date[:10]
                    
                    city = concert.get('city', '')
                    venue = concert.get('venue', '')
                    real_time_context = f"REAL CONCERT INFO: {track_artist} is playing {venue} in {city} on {formatted_date}. "
                    logging.info(f"Found concert for {track_artist}: {real_time_context}")
        
        # Get current time for time-based mentions
        current_time = datetime.now()
        time_context = ""
        hour = current_time.hour
        if 5 <= hour < 12:
            time_context = "morning"
        elif 12 <= hour < 17:
            time_context = "afternoon"
        elif 17 <= hour < 21:
            time_context = "evening"
        else:
            time_context = "late night"
        
        # Build the system message with topic-specific instructions
        system_message = f"""You are a professional radio DJ. Generate ONLY the exact words you would say on air.
Rules:
- Keep it under 50 words (but shorter is fine - be natural, don't force it)
- Be energetic and conversational
- Mention the SPECIFIC song and artist that just played
- If REAL WEATHER is provided, mention it naturally (e.g., "it's a beautiful 72 degrees out there...")
- If REAL CONCERT INFO is provided, mention it naturally (e.g., "catch them live at...")
- If topics are provided, share 1-2 UNIQUE interesting facts (never repeat the same facts)
- Current time of day: {time_context} - you can reference this naturally
- DO NOT make up concert dates, venues, or tour info - only use REAL CONCERT INFO if provided
- DO NOT make up weather - only use REAL WEATHER if provided
- Sound natural like a real DJ
- ALWAYS end with "on your F M, your [genre(s)] station!" or a variation like "here on your F M!"
- Write "your F M" NOT "YOURFM" for proper pronunciation
- Output ONLY what the DJ would say"""

        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=str(uuid.uuid4()),
            system_message=system_message
        ).with_model("gemini", "gemini-2.0-flash")
        
        # Build specific prompt with actual track info and real-time context
        topics_str = ", ".join(request.topics) if request.topics else ""
        
        # Combine all real-time context
        all_context = weather_context + real_time_context
        
        if all_context:
            # We have real-time data (weather and/or concert)
            if next_name and next_artist:
                prompt = f"{all_context}You just played '{track_name}' by {track_artist}. Work in the real-time info naturally, then announce '{next_name}' by {next_artist} is up next. End with 'on your F M, your {genres_str} station!'"
            else:
                prompt = f"{all_context}You just played '{track_name}' by {track_artist}. Work in the real-time info naturally, then hype what's next. End with 'on your F M, your {genres_str} station!'"
        elif topics_str:
            if next_name and next_artist:
                prompt = f"You just played '{track_name}' by {track_artist}. Share a unique interesting fact about: {topics_str} for {track_artist}. Then mention '{next_name}' by {next_artist} is coming up next. End with 'on your F M, your {genres_str} station!' or similar."
            else:
                prompt = f"You just played '{track_name}' by {track_artist}. Share a unique interesting fact about: {topics_str} for {track_artist}. Then hype what's next. End with 'on your F M, your {genres_str} station!' or similar."
        else:
            if next_name and next_artist:
                prompt = f"You just played '{track_name}' by {track_artist}. Say something energetic, then announce '{next_name}' by {next_artist} is up next. End with 'on your F M, your {genres_str} station!' or similar."
            else:
                prompt = f"You just played '{track_name}' by {track_artist}. Say something energetic and hype what's next. End with 'on your F M, your {genres_str} station!' or similar."
        
        logging.info(f"Prompt sent to AI: {prompt}")
        
        message = UserMessage(text=prompt)
        raw_response = await chat.send_message(message)
        
        logging.info(f"AI response: {raw_response}")
        
        # Clean up response
        bumper_text = raw_response.strip().strip('"').strip("'")
        
        # If response is bad, use template with actual track info
        if len(bumper_text.split()) > 55 or any(word in bumper_text.lower() for word in ['prompt', 'instruction', 'create', 'generate']):
            bumper_text = f"That was {track_artist} with {track_name}! Stay tuned for more hits on your F M, your {genres_str} station!"
        
        # Generate voice audio using ElevenLabs with stability settings for radio quality
        from elevenlabs import VoiceSettings
        
        audio_generator = eleven_client.text_to_speech.convert(
            text=bumper_text,
            voice_id=request.voice_id,
            model_id="eleven_turbo_v2_5",  # Use turbo for faster, more energetic delivery
            voice_settings=VoiceSettings(
                stability=0.4,  # Lower for more expressive, radio-style delivery
                similarity_boost=0.8,  # Higher for consistent voice quality
                style=0.6,  # Add more character
                use_speaker_boost=True  # Enhance clarity
            )
        )
        
        # Collect audio data
        audio_data = b""
        for chunk in audio_generator:
            audio_data += chunk
        
        # Convert to base64 for voice-only bumper (music generation disabled)
        audio_b64 = base64.b64encode(audio_data).decode()
        
        # Save bumper to database
        bumper = Bumper(
            station_id=request.station_id,
            text=bumper_text,
            audio_base64=audio_b64,
            voice_id=request.voice_id
        )
        
        doc = prepare_for_mongo(bumper.model_dump())
        await db.bumpers.insert_one(doc)
        
        return {
            "id": bumper.id,
            "text": bumper_text,
            "audio_url": f"data:audio/mpeg;base64,{audio_b64}"
        }
        
    except Exception as e:
        logging.error(f"Error generating bumper: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error generating bumper: {str(e)}")

@api_router.get("/")
async def root():
    return {"message": "Radio App API"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()