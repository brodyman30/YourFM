import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Player crashed:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-center" style={{ marginTop: '4rem' }} data-testid="player-error-fallback">
          <h2 style={{ color: '#FBBF24', fontSize: '2rem', marginBottom: '1rem' }}>
            The player hit a snag
          </h2>
          <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>
            Something interrupted playback. Head back and pick your station again.
          </p>
          <button
            data-testid="player-error-back-btn"
            onClick={this.handleReset}
            style={{
              background: '#FBBF24',
              color: '#1a1a1a',
              border: 'none',
              padding: '0.9rem 2rem',
              borderRadius: '999px',
              cursor: 'pointer',
              fontWeight: '700'
            }}
          >
            Back to Stations
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
