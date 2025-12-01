import React from 'react';

const LandingPage = ({ onSpotifyLogin }) => {
  return (
    <div className="landing-page" data-testid="landing-page">
      <div className="landing-bg"></div>
      <div className="landing-content">
        <h1 className="landing-title" data-testid="landing-title">YOURFM</h1>
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