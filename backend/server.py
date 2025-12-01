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

class VoiceInfo(BaseModel):
    voice_id: str
    name: str
    description: Optional[str] = None

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
    Completely randomized on each station load."""
    import random
    
    token_doc = await db.spotify_tokens.find_one({"user_id": "default_user"})
    
    if not token_doc:
        raise HTTPException(status_code=401, detail="Not authenticated with Spotify")
    
    sp = spotipy.Spotify(auth=token_doc['access_token'])
    
    # Extract artist IDs and names from the request
    artist_ids = [artist['id'] if isinstance(artist, dict) else artist for artist in request.get('artists', [])]
    artist_names = set()
    
    # Get selected artist names for filtering
    for artist in request.get('artists', []):
        if isinstance(artist, dict) and 'name' in artist:
            artist_names.add(artist['name'].lower())
    
    # Also fetch names from Spotify if we only have IDs
    for artist_id in artist_ids[:10]:
        try:
            artist_info = sp.artist(artist_id)
            artist_names.add(artist_info['name'].lower())
        except:
            pass
    
    logging.info(f"Selected artists: {artist_names}")
    
    # Separate pools for selected artists vs discovery
    selected_artist_tracks = []  # 20% - tracks FROM the selected artists
    discovery_tracks = []  # 80% - tracks from similar/related artists
    seen_uris = set()
    discovery_artist_names = set()  # Track which new artists we're discovering
    verified_artist_cache = {}  # Cache genre-verified artists
    
    # Define genre families for strict filtering
    GENRE_FAMILIES = {
        'rock': ['rock', 'metal', 'punk', 'grunge', 'alternative', 'hardcore', 'emo', 'screamo', 'post-hardcore', 'metalcore', 'deathcore', 'nu metal', 'hard rock', 'progressive'],
        'metal': ['metal', 'rock', 'hardcore', 'metalcore', 'deathcore', 'death metal', 'black metal', 'thrash', 'doom', 'progressive metal', 'nu metal', 'djent'],
        'hip-hop': ['hip hop', 'rap', 'trap', 'r&b', 'drill', 'grime'],
        'pop': ['pop', 'dance pop', 'electropop', 'synth'],
        'electronic': ['electronic', 'edm', 'house', 'techno', 'dubstep', 'drum and bass', 'trance'],
        'country': ['country', 'americana', 'bluegrass', 'folk'],
        'jazz': ['jazz', 'blues', 'soul', 'funk'],
        'classical': ['classical', 'orchestra', 'symphony', 'opera'],
        'latin': ['latin', 'reggaeton', 'salsa', 'bachata'],
        'indie': ['indie', 'alternative', 'lo-fi', 'bedroom'],
    }
    
    # Blocked genres - genres that should NEVER appear in rock/metal stations
    BLOCKED_GENRES_MAP = {
        'rock': ['hip hop', 'rap', 'trap', 'drill', 'reggaeton', 'latin', 'country', 'k-pop', 'j-pop', 'r&b', 'soul'],
        'metal': ['hip hop', 'rap', 'trap', 'drill', 'reggaeton', 'latin', 'country', 'k-pop', 'j-pop', 'r&b', 'soul', 'pop'],
        'hip-hop': ['metal', 'rock', 'punk', 'country', 'classical'],
        'pop': ['metal', 'death', 'black metal', 'hardcore', 'screamo'],
        'country': ['metal', 'hip hop', 'rap', 'electronic', 'techno'],
    }
    
    def is_selected_artist(track):
        """Check if track is from a selected artist"""
        track_artist_name = track['artists'][0]['name'].lower()
        track_artist_id = track['artists'][0]['id']
        return track_artist_id in artist_ids or track_artist_name in artist_names
    
    def is_genre_blocked(artist_genres, station_genres):
        """Check if artist genres are blocked for this station type.
        IMPORTANT: If a genre is in the station's selected genres, it's NOT blocked."""
        artist_genres_lower = [g.lower() for g in artist_genres]
        station_genres_lower = [g.lower() for g in station_genres]
        
        # First, check if artist matches ANY of the selected station genres
        # If so, they're allowed regardless of blocklist
        for artist_genre in artist_genres_lower:
            for station_genre in station_genres_lower:
                if station_genre in artist_genre or artist_genre in station_genre:
                    # Artist matches a selected genre - NOT blocked
                    return False, None
        
        # Artist doesn't match any selected genre - check blocklist
        blocked_list = set()
        for station_genre in station_genres_lower:
            # Find blocked genres for this station type
            for family, blocked in BLOCKED_GENRES_MAP.items():
                if family in station_genre or station_genre in family:
                    # Add blocked genres, BUT exclude any that are also selected genres
                    for blocked_genre in blocked:
                        # Don't block if this genre is selected by user
                        is_selected = any(
                            blocked_genre in sg or sg in blocked_genre 
                            for sg in station_genres_lower
                        )
                        if not is_selected:
                            blocked_list.add(blocked_genre)
        
        # Check if any artist genre is in the blocked list
        for artist_genre in artist_genres_lower:
            for blocked_genre in blocked_list:
                if blocked_genre in artist_genre:
                    return True, artist_genre
        
        return False, None
    
    def add_track(track, target_list, is_discovery=False):
        """Helper to add track avoiding duplicates"""
        if track['uri'] not in seen_uris:
            seen_uris.add(track['uri'])
            track_data = {
                "uri": track['uri'],
                "name": track['name'],
                "artist": track['artists'][0]['name'],
                "artist_id": track['artists'][0]['id'],
                "album": track['album']['name'],
                "image": track['album']['images'][0]['url'] if track['album']['images'] else None,
                "duration_ms": track['duration_ms'],
                "preview_url": track.get('preview_url'),
                "is_discovery": is_discovery
            }
            target_list.append(track_data)
            if is_discovery:
                discovery_artist_names.add(track['artists'][0]['name'])
    
    # Shuffle artist order for variety each time
    shuffled_artist_ids = artist_ids.copy()
    random.shuffle(shuffled_artist_ids)
    
    # STEP 1: Get tracks FROM selected artists (for the 20% pool)
    logging.info("STEP 1: Fetching tracks from selected artists...")
    for artist_id in shuffled_artist_ids[:10]:
        try:
            results = sp.artist_top_tracks(artist_id, country='US')
            tracks = results['tracks']
            random.shuffle(tracks)  # Randomize which tracks we pick
            for track in tracks[:5]:  # Up to 5 random tracks per selected artist
                add_track(track, selected_artist_tracks, is_discovery=False)
        except Exception as e:
            logging.error(f"Error fetching tracks for artist {artist_id}: {str(e)}")
            continue
    
    logging.info(f"Got {len(selected_artist_tracks)} tracks from selected artists")
    
    # STEP 2: Get discovery tracks using SEARCH API (related-artists was deprecated Nov 2024)
    # Focus on finding artists in the EXACT same genres as selected artists
    logging.info("STEP 2: Fetching discovery tracks via targeted genre search...")
    
    # Get genres from request
    genres = request.get('genres', [])
    
    # First, get the actual genres of the selected artists from Spotify
    selected_artist_genres = set()
    for artist_id in artist_ids[:5]:
        try:
            artist_info = sp.artist(artist_id)
            for g in artist_info.get('genres', []):
                selected_artist_genres.add(g.lower())
        except:
            pass
    
    logging.info(f"Selected artist genres from Spotify: {selected_artist_genres}")
    
    # Combine with user-selected genres
    all_target_genres = list(selected_artist_genres) + [g.lower() for g in genres]
    # Remove duplicates while preserving order
    seen = set()
    all_target_genres = [g for g in all_target_genres if not (g in seen or seen.add(g))]
    
    logging.info(f"Target genres for discovery: {all_target_genres[:6]}")
    logging.info(f"Station genres for blocking: {genres}")
    
    def verify_artist_genre(artist_id, artist_name):
        """Verify artist is in compatible genres and not blocked"""
        if artist_id in verified_artist_cache:
            return verified_artist_cache[artist_id]
        
        try:
            artist_info = sp.artist(artist_id)
            artist_genres = artist_info.get('genres', [])
            
            # Check if blocked
            is_blocked, blocked_genre = is_genre_blocked(artist_genres, genres)
            if is_blocked:
                logging.info(f"BLOCKED {artist_name} - has blocked genre: {blocked_genre}")
                verified_artist_cache[artist_id] = False
                return False
            
            # Check for genre overlap with target genres
            artist_genres_lower = [g.lower() for g in artist_genres]
            genre_overlap = any(
                target_g in artist_g or artist_g in target_g 
                for target_g in all_target_genres[:8] 
                for artist_g in artist_genres_lower
            )
            
            if not genre_overlap and artist_genres:
                logging.info(f"Skipping {artist_name} - no genre overlap: {artist_genres}")
                verified_artist_cache[artist_id] = False
                return False
            
            verified_artist_cache[artist_id] = True
            return True
        except:
            # If we can't verify, allow it (better than blocking everything)
            return True
    
    try:
        # Strategy 1: Search for artists in the EXACT genres and get their tracks
        for genre in all_target_genres[:6]:  # Use top 6 genres
            try:
                # Search for artists in this specific genre
                query = f'genre:"{genre}"'
                logging.info(f"Searching artists in genre: {genre}")
                artist_results = sp.search(q=query, type='artist', limit=30, market='US')
                
                found_artists = artist_results['artists']['items']
                random.shuffle(found_artists)
                
                for artist in found_artists:
                    # Skip selected artists
                    if artist['id'] in artist_ids or artist['name'].lower() in artist_names:
                        continue
                    
                    # Verify genre compatibility
                    if not verify_artist_genre(artist['id'], artist['name']):
                        continue
                    
                    # Get tracks from this genre-matched artist
                    try:
                        artist_tracks = sp.artist_top_tracks(artist['id'], country='US')
                        tracks = artist_tracks['tracks']
                        random.shuffle(tracks)
                        
                        artist_genres = [g.lower() for g in artist.get('genres', [])]
                        logging.info(f"Adding tracks from {artist['name']} (genres: {artist_genres[:3]})")
                        
                        for track in tracks[:5]:  # Up to 5 tracks per discovered artist
                            if not is_selected_artist(track):
                                add_track(track, discovery_tracks, is_discovery=True)
                            
                            if len(discovery_tracks) >= 150:
                                break
                        
                        if len(discovery_tracks) >= 150:
                            break
                    except Exception:
                        continue
                
                if len(discovery_tracks) >= 150:
                    break
                    
            except Exception as search_e:
                logging.error(f"Search error for genre '{genre}': {str(search_e)}")
                continue
                
    except Exception as e:
        logging.error(f"Error in discovery search: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
    
    logging.info(f"Got {len(discovery_tracks)} discovery tracks. New artists discovered: {len(discovery_artist_names)}")
    
    # STEP 3: Search for tracks from albums by selected artists' collaborators
    # Only add collaborators that pass strict genre verification
    logging.info("STEP 3: Finding tracks from genre-verified collaborators...")
    checked_collaborators = set()  # Avoid checking same collaborator multiple times
    
    try:
        for artist_id in shuffled_artist_ids[:5]:
            try:
                # Get albums from selected artist
                albums = sp.artist_albums(artist_id, album_type='album,single', limit=10, country='US')
                
                for album in albums['items'][:5]:
                    try:
                        # Get tracks from album to find featuring artists
                        album_tracks = sp.album_tracks(album['id'], limit=20)
                        
                        for track in album_tracks['items']:
                            # Look for featuring artists (collaborators)
                            for track_artist in track['artists'][1:]:  # Skip the main artist
                                if track_artist['id'] in checked_collaborators:
                                    continue
                                checked_collaborators.add(track_artist['id'])
                                
                                if track_artist['id'] not in artist_ids and track_artist['name'].lower() not in artist_names:
                                    # Use strict genre verification
                                    if not verify_artist_genre(track_artist['id'], track_artist['name']):
                                        continue
                                    
                                    # Passed genre check - get their tracks
                                    try:
                                        collab_tracks = sp.artist_top_tracks(track_artist['id'], country='US')
                                        collab_track_list = collab_tracks['tracks']
                                        random.shuffle(collab_track_list)
                                        
                                        for ct in collab_track_list[:3]:
                                            if not is_selected_artist(ct):
                                                add_track(ct, discovery_tracks, is_discovery=True)
                                                logging.info(f"Added track from verified collaborator: {track_artist['name']}")
                                            
                                            if len(discovery_tracks) >= 200:
                                                break
                                    except:
                                        continue
                                
                                if len(discovery_tracks) >= 200:
                                    break
                        
                        if len(discovery_tracks) >= 200:
                            break
                    except:
                        continue
                
                if len(discovery_tracks) >= 200:
                    break
            except Exception as e:
                continue
    except Exception as e:
        logging.error(f"Error finding collaborators: {str(e)}")
    
    logging.info(f"After all discovery: {len(discovery_tracks)} discovery tracks total")
    
    # STEP 4: Build final playlist with 80/20 split
    # Target 50 tracks: 40 discovery (80%) + 10 selected artists (20%)
    target_total = 50
    target_discovery = int(target_total * 0.80)  # 40 tracks
    target_selected = target_total - target_discovery  # 10 tracks
    
    # Shuffle both pools completely
    random.shuffle(discovery_tracks)
    random.shuffle(selected_artist_tracks)
    
    # Pick tracks maintaining the ratio
    final_discovery = discovery_tracks[:target_discovery]
    final_selected = selected_artist_tracks[:target_selected]
    
    # If we don't have enough of one type, fill with the other
    if len(final_discovery) < target_discovery:
        extra_needed = target_discovery - len(final_discovery)
        final_selected = selected_artist_tracks[:target_selected + extra_needed]
    elif len(final_selected) < target_selected:
        extra_needed = target_selected - len(final_selected)
        final_discovery = discovery_tracks[:target_discovery + extra_needed]
    
    # IMPORTANT: Interleave selected artists throughout the playlist
    # Instead of just shuffling together, ensure selected artists appear regularly
    all_tracks = []
    discovery_idx = 0
    selected_idx = 0
    
    # Pattern: 4 discovery tracks, then 1 selected artist track (maintains 80/20)
    while discovery_idx < len(final_discovery) or selected_idx < len(final_selected):
        # Add up to 4 discovery tracks
        for _ in range(4):
            if discovery_idx < len(final_discovery):
                all_tracks.append(final_discovery[discovery_idx])
                discovery_idx += 1
        
        # Add 1 selected artist track
        if selected_idx < len(final_selected):
            all_tracks.append(final_selected[selected_idx])
            selected_idx += 1
    
    # Log the actual artist distribution
    final_discovery_artists = set(t['artist'] for t in final_discovery)
    final_selected_artists = set(t['artist'] for t in final_selected)
    
    logging.info(f"=== FINAL TRACK MIX ===")
    logging.info(f"Discovery: {len(final_discovery)} tracks from {len(final_discovery_artists)} NEW artists")
    logging.info(f"Selected: {len(final_selected)} tracks from selected artists: {final_selected_artists}")
    logging.info(f"Total: {len(all_tracks)} tracks")
    logging.info(f"New artists in playlist: {final_discovery_artists}")
    
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
- If REAL CONCERT INFO is provided, mention it naturally (e.g., "catch them live at...")
- If topics are provided, share 1-2 UNIQUE interesting facts (never repeat the same facts)
- Current time of day: {time_context} - you can reference this naturally
- DO NOT make up concert dates, venues, or tour info - only use REAL CONCERT INFO if provided
- DO NOT make up facts about weather or news
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
        
        if real_time_context:
            # We have real concert data
            if next_name and next_artist:
                prompt = f"{real_time_context}You just played '{track_name}' by {track_artist}. Mention their upcoming show naturally, then announce '{next_name}' by {next_artist} is up next. End with 'on your F M, your {genres_str} station!'"
            else:
                prompt = f"{real_time_context}You just played '{track_name}' by {track_artist}. Mention their upcoming show naturally, then hype what's next. End with 'on your F M, your {genres_str} station!'"
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