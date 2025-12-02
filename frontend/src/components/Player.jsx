import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Play, Pause, SkipForward, Volume2 } from 'lucide-react';
import SpotifyPlayer from 'react-spotify-web-playback';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Helper function to get user's location (uses cached location from StationCreator or falls back to IP)
const getUserLocation = () => {
  // Check if we have cached location (set when user selected "local weather" topic)
  const cachedLocation = localStorage.getItem('userLocation');
  if (cachedLocation) {
    console.log('Using cached location:', cachedLocation);
    return cachedLocation;
  }
  // Fall back to IP-based detection
  console.log('No cached location, using IP detection');
  return 'auto:ip';
};

const Player = ({ station, spotifyToken }) => {
  const [tracks, setTracks] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBumper, setCurrentBumper] = useState(null);
  const [playingBumper, setPlayingBumper] = useState(false);
  const [loading, setLoading] = useState(true);
  const [songsSinceLastBumper, setSongsSinceLastBumper] = useState(0);
  const [lastProcessedTrack, setLastProcessedTrack] = useState(null);
  const [spotifyPlayer, setSpotifyPlayer] = useState(null);
  const [currentAlbumArt, setCurrentAlbumArt] = useState(null);
  const [currentTrackName, setCurrentTrackName] = useState('');
  const [playerReady, setPlayerReady] = useState(false);
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const animationRef = useRef(null);
  const bumperAudioRef = useRef(null);
  const lastTrackUriRef = useRef(null);
  const isPlayingRef = useRef(true);
  const beatPhaseRef = useRef(0);
  const lastPositionRef = useRef(0);
  const trackStartTimeRef = useRef(0);
  const isLoadingTracksRef = useRef(false);
  const loadedStationIdRef = useRef(null);

  useEffect(() => {
    if (station) {
      // Reset the loaded station ref to force fresh track loading every time
      loadedStationIdRef.current = null;
      loadTracks();
      // Don't set default features - keep it null so visualizer stays static
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [station]);

  // Initialize visualizer when canvas is ready
  useEffect(() => {
    if (canvasRef.current && !animationRef.current) {
      console.log('🎨 Initializing audio visualizer');
      initAudioVisualizer();
    }
  }, [canvasRef.current, tracks]);

  // Poll Spotify player state to update album art
  useEffect(() => {
    if (!spotifyPlayer) {
      console.log('⚠️ No Spotify player available for polling');
      return;
    }

    console.log('✅ Starting album art polling');
    
    const pollInterval = setInterval(() => {
      spotifyPlayer.getCurrentState().then(state => {
        if (!state) {
          console.log('⚠️ Polling: No state available');
          return;
        }
        
        const track = state.track_window?.current_track;
        if (!track) {
          console.log('⚠️ Polling: No current track');
          return;
        }
        
        console.log(`🔍 Polling check - Current: ${track.name}, Last: ${lastTrackUriRef.current}`);
        
        if (track.uri !== lastTrackUriRef.current) {
          console.log(`🔄 TRACK CHANGED! From: ${lastTrackUriRef.current} To: ${track.uri}`);
          lastTrackUriRef.current = track.uri;
          
          if (track.album?.images?.[0]?.url) {
            const albumUrl = track.album.images[0].url;
            console.log(`🎨 SETTING NEW ALBUM ART: ${track.name}`);
            console.log(`🖼️ URL: ${albumUrl}`);
            setCurrentAlbumArt(albumUrl);
            setCurrentTrackName(track.name);
          } else {
            console.log('⚠️ No album art URL available');
          }
          
          // Track changed - no API calls needed
          
          // Update track index
          const newIndex = tracks.findIndex(t => t.uri === track.uri);
          if (newIndex !== -1) {
            console.log(`📍 Updating track index to: ${newIndex}`);
            setCurrentTrackIndex(newIndex);
          }
        }
      }).catch(err => console.error('❌ Error polling player state:', err));
    }, 1000); // Poll every second

    return () => {
      console.log('🛑 Stopping album art polling');
      clearInterval(pollInterval);
    };
  }, [spotifyPlayer, tracks]);

  const connectAudioToVisualizer = async (playerInstance) => {
    try {
      console.log('🔍 Searching for Spotify audio element...');
      
      // Wait a bit for Spotify player to create audio element
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const audioElements = document.querySelectorAll('audio');
      console.log(`📻 Found ${audioElements.length} audio elements`);
      
      let spotifyAudio = null;
      
      // Log all audio elements
      audioElements.forEach((audio, index) => {
        console.log(`Audio ${index}:`, {
          src: audio.src,
          currentSrc: audio.currentSrc,
          id: audio.id,
          className: audio.className
        });
      });
      
      // Try to find Spotify's audio element (it's usually the last one or has no src initially)
      if (audioElements.length > 0) {
        // Usually the last audio element is Spotify's
        spotifyAudio = audioElements[audioElements.length - 1];
        console.log('✅ Using audio element:', spotifyAudio);
      }
      
      if (!spotifyAudio) {
        console.log('⚠️ No audio element found, will retry in 2 seconds...');
        setTimeout(() => connectAudioToVisualizer(playerInstance), 2000);
        return;
      }
      
      // Initialize Web Audio API
      if (!audioContextRef.current) {
        console.log('🎛️ Initializing Web Audio API...');
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 512;
        analyserRef.current.smoothingTimeConstant = 0.75;
        dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
        
        console.log('🔌 Connecting audio source...');
        
        // Connect audio element to analyser
        const source = audioContextRef.current.createMediaElementSource(spotifyAudio);
        source.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
        
        console.log('🎵 Audio visualizer connected to Spotify playback!');
        console.log('📊 Analyser config:', {
          fftSize: analyserRef.current.fftSize,
          frequencyBinCount: analyserRef.current.frequencyBinCount,
          smoothingTimeConstant: analyserRef.current.smoothingTimeConstant
        });
      }
    } catch (error) {
      console.error('❌ Error connecting audio to visualizer:', error);
      console.log('Error details:', error.message);
      console.log('Falling back to simulation mode');
    }
  };

  const loadTracks = async () => {
    // Prevent duplicate loading while a request is in progress
    if (isLoadingTracksRef.current) {
      console.log('⏭️ Already loading tracks, skipping duplicate request');
      return;
    }
    
    try {
      isLoadingTracksRef.current = true;
      setLoading(true);
      
      console.log(`🎵 Loading fresh randomized tracks for station: ${station.name}`);
      
      const response = await axios.post(
        `${API}/spotify/tracks`,
        { 
          artists: station.artists,
          genres: station.genres || (station.genre ? [station.genre] : [])
        }
      );
      
      console.log(`✅ Loaded ${response.data.tracks.length} tracks (80% discovery, 20% selected artists)`);
      setTracks(response.data.tracks);
      setCurrentTrackIndex(0);
      loadedStationIdRef.current = station.id;
      
      setIsPlaying(false);
    } catch (error) {
      console.error('Error loading tracks:', error);
      toast.error('Failed to load tracks');
    } finally {
      setLoading(false);
      isLoadingTracksRef.current = false;
    }
  };

  const initAudioVisualizer = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.log('❌ Canvas not available');
      return;
    }

    console.log('✅ Canvas found, initializing visualizer');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size based on parent
    const updateCanvasSize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.offsetWidth;
        canvas.height = parent.offsetHeight;
        console.log(`📏 Canvas size: ${canvas.width}x${canvas.height}`);
      }
    };
    
    updateCanvasSize();

    let time = 0;

    // Smooth layered wave visualizer
    const animate = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (isPlayingRef.current) {
        time += 0.01; // Slow, smooth animation
        
        const centerY = canvas.height / 2;
        const waves = [
          // Wave layers (color, amplitude, frequency, phase, lineWidth)
          { color: 'rgba(139, 92, 246, 0.3)', amplitude: 40, frequency: 0.015, phase: 0, lineWidth: 8 },      // Purple outer
          { color: 'rgba(167, 139, 250, 0.5)', amplitude: 35, frequency: 0.018, phase: 0.5, lineWidth: 6 },   // Light purple
          { color: 'rgba(251, 191, 36, 0.6)', amplitude: 30, frequency: 0.02, phase: 1, lineWidth: 5 },       // Yellow
          { color: 'rgba(251, 191, 36, 0.9)', amplitude: 25, frequency: 0.022, phase: 1.5, lineWidth: 3 }     // Bright yellow inner
        ];

        // Draw each wave layer
        waves.forEach(wave => {
          ctx.beginPath();
          ctx.strokeStyle = wave.color;
          ctx.lineWidth = wave.lineWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          // Draw smooth sine wave across canvas
          for (let x = 0; x <= canvas.width; x += 2) {
            // Multiple sine waves for organic feel
            const y1 = Math.sin(x * wave.frequency + time + wave.phase) * wave.amplitude;
            const y2 = Math.sin(x * wave.frequency * 1.5 - time * 0.8 + wave.phase) * (wave.amplitude * 0.5);
            const y3 = Math.sin(x * wave.frequency * 0.7 + time * 1.2 + wave.phase) * (wave.amplitude * 0.3);
            
            const y = centerY + y1 + y2 + y3;
            
            if (x === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }

          ctx.stroke();

          // Add glow effect
          ctx.shadowBlur = 15;
          ctx.shadowColor = wave.color;
          ctx.stroke();
          ctx.shadowBlur = 0;
        });

      } else {
        // Static flat line when paused
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    console.log('🎬 Starting smooth wave animation');
    animate();
  };

  const generateAndPlayBumper = async (trackInfo = null, nextTrackInfo = null) => {
    // Prevent multiple simultaneous bumper generations
    if (playingBumper) {
      console.log('Bumper already playing, skipping');
      return;
    }
    
    try {
      console.log('Starting bumper generation (volume already ducked)...');
      setPlayingBumper(true);
      
      // Use provided track info or current track
      const trackToReference = trackInfo || currentTrack;
      
      console.log('Generating bumper for track:', trackToReference);
      console.log('Next track:', nextTrackInfo);
      console.log('Station topics:', station.bumper_topics);
      console.log('User location for weather:', userLocation);
      
      const requestData = {
        station_id: station.id,
        topics: station.bumper_topics || [],
        genres: station.genres || (station.genre ? [station.genre] : []),
        artists: station.artists,
        voice_id: station.voice_id,
        current_track_name: trackToReference?.name || '',
        current_track_artist: trackToReference?.artist || '',
        next_track_name: nextTrackInfo?.name || '',
        next_track_artist: nextTrackInfo?.artist || '',
        user_location: userLocation  // Uses actual detected location or falls back to auto:ip
      };
      
      console.log('Bumper request data:', requestData);
      
      const response = await axios.post(`${API}/bumpers/generate`, requestData);

      setCurrentBumper(response.data);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Play bumper voice over ducked music
      if (bumperAudioRef.current) {
        bumperAudioRef.current.src = response.data.audio_url;
        bumperAudioRef.current.volume = 1.0; // Full volume for voice
        bumperAudioRef.current.load();
        await bumperAudioRef.current.play();
      }
    } catch (error) {
      console.error('Error generating bumper:', error);
      toast.error('Failed to generate bumper');
      setPlayingBumper(false);
      // Restore Spotify volume on error
      if (spotifyPlayer) {
        spotifyPlayer.setVolume(1.0);
      }
    }
  };

  const handleBumperEnded = () => {
    console.log('Bumper ended - fading Spotify back up');
    setPlayingBumper(false);
    setCurrentBumper(null);
    
    // Fade Spotify volume back up from 15% to 100%
    if (spotifyPlayer) {
      let currentVolume = 0.15;
      const fadeUp = setInterval(() => {
        currentVolume += 0.08;
        if (currentVolume >= 1.0) {
          currentVolume = 1.0;
          clearInterval(fadeUp);
          console.log('✓ Spotify volume fully restored');
        }
        spotifyPlayer.setVolume(currentVolume);
        console.log('🎚️ Fading up to:', currentVolume.toFixed(2));
      }, 100); // Fade up over ~1 second
    } else {
      console.log('⚠️ No Spotify player reference available');
    }
  };

  const handleSpotifyStateChange = (state) => {
    if (!state) return;

    // When track ends, play bumper then next track
    if (state.position === 0 && state.previousTracks.length > currentTrackIndex) {
      setCurrentTrackIndex(prev => prev + 1);
      if (station.bumper_topics.length > 0) {
        generateAndPlayBumper();
      }
    }
  };

  const shouldPlayBumper = () => {
    // Play bumper every 3-4 songs (randomized)
    const songsBeforeBumper = Math.floor(Math.random() * 2) + 3; // 3 or 4
    return songsSinceLastBumper >= songsBeforeBumper && station.bumper_topics.length > 0;
  };

  if (loading) {
    return <div className="spinner" data-testid="player-loading"></div>;
  }

  if (tracks.length === 0) {
    return (
      <div className="text-center" style={{ marginTop: '4rem' }}>
        <h2 style={{ color: '#FBBF24', fontSize: '2rem' }}>No tracks found</h2>
        <p style={{ color: '#9ca3af' }}>Unable to load tracks for this station</p>
      </div>
    );
  }

  const currentTrack = tracks[currentTrackIndex];

  return (
    <div className="player-container" data-testid="player-container">
      <div className="player-glow"></div>

      {/* Visualizer with Album Art */}
      <div style={{ 
        width: '100%', 
        height: '400px', 
        borderRadius: '15px', 
        background: 'rgba(0, 0, 0, 0.3)',
        marginBottom: '2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Audio Visualizer Canvas */}
        <canvas
          ref={canvasRef}
          data-testid="audio-visualizer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 1,
            display: 'block'
          }}
        />
        
        {/* Album Art on top */}
        {(currentAlbumArt || currentTrack?.image) && (
          <img 
            key={currentAlbumArt || currentTrack?.uri}
            src={currentAlbumArt || currentTrack?.image} 
            alt={currentTrackName || currentTrack?.name || 'Album Art'}
            data-testid="album-art"
            style={{
              width: '280px',
              height: '280px',
              borderRadius: '12px',
              objectFit: 'cover',
              boxShadow: '0 20px 60px rgba(139, 92, 246, 0.6), 0 0 80px rgba(251, 191, 36, 0.3)',
              border: '3px solid rgba(251, 191, 36, 0.4)',
              position: 'relative',
              zIndex: 2,
              transition: 'all 0.5s ease'
            }}
          />
        )}
      </div>

      <div className="player-controls">

        {/* Playback info - controls handled by Spotify player below */}
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.9rem', marginTop: '1rem' }}>
          {playingBumper ? 'Bumper playing...' : 'Use the player controls below to play, pause, and skip tracks'}
        </div>

        {/* Spotify Player */}
        <div style={{ marginTop: '2rem', visibility: playingBumper ? 'hidden' : 'visible' }} data-testid="spotify-player-container">
          {spotifyToken && tracks.length > 0 && currentTrack && (
            <SpotifyPlayer
              key={station._id}
              token={spotifyToken}
              uris={tracks.map(t => t.uri)}
              play={isPlaying}
              initialVolume={100}
              getPlayer={(player) => {
                if (player && !spotifyPlayer) {
                  console.log('✓ Spotify player instance captured');
                  setSpotifyPlayer(player);
                  setPlayerReady(true);
                  
                  // Try to connect audio visualizer to Spotify player
                  if (player._player) {
                    connectAudioToVisualizer(player._player);
                  }
                }
              }}
              callback={(state) => {
                if (!state) {
                  return;
                }
                
                const playing = !state.paused;
                setIsPlaying(playing);
                isPlayingRef.current = playing;
                
                // ALWAYS update current track display and album art when available
                if (state.track_window?.current_track) {
                  const spotifyTrack = state.track_window.current_track;
                  const currentUri = spotifyTrack.uri;
                  
                  // Check if track actually changed using ref
                  if (lastTrackUriRef.current !== currentUri) {
                    console.log(`🎵 Track changed! Old: ${lastTrackUriRef.current}, New: ${currentUri}`);
                    lastTrackUriRef.current = currentUri;
                    
                    // Update album art directly from Spotify's state
                    if (spotifyTrack.album?.images?.[0]?.url) {
                      const newAlbumArt = spotifyTrack.album.images[0].url;
                      const newTrackName = spotifyTrack.name;
                      
                      console.log(`🎨 UPDATING Album art for: ${newTrackName}`);
                      console.log(`🖼️ New album art URL: ${newAlbumArt.substring(0, 50)}...`);
                      setCurrentAlbumArt(newAlbumArt);
                      setCurrentTrackName(newTrackName);
                    }
                    
                    // Also update track index for other functionality
                    const newIndex = tracks.findIndex(t => t.uri === currentUri);
                    if (newIndex !== -1) {
                      console.log(`📍 Track index updated to ${newIndex}: ${tracks[newIndex]?.name}`);
                      setCurrentTrackIndex(newIndex);
                    } else {
                      // If track not found in our list, update by name match as fallback
                      const trackByName = tracks.findIndex(t => 
                        t.name === spotifyTrack.name && 
                        t.artist === spotifyTrack.artists[0]?.name
                      );
                      if (trackByName !== -1) {
                        console.log(`📍 Track index updated by name match to ${trackByName}`);
                        setCurrentTrackIndex(trackByName);
                      }
                    }
                  }
                }
                
                // Check if track ended (position is 0 and we just finished playing)
                if (state.position === 0 && state.previousTracks && state.previousTracks.length > 0 && !playingBumper) {
                  const justFinished = state.previousTracks[state.previousTracks.length - 1];
                  
                  // Prevent duplicate processing of the same track
                  if (lastProcessedTrack === justFinished?.uri) {
                    return;
                  }
                  
                  console.log('Track ended:', justFinished?.name);
                  setLastProcessedTrack(justFinished?.uri);
                  
                  // Increment song counter
                  const newCount = songsSinceLastBumper + 1;
                  setSongsSinceLastBumper(newCount);
                  console.log(`Song count: ${newCount} (trigger at 3)`);
                  const songsBeforeBumper = 3;
                  
                  // Find the track that just finished in our list
                  const finishedTrack = tracks.find(t => t.uri === justFinished?.uri);
                  const finishedIndex = tracks.findIndex(t => t.uri === justFinished?.uri);
                  const nextTrack = finishedIndex !== -1 ? tracks[finishedIndex + 1] : null;
                  
                  if (newCount >= songsBeforeBumper && station.bumper_topics?.length > 0 && finishedTrack) {
                    console.log(`🎙️ TRIGGERING BUMPER after ${newCount} songs`);
                    console.log('Last track:', finishedTrack.name, 'by', finishedTrack.artist);
                    console.log('Next track:', nextTrack?.name, 'by', nextTrack?.artist);
                    setSongsSinceLastBumper(0); // Reset counter immediately
                    
                    // Duck volume IMMEDIATELY before any delay
                    if (spotifyPlayer) {
                      console.log('🎚️ Ducking volume immediately');
                      spotifyPlayer.setVolume(0.15);
                    }
                    
                    setTimeout(() => generateAndPlayBumper(finishedTrack, nextTrack), 500);
                  } else {
                    console.log(`Waiting... count=${newCount}, topics=${station.bumper_topics?.length}`);
                  }
                }
              }}
              styles={{
                bgColor: 'rgba(139, 92, 246, 0.1)',
                color: '#FBBF24',
                loaderColor: '#8B5CF6',
                sliderColor: '#8B5CF6',
                trackArtistColor: '#9ca3af',
                trackNameColor: '#FBBF24',
              }}
            />
          )}
        </div>

        {/* Hidden audio element for bumpers */}
        <audio
          ref={bumperAudioRef}
          onEnded={handleBumperEnded}
          data-testid="bumper-audio"
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
};

export default Player;