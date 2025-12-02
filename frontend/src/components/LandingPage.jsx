import React, { useRef, useEffect } from 'react';

const LandingPage = ({ onSpotifyLogin }) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    const updateCanvasSize = () => {
      canvas.width = 400;
      canvas.height = 150;
    };
    
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    let time = 0;

    // Animated wave visualizer for landing page
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      time += 0.015; // Smooth animation speed
      
      const centerY = canvas.height / 2;
      const waves = [
        // Wave layers (color, amplitude, frequency, phase, lineWidth)
        { color: 'rgba(139, 92, 246, 0.25)', amplitude: 35, frequency: 0.02, phase: 0, lineWidth: 10 },      // Purple outer
        { color: 'rgba(167, 139, 250, 0.4)', amplitude: 30, frequency: 0.025, phase: 0.5, lineWidth: 7 },   // Light purple
        { color: 'rgba(251, 191, 36, 0.5)', amplitude: 25, frequency: 0.03, phase: 1, lineWidth: 5 },       // Yellow
        { color: 'rgba(251, 191, 36, 0.8)', amplitude: 18, frequency: 0.035, phase: 1.5, lineWidth: 3 }     // Bright yellow inner
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
        ctx.shadowBlur = 20;
        ctx.shadowColor = wave.color;
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', updateCanvasSize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div className="landing-page" data-testid="landing-page">
      <div className="landing-bg"></div>
      <div className="landing-content">
        {/* Animated Visualizer with Stacked Text Logo */}
        <div style={{
          marginBottom: '2rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative'
        }}>
          <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: '550px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            {/* Canvas for waves - positioned behind */}
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                width: '100%',
                height: '200px',
                zIndex: 1
              }}
            />
            
            {/* Circular Logo Emblem */}
            <div style={{
              position: 'relative',
              zIndex: 10,
              width: '180px',
              height: '180px',
              borderRadius: '50%',
              background: 'linear-gradient(180deg, #1a1033 0%, #2d1f4e 100%)',
              border: '6px solid #FBBF24',
              boxShadow: '0 0 40px rgba(251, 191, 36, 0.4), 0 0 80px rgba(139, 92, 246, 0.3), inset 0 0 30px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '20px'
            }}>
              {/* YOUR text - smaller */}
              <span style={{
                fontFamily: '"aviano-future", sans-serif',
                fontSize: '1.4rem',
                fontWeight: 700,
                color: '#FBBF24',
                letterSpacing: '0.2em',
                textShadow: '0 0 10px rgba(251, 191, 36, 0.6)',
                marginBottom: '-5px'
              }}>
                YOUR
              </span>
              {/* FM text - larger */}
              <span style={{
                fontFamily: '"aviano-future", sans-serif',
                fontSize: '4rem',
                fontWeight: 700,
                color: '#FBBF24',
                letterSpacing: '0.1em',
                textShadow: '0 0 20px rgba(251, 191, 36, 0.8), 0 0 40px rgba(251, 191, 36, 0.4)',
                lineHeight: 1
              }}>
                FM
              </span>
            </div>
          </div>
        </div>
        <p className="landing-subtitle" data-testid="landing-subtitle">
          Create your personalized radio station with AI-powered bumpers,
          custom voices, and your favorite Spotify tracks.
          Experience music like never before.
        </p>
        <button
          data-testid="spotify-login-btn"
          className="cta-button"
          onClick={onSpotifyLogin}
        >
          <span style={{ position: 'relative', zIndex: 1 }}>Connect with Spotify</span>
        </button>
        <p style={{ marginTop: '2rem', color: '#9ca3af', fontSize: '0.9rem' }}>
          Requires Spotify Premium
        </p>
      </div>
    </div>
  );
};

export default LandingPage;