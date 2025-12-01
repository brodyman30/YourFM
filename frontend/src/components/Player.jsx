import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Play, Pause, SkipForward, Volume2 } from 'lucide-react';
import SpotifyPlayer from 'react-spotify-web-playback';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Player = ({ station, spotifyToken }) => {
  const [tracks, setTracks] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentBumper, setCurrentBumper] = useState(null);
  const [playingBumper, setPlayingBumper] = useState(false);
  const [loading, setLoading] = useState(true);
  const [songsSinceLastBumper, setSongsSinceLastBumper] = useState(0);
  const [lastProcessedTrack, setLastProcessedTrack] = useState(null);
  const [spotifyPlayer, setSpotifyPlayer] = useState(null);
  const [currentAlbumArt, setCurrentAlbumArt] = useState(null);
  const [currentTrackName, setCurrentTrackName] = useState('');
  const [audioFeatures, setAudioFeatures] = useState(null);
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const animationRef = useRef(null);
  const bumperAudioRef = useRef(null);
  const lastTrackUriRef = useRef(null);
  const isPlayingRef = useRef(true);
  const beatPhaseRef = useRef(0);

  useEffect(() => {
    if (station) {
      loadTracks();
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
          
          // Fetch audio features for visualizer
          const trackId = track.uri.split(':')[2];
          fetchAudioFeatures(trackId);
          
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

  const fetchAudioFeatures = async (trackId) => {
    try {
      console.log('🎵 Fetching audio features for track:', trackId);
      const response = await axios.get(`${API}/spotify/audio-features/${trackId}`);
      console.log('✅ Audio features received:', response.data);
      setAudioFeatures(response.data);
    } catch (error) {
      console.error('❌ Error fetching audio features:', error);
      // Set default values so visualizer still works
      setAudioFeatures({
        tempo: 120,
        energy: 0.6,
        danceability: 0.6
      });
    }
  };

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
    try {
      setLoading(true);
      const response = await axios.post(
        `${API}/spotify/tracks`,
        { 
          artists: station.artists,
          genres: station.genres || (station.genre ? [station.genre] : [])
        }
      );
      setTracks(response.data.tracks);
      setIsPlaying(true); // Auto-play when tracks load
    } catch (error) {
      console.error('Error loading tracks:', error);
      toast.error('Failed to load tracks');
    } finally {
      setLoading(false);
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

    // Audio context will be initialized when Spotify player connects
    // See connectAudioToVisualizer function
    if (!audioContextRef.current) {
      console.log('⏳ Waiting for Spotify player to connect audio...');
    } else {
      console.log('✅ Audio context already initialized');
    }

    const barCount = 80;
    const barHeights = new Array(barCount).fill(0);
    let time = 0;

    // Beat-synced visualizer using Spotify audio features
    const animate = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / barCount) - 2;

      // Log state occasionally for debugging
      if (Math.floor(time * 10) % 100 === 0) {
        console.log('Visualizer state:', {
          isPlaying: isPlayingRef.current,
          hasFeatures: !!audioFeatures,
          features: audioFeatures
        });
      }

      if (isPlayingRef.current && audioFeatures) {
        // Use Spotify audio features for beat-sync
        const tempo = audioFeatures.tempo; // BPM
        const energy = audioFeatures.energy; // 0-1
        const danceability = audioFeatures.danceability; // 0-1
        
        // Calculate beat timing
        const beatInterval = 60 / tempo; // seconds per beat
        time += 1/60; // increment by frame time (60fps)
        
        // Calculate where we are in the current beat (0 to 1)
        const beatPhase = (time % beatInterval) / beatInterval;
        
        // Create a pulse that peaks at the start of each beat
        // Using smooth sine wave for natural feel
        const beatPulse = Math.sin(beatPhase * Math.PI * 2) * 0.5 + 0.5;
        const beatStrength = beatPulse; // 0-1, peaks at 1 on beat
        
        for (let i = 0; i < barCount; i++) {
          const freqPos = i / barCount; // 0 to 1
          
          let intensity = 0;
          
          // Bass (left side) - strongest on beats
          if (freqPos < 0.3) {
            intensity = (1 - freqPos / 0.3) * energy * beatStrength * 0.9;
          }
          // Mids (center) - medium response
          else if (freqPos <= 0.7) {
            const midPos = (freqPos - 0.3) / 0.4;
            intensity = Math.sin(midPos * Math.PI) * danceability * beatStrength * 0.7;
          }
          // Treble (right side) - lighter response
          else {
            intensity = ((freqPos - 0.7) / 0.3) * (energy * 0.7) * beatStrength * 0.5;
          }
          
          // Calculate target height
          const minHeight = canvas.height * 0.08;
          const maxHeight = canvas.height * 0.75;
          const targetHeight = minHeight + (intensity * (maxHeight - minHeight));
          
          // Smooth interpolation
          barHeights[i] += (targetHeight - barHeights[i]) * 0.25;

          const barHeight = barHeights[i];
          const x = i * (barWidth + 2);
          const y = canvas.height - barHeight;

          // Gradient
          const gradient = ctx.createLinearGradient(x, canvas.height, x, y);
          gradient.addColorStop(0, '#8B5CF6');
          gradient.addColorStop(0.5, '#A78BFA');
          gradient.addColorStop(1, '#FBBF24');

          ctx.fillStyle = gradient;
          ctx.fillRect(x, y, barWidth, barHeight);

          // Glow on taller bars
          if (barHeight > canvas.height * 0.3) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(251, 191, 36, 0.4)';
            ctx.fillRect(x, y, barWidth, barHeight);
            ctx.shadowBlur = 0;
          }
        }
      } else {
        // Static bars when paused or no audio features
        for (let i = 0; i < barCount; i++) {
          const targetHeight = canvas.height * 0.08;
          barHeights[i] = targetHeight;
          
          const x = i * (barWidth + 2);
          const y = canvas.height - targetHeight;
          
          ctx.fillStyle = '#8B5CF6';
          ctx.fillRect(x, y, barWidth, targetHeight);
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    console.log('🎬 Starting audio-reactive animation');
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
      
      const requestData = {
        station_id: station.id,
        topics: station.bumper_topics || [],
        genres: station.genres || (station.genre ? [station.genre] : []),
        artists: station.artists,
        voice_id: station.voice_id,
        current_track_name: trackToReference?.name || '',
        current_track_artist: trackToReference?.artist || '',
        next_track_name: nextTrackInfo?.name || '',
        next_track_artist: nextTrackInfo?.artist || ''
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
              token={spotifyToken}
              uris={tracks.map(t => t.uri)}
              offset={currentTrackIndex}
              play={isPlaying}
              getPlayer={(player) => {
                if (player && !spotifyPlayer) {
                  console.log('✓ Spotify player instance captured');
                  setSpotifyPlayer(player);
                  
                  // Try to connect audio visualizer to Spotify player
                  if (player._player) {
                    connectAudioToVisualizer(player._player);
                  }
                }
              }}
              callback={(state) => {
                if (!state) {
                  console.log('Spotify state is null');
                  return;
                }
                
                console.log('Spotify callback - playing:', !state.paused, 'position:', state.position, 'duration:', state.duration);
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