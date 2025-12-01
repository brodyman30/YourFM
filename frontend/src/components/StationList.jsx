import React from 'react';
import { Trash2, Edit } from 'lucide-react';

const StationList = ({ stations, onStationSelect, onDeleteStation, onEditStation, loading }) => {
  if (loading) {
    return <div className="spinner" data-testid="loading-spinner"></div>;
  }

  if (stations.length === 0) {
    return (
      <div className="text-center" style={{ marginTop: '4rem' }}>
        <h2 style={{ color: '#FBBF24', fontSize: '2rem', marginBottom: '1rem' }}>
          No stations yet
        </h2>
        <p style={{ color: '#9ca3af', fontSize: '1.2rem' }}>
          Create your first custom radio station to get started!
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{
        fontSize: '2.5rem',
        fontWeight: '700',
        color: '#FBBF24',
        marginBottom: '2rem',
        textAlign: 'center'
      }}>
        Your Stations
      </h2>
      <div className="stations-grid" data-testid="stations-grid">
        {stations.map((station) => (
          <div
            key={station.id}
            className="station-card"
            data-testid={`station-card-${station.id}`}
          >
            <div onClick={() => onStationSelect(station)} style={{ cursor: 'pointer' }}>
              <h3 className="station-name" data-testid={`station-name-${station.id}`}>
                {station.name}
              </h3>
              <p className="station-genre" data-testid={`station-genre-${station.id}`}>
                {station.genres ? station.genres.join(' • ') : station.genre}
              </p>
              <p className="station-artists" data-testid={`station-artists-${station.id}`}>
                {station.artists.map(a => typeof a === 'string' ? a : a.name).join(', ')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                data-testid={`edit-station-${station.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditStation(station);
                }}
                style={{
                  background: 'rgba(139, 92, 246, 0.2)',
                  border: '2px solid rgba(139, 92, 246, 0.5)',
                  color: '#8B5CF6',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.3s ease',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  flex: 1
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(139, 92, 246, 0.3)';
                  e.target.style.borderColor = '#8B5CF6';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(139, 92, 246, 0.2)';
                  e.target.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                }}
              >
                <Edit size={16} />
                Edit
              </button>
              <button
                data-testid={`delete-station-${station.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete station "${station.name}"?`)) {
                    onDeleteStation(station.id);
                  }
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '2px solid rgba(239, 68, 68, 0.5)',
                  color: '#ef4444',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.3s ease',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  flex: 1
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'rgba(239, 68, 68, 0.3)';
                  e.target.style.borderColor = '#ef4444';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(239, 68, 68, 0.2)';
                  e.target.style.borderColor = 'rgba(239, 68, 68, 0.5)';
                }}
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StationList;