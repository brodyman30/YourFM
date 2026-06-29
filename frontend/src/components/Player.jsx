import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Play, Pause, SkipForward } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const SONGS_BEFORE_BUMPER = 3;

const Player = ({ station, clientId, active = true }) => {
  const [play, setPlay] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bumperText, setBumperText] = useState(null);
  const [playingBumper, setPlayingBumper] = useState(false);
  const [songCount, setSongCount] = useState(0);
  const [skipping, setSkipping] = useState(false);

  const audioRef = useRef(null);
  const bumperRef = useRef(null);
  const startedRef = useRef({});
  const songCountRef = useRef(0);
  const advancingRef = useRef(false);
  const autoplayNextRef = useRef(false);
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  // Load first track when station changes
  useEffect(() => {
    if (!station || !clientId) return;
    resetAndLoad();
    return () => {
      try { audioRef.current?.pause(); } catch (e) {}
      try { bumperRef.current?.pause(); } catch (e) {}
    };
  }, [station?.id, clientId]);

  // Pause when navigating away from the player
  useEffect(() => {
    if (!active) {
      try { audioRef.current?.pause(); } catch (e) {}
      try { bumperRef.current?.pause(); } catch (e) {}
    }
  }, [active]);

  // Autoplay newly fetched track when requested
  useEffect(() => {
    if (play && autoplayNextRef.current && audioRef.current) {
      autoplayNextRef.current = false;
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [play]);

  // Decorative visualizer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 600;
    canvas.height = 120;
    let t = 0;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const speed = isPlaying || playingBumper ? 0.05 : 0.012;
      t += speed;
      const cy = canvas.height / 2;
      const layers = [
        { c: 'rgba(139,92,246,0.25)', a: 28, f: 0.02, p: 0, w: 8 },
        { c: 'rgba(251,191,36,0.5)', a: 22, f: 0.03, p: 1, w: 4 },
        { c: 'rgba(251,191,36,0.85)', a: 14, f: 0.035, p: 1.5, w: 2 }
      ];
      layers.forEach((L) => {
        ctx.beginPath();
        ctx.strokeStyle = L.c;
        ctx.lineWidth = L.w;
        ctx.lineCap = 'round';
        for (let x = 0; x <= canvas.width; x += 3) {
          const y = cy + Math.sin(x * L.f + t + L.p) * L.a + Math.sin(x * L.f * 1.5 - t * 0.8) * (L.a * 0.4);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      animRef.current = requestAnimationFrame(animate);
    };
    animate();
    return () => animRef.current && cancelAnimationFrame(animRef.current);
  }, [isPlaying, playingBumper]);

  const resetAndLoad = async () => {
    setLoading(true);
    setPlay(null);
    setBumperText(null);
    setPlayingBumper(false);
    setSongCount(0);
    songCountRef.current = 0;
    startedRef.current = {};
    await fetchTrack(false);
    setLoading(false);
  };

  const fetchTrack = async (autoplay) => {
    try {
      const res = await axios.post(`${API}/feedfm/play`, null, {
        params: { client_id: clientId, station_id: station.feedfm_station_id }
      });
      if (!res.data || res.data.success === false || !res.data.play) {
        toast.info('No more music available on this station right now.');
        return null;
      }
      autoplayNextRef.current = !!autoplay;
      setPlay(res.data.play);
      return res.data.play;
    } catch (e) {
      console.error('fetchTrack error:', e);
      toast.error('Could not load the next track.');
      return null;
    }
  };

  const reportEvent = async (playId, action) => {
    try {
      await axios.post(`${API}/feedfm/play/${playId}/${action}`, null, { params: { client_id: clientId } });
    } catch (e) { /* non-fatal */ }
  };

  const handleAudioPlay = () => {
    setIsPlaying(true);
    if (play && !startedRef.current[play.id]) {
      startedRef.current[play.id] = true;
      reportEvent(play.id, 'start');
    }
  };

  const handleAudioEnded = async () => {
    if (!play || advancingRef.current) return;
    advancingRef.current = true;
    const finished = play;
    await reportEvent(finished.id, 'complete');

    const newCount = songCountRef.current + 1;
    songCountRef.current = newCount;
    setSongCount(newCount);

    const shouldBumper = station.bumper_topics && station.bumper_topics.length > 0 && newCount >= SONGS_BEFORE_BUMPER;
    if (shouldBumper) {
      songCountRef.current = 0;
      setSongCount(0);
      await playBumper(finished);
    }
    await fetchTrack(true);
    advancingRef.current = false;
  };

  const playBumper = async (finishedPlay) => {
    try {
      const af = finishedPlay.audio_file || {};
      setPlayingBumper(true);
      const res = await axios.post(`${API}/bumpers/generate`, {
        station_id: station.id,
        topics: station.bumper_topics,
        genres: station.genres && station.genres.length ? station.genres : (station.feedfm_station_name ? [station.feedfm_station_name] : []),
        artists: [],
        voice_id: station.voice_id,
        current_track_name: af.track?.title || '',
        current_track_artist: af.artist?.name || ''
      });
      setBumperText(res.data.text);
      const audioUrl = res.data.audio_url;
      if (audioUrl && bumperRef.current) {
        await new Promise((resolve) => {
          const b = bumperRef.current;
          b.src = audioUrl;
          b.onended = resolve;
          b.onerror = resolve;
          b.play().catch(resolve);
        });
      }
    } catch (e) {
      console.error('Bumper error:', e);
    } finally {
      setPlayingBumper(false);
      setBumperText(null);
    }
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };

  const handleSkip = async () => {
    if (!play || skipping || playingBumper) return;
    setSkipping(true);
    try {
      const res = await axios.post(`${API}/feedfm/play/${play.id}/skip`, null, { params: { client_id: clientId } });
      if (res.data && res.data.success === false) {
        toast.info('Skip not allowed right now (radio rules).');
      } else {
        await fetchTrack(true);
      }
    } catch (e) {
      toast.info('Skip limit reached for now.');
    } finally {
      setSkipping(false);
    }
  };

  if (loading) {
    return <div className="spinner" data-testid="player-loading"></div>;
  }

  const af = play?.audio_file || {};
  const albumArt = af.extra?.artwork || af.extra?.image || af.extra?.background_image_url || null;
  const title = af.track?.title || 'Unknown';
  const artistName = af.artist?.name || '';
  const albumName = af.release?.title || '';

  return (
    <div className="player-container" data-testid="player-container">
      <div className="player-glow"></div>

      <audio
        ref={audioRef}
        src={play?.audio_file?.url}
        onPlay={handleAudioPlay}
        onPause={() => setIsPlaying(false)}
        onEnded={handleAudioEnded}
        data-testid="music-audio"
      />
      <audio ref={bumperRef} data-testid="bumper-audio" />

      {/* Now playing card */}
      <div style={{ textAlign: 'center', maxWidth: '640px', margin: '0 auto' }} data-testid="now-playing">
        <div style={{
          fontSize: '0.8rem', letterSpacing: '0.2em', color: '#8B5CF6',
          textTransform: 'uppercase', marginBottom: '0.75rem', fontWeight: 700
        }}>
          {station.name} · {station.feedfm_station_name}
        </div>

        <div style={{
          width: '260px', height: '260px', margin: '0 auto 1.5rem',
          borderRadius: '20px', overflow: 'hidden',
          background: albumArt ? `url(${albumArt}) center/cover` : 'linear-gradient(135deg, #8B5CF6, #FBBF24)',
          boxShadow: '0 0 60px rgba(251,191,36,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} data-testid="album-art">
          {!albumArt && <span style={{ fontSize: '4rem' }}>🎵</span>}
        </div>

        {playingBumper && (
          <div data-testid="bumper-banner" style={{
            background: 'rgba(251,191,36,0.12)', border: '2px solid rgba(251,191,36,0.5)',
            borderRadius: '12px', padding: '0.9rem 1.2rem', marginBottom: '1.25rem', color: '#FBBF24'
          }}>
            <strong>🎙️ Your DJ is on the air…</strong>
            {bumperText && <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#fde68a' }}>{bumperText}</div>}
          </div>
        )}

        <h2 style={{ color: '#FBBF24', fontSize: '1.8rem', margin: '0 0 0.4rem' }} data-testid="track-title">{title}</h2>
        <p style={{ color: '#e5e7eb', fontSize: '1.1rem', margin: '0 0 0.2rem' }} data-testid="track-artist">{artistName}</p>
        {albumName && <p style={{ color: '#9ca3af', fontSize: '0.9rem', margin: 0 }}>{albumName}</p>}

        <canvas ref={canvasRef} style={{ width: '100%', height: '120px', margin: '1.5rem 0' }} />

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
          <button
            data-testid="play-pause-btn"
            onClick={togglePlay}
            disabled={playingBumper}
            style={{
              width: '72px', height: '72px', borderRadius: '50%', border: 'none',
              background: '#FBBF24', color: '#1a1a1a', cursor: playingBumper ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 30px rgba(251,191,36,0.5)', opacity: playingBumper ? 0.5 : 1
            }}
          >
            {isPlaying ? <Pause size={32} fill="#1a1a1a" /> : <Play size={32} fill="#1a1a1a" />}
          </button>
          <button
            data-testid="skip-btn"
            onClick={handleSkip}
            disabled={skipping || playingBumper}
            style={{
              width: '56px', height: '56px', borderRadius: '50%',
              border: '2px solid rgba(251,191,36,0.5)', background: 'transparent', color: '#FBBF24',
              cursor: (skipping || playingBumper) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <SkipForward size={24} />
          </button>
        </div>
        <p style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: '1.25rem' }} data-testid="song-count">
          {station.bumper_topics && station.bumper_topics.length > 0
            ? `DJ break in ${Math.max(0, SONGS_BEFORE_BUMPER - songCount)} song(s)`
            : 'AI DJ breaks off'}
        </p>
      </div>
    </div>
  );
};

export default Player;
