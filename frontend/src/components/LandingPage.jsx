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
        {/* Animated Visualizer with Text Overlay */}
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
            maxWidth: '450px'
          }}>
            <canvas
              ref={canvasRef}
              style={{
                width: '100%',
                height: '180px',
                borderRadius: '24px',
                background: 'rgba(0, 0, 0, 0.4)',
                boxShadow: '0 0 60px rgba(139, 92, 246, 0.4), inset 0 0 40px rgba(0, 0, 0, 0.6)',
                border: '2px solid rgba(139, 92, 246, 0.3)'
              }}
            />
            {/* Text Overlay */}
            <h1 
              className="landing-title" 
              data-testid="landing-title"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                margin: 0,
                fontSize: '4rem',
                fontFamily: '"aviano-future", sans-serif',
                fontWeight: 700,
                fontStyle: 'normal',
                background: 'linear-gradient(135deg, #FFFFFF 0%, #FBBF24 50%, #8B5CF6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                textShadow: 'none',
                letterSpacing: '0.15em',
                zIndex: 10,
                filter: 'drop-shadow(0 0 20px rgba(251, 191, 36, 0.5)) drop-shadow(0 0 40px rgba(139, 92, 246, 0.3))'
              }}
            >
              YOURFM
            </h1>
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