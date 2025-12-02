import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const StationCreator = ({ station, onStationCreated, onCancel }) => {
  const [formData, setFormData] = useState({
    name: station?.name || '',
    genres: station?.genres || (station?.genre ? [station.genre] : []),
    artists: station?.artists || [],
    bumper_topics: station?.bumper_topics || [],
    voice_id: station?.voice_id || '',
    voice_name: station?.voice_name || ''
  });
  
  const isEditing = !!station;
  
  const [genres, setGenres] = useState([]);
  const [voices, setVoices] = useState([]);
  const [artistSearch, setArtistSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [topicInput, setTopicInput] = useState('');
  const [suggestedArtists, setSuggestedArtists] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  
  // Pre-defined music-focused bumper topics
  const availableTopics = [
    'artist history',
    'album facts',
    'music trivia',
    'genre evolution',
    'song meanings',
    'concert tours',
    'collaborations',
    'awards and achievements',
    'music influences',
    'behind the scenes',
    'chart performance',
    'fan favorites',
    'local weather'  // Real-time weather updates
  ];
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);

  // Request location permission when "local weather" is selected
  const requestLocationPermission = () => {
    return new Promise((resolve) => {
      // Check if we already have cached location
      const cachedLocation = localStorage.getItem('userLocation');
      if (cachedLocation) {
        setLocationGranted(true);
        resolve(true);
        return;
      }

      if (!navigator.geolocation) {
        toast.error('Location not supported by your browser. Weather will use approximate location.');
        resolve(false);
        return;
      }

      toast.info('Requesting location for weather updates...');
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const locationString = `${latitude},${longitude}`;
          localStorage.setItem('userLocation', locationString);
          setLocationGranted(true);
          toast.success('Location enabled! Weather updates will use your location.');
          resolve(true);
        },
        (error) => {
          console.log('Location permission denied:', error.message);
          toast.warning('Location denied. Weather will use approximate location based on IP.');
          resolve(false);
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 3600000
        }
      );
    });
  };

  // Handle topic selection with special handling for location-based features
  const handleTopicSelect = async (topic) => {
    if (formData.bumper_topics.includes(topic)) return;
    
    // If selecting "local weather" or "concert tours", request location permission first
    if (topic === 'local weather' || topic === 'concert tours') {
      await requestLocationPermission();
    }
    
    setFormData({
      ...formData,
      bumper_topics: [...formData.bumper_topics, topic]
    });
  };

  useEffect(() => {
    loadGenres();
    loadVoices();
  }, []);

  // Load suggested artists when genres change
  useEffect(() => {
    if (formData.genres.length > 0) {
      loadSuggestedArtists();
    } else {
      setSuggestedArtists([]);
    }
  }, [formData.genres]);

  const loadGenres = async () => {
    try {
      const response = await axios.get(`${API}/spotify/genres`);
      setGenres(response.data.genres);
    } catch (error) {
      console.error('Error loading genres:', error);
      toast.error('Failed to load genres');
    }
  };

  const loadVoices = async () => {
    try {
      const response = await axios.get(`${API}/elevenlabs/voices`);
      setVoices(response.data.voices);
    } catch (error) {
      console.error('Error loading voices:', error);
      toast.error('Failed to load voices. Please check ElevenLabs API key.');
    }
  };

  const loadSuggestedArtists = async () => {
    try {
      setLoadingSuggestions(true);
      const genresParam = formData.genres.join(',');
      const response = await axios.get(`${API}/spotify/artists/by-genre?genres=${genresParam}`);
      setSuggestedArtists(response.data.artists);
    } catch (error) {
      console.error('Error loading suggested artists:', error);
      toast.error('Failed to load artist suggestions');
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const searchArtists = async () => {
    if (!artistSearch) {
      toast.error('Please enter an artist name');
      return;
    }

    try {
      setSearching(true);
      // Search without genre filter - let users find any artist
      const response = await axios.post(
        `${API}/spotify/search/artists?query=${artistSearch}`
      );
      setSearchResults(response.data.artists);
    } catch (error) {
      console.error('Error searching artists:', error);
      toast.error('Failed to search artists');
    } finally {
      setSearching(false);
    }
  };

  const addArtist = (artist) => {
    // Check if artist already added by ID
    if (!formData.artists.find(a => a.id === artist.id)) {
      setFormData({ ...formData, artists: [...formData.artists, { id: artist.id, name: artist.name }] });
      setArtistSearch('');
      setSearchResults([]);
    }
  };

  const removeArtist = (artistId) => {
    setFormData({
      ...formData,
      artists: formData.artists.filter(a => a.id !== artistId)
    });
  };

  const addTopic = () => {
    if (topicInput && !formData.bumper_topics.includes(topicInput)) {
      setFormData({
        ...formData,
        bumper_topics: [...formData.bumper_topics, topicInput]
      });
      setTopicInput('');
    }
  };

  const removeTopic = (topic) => {
    setFormData({
      ...formData,
      bumper_topics: formData.bumper_topics.filter(t => t !== topic)
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name || formData.genres.length === 0 || formData.artists.length === 0 || !formData.voice_id) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      if (isEditing) {
        // Update existing station
        const response = await axios.put(`${API}/stations/${station.id}`, formData);
        onStationCreated(response.data);
      } else {
        // Create new station
        const response = await axios.post(`${API}/stations`, formData);
        onStationCreated(response.data);
      }
    } catch (error) {
      console.error(`Error ${isEditing ? 'updating' : 'creating'} station:`, error);
      toast.error(`Failed to ${isEditing ? 'update' : 'create'} station`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-container" data-testid="station-creator-form">
      <h2 className="form-title">{isEditing ? 'Edit Your Station' : 'Create Your Station'}</h2>
      
      <form onSubmit={handleSubmit}>
        {/* Station Name */}
        <div className="form-group">
          <label className="form-label">Station Name *</label>
          <input
            data-testid="station-name-input"
            type="text"
            className="form-input"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="My Awesome Station"
          />
        </div>

        {/* Genre Selection */}
        <div className="form-group">
          <label className="form-label">Genres * (Select 1-3 genres)</label>
          <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Choose the music styles for your station
          </p>
          
          {/* Genre Grid */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1.5rem'
          }}>
            {genres.map((genre) => (
              <button
                key={genre}
                type="button"
                data-testid={`genre-option-${genre}`}
                onClick={() => {
                  if (formData.genres.includes(genre)) {
                    // Remove genre
                    setFormData({
                      ...formData,
                      genres: formData.genres.filter(g => g !== genre)
                    });
                  } else if (formData.genres.length < 3) {
                    // Add genre (max 3)
                    setFormData({
                      ...formData,
                      genres: [...formData.genres, genre]
                    });
                  }
                }}
                style={{
                  background: formData.genres.includes(genre) 
                    ? 'rgba(139, 92, 246, 0.3)' 
                    : 'rgba(139, 92, 246, 0.1)',
                  border: formData.genres.includes(genre)
                    ? '2px solid #8B5CF6'
                    : '2px solid rgba(139, 92, 246, 0.3)',
                  color: formData.genres.includes(genre) ? '#FBBF24' : '#8B5CF6',
                  padding: '0.75rem',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  textTransform: 'capitalize',
                  opacity: (!formData.genres.includes(genre) && formData.genres.length >= 3) ? 0.5 : 1
                }}
                onMouseEnter={(e) => {
                  if (!formData.genres.includes(genre) && formData.genres.length < 3) {
                    e.target.style.background = 'rgba(139, 92, 246, 0.2)';
                    e.target.style.borderColor = '#8B5CF6';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!formData.genres.includes(genre)) {
                    e.target.style.background = 'rgba(139, 92, 246, 0.1)';
                    e.target.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                  }
                }}
              >
                {genre}
              </button>
            ))}
          </div>

          {/* Selected Genres Display */}
          {formData.genres.length > 0 && (
            <>
              <label style={{ color: '#FBBF24', fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' }}>
                Selected Genres:
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }} data-testid="selected-genres">
                {formData.genres.map((genre) => (
                  <span
                    key={genre}
                    data-testid={`selected-genre-${genre}`}
                    style={{
                      background: 'rgba(139, 92, 246, 0.2)',
                      border: '2px solid #8B5CF6',
                      color: '#FBBF24',
                      padding: '0.5rem 1rem',
                      borderRadius: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.9rem',
                      textTransform: 'capitalize'
                    }}
                  >
                    {genre}
                    <X
                      size={16}
                      onClick={() => setFormData({
                        ...formData,
                        genres: formData.genres.filter(g => g !== genre)
                      })}
                      style={{ cursor: 'pointer' }}
                      data-testid={`remove-genre-${genre}`}
                    />
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Suggested Artists (Based on Selected Genres) */}
        {formData.genres.length > 0 && (
          <div className="form-group">
            <label className="form-label">Suggested Artists from {formData.genres.join(', ')}</label>
            <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Popular artists in your selected genres - click to add
            </p>
            
            {loadingSuggestions ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#8B5CF6' }}>
                Loading suggestions...
              </div>
            ) : suggestedArtists.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: '1rem',
                marginBottom: '2rem'
              }}>
                {suggestedArtists.map((artist) => (
                  <div
                    key={artist.id}
                    data-testid={`suggested-artist-${artist.id}`}
                    onClick={() => addArtist(artist)}
                    style={{
                      cursor: 'pointer',
                      textAlign: 'center',
                      padding: '1rem',
                      borderRadius: '12px',
                      background: 'rgba(139, 92, 246, 0.05)',
                      border: '2px solid rgba(139, 92, 246, 0.2)',
                      transition: 'all 0.2s',
                      opacity: formData.artists.find(a => a.id === artist.id) ? 0.5 : 1
                    }}
                    onMouseEnter={(e) => {
                      if (!formData.artists.find(a => a.id === artist.id)) {
                        e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';
                        e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(139, 92, 246, 0.05)';
                      e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.2)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    {artist.image ? (
                      <img 
                        src={artist.image} 
                        alt={artist.name}
                        style={{
                          width: '80px',
                          height: '80px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          margin: '0 auto 0.5rem',
                          border: '3px solid rgba(251, 191, 36, 0.5)'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '50%',
                        background: 'rgba(139, 92, 246, 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '2rem',
                        color: '#FBBF24',
                        margin: '0 auto 0.5rem'
                      }}>
                        🎵
                      </div>
                    )}
                    <div style={{ 
                      fontWeight: '600', 
                      color: '#FBBF24', 
                      fontSize: '0.9rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {artist.name}
                    </div>
                    {formData.artists.find(a => a.id === artist.id) && (
                      <div style={{ color: '#8B5CF6', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                        ✓ Added
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Artist Search */}
        <div className="form-group">
          <label className="form-label">Or Search for Any Artist</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              data-testid="artist-search-input"
              type="text"
              className="form-input"
              value={artistSearch}
              onChange={(e) => setArtistSearch(e.target.value)}
              placeholder="Search for any artist..."
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), searchArtists())}
            />
            <button
              data-testid="search-artists-btn"
              type="button"
              onClick={searchArtists}
              disabled={searching}
              style={{
                background: '#8B5CF6',
                border: 'none',
                color: 'white',
                padding: '1rem 1.5rem',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {/* Search Results with Images */}
          {searchResults.length > 0 && (
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '2px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '12px',
              padding: '1rem',
              marginBottom: '1rem',
              maxHeight: '400px',
              overflowY: 'auto'
            }}>
              {searchResults.map((artist) => (
                <div
                  key={artist.id}
                  data-testid={`artist-result-${artist.id}`}
                  onClick={() => addArtist(artist)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '0.75rem',
                    cursor: 'pointer',
                    borderRadius: '8px',
                    transition: 'all 0.2s',
                    marginBottom: '0.5rem',
                    border: '2px solid transparent'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                >
                  {artist.image ? (
                    <img 
                      src={artist.image} 
                      alt={artist.name}
                      style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '2px solid rgba(251, 191, 36, 0.5)'
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '50px',
                      height: '50px',
                      borderRadius: '50%',
                      background: 'rgba(139, 92, 246, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.5rem',
                      color: '#FBBF24'
                    }}>
                      🎵
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', color: '#FBBF24', marginBottom: '0.25rem' }}>
                      {artist.name}
                    </div>
                    {artist.genres && artist.genres.length > 0 && (
                      <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                        {artist.genres.slice(0, 2).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Selected Artists */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }} data-testid="selected-artists">
            {formData.artists.map((artist) => (
              <span
                key={artist.id}
                data-testid={`selected-artist-${artist.name}`}
                style={{
                  background: 'rgba(139, 92, 246, 0.2)',
                  border: '2px solid #8B5CF6',
                  color: '#FBBF24',
                  padding: '0.5rem 1rem',
                  borderRadius: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9rem'
                }}
              >
                {artist.name}
                <X
                  size={16}
                  onClick={() => removeArtist(artist.id)}
                  style={{ cursor: 'pointer' }}
                  data-testid={`remove-artist-${artist.name}`}
                />
              </span>
            ))}
          </div>
        </div>

        {/* Voice Selection */}
        <div className="form-group">
          <label className="form-label">Voice *</label>
          <select
            data-testid="voice-select"
            className="form-input"
            value={formData.voice_id}
            onChange={(e) => {
              const voice = voices.find(v => v.voice_id === e.target.value);
              setFormData({
                ...formData,
                voice_id: e.target.value,
                voice_name: voice ? voice.name : ''
              });
            }}
          >
            <option value="">Select a voice</option>
            {voices.map(voice => (
              <option key={voice.voice_id} value={voice.voice_id}>
                {voice.name}
              </option>
            ))}
          </select>
        </div>

        {/* Bumper Topics */}
        <div className="form-group">
          <label className="form-label">Bumper Topics (Optional)</label>
          <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Choose what your DJ talks about between songs
          </p>
          
          {/* Available Topics Grid */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1.5rem'
          }}>
            {availableTopics.map((topic) => (
              <button
                key={topic}
                type="button"
                data-testid={`topic-option-${topic}`}
                onClick={() => handleTopicSelect(topic)}
                disabled={formData.bumper_topics.includes(topic)}
                style={{
                  background: formData.bumper_topics.includes(topic) 
                    ? 'rgba(251, 191, 36, 0.3)' 
                    : 'rgba(139, 92, 246, 0.1)',
                  border: formData.bumper_topics.includes(topic)
                    ? '2px solid #FBBF24'
                    : '2px solid rgba(139, 92, 246, 0.3)',
                  color: formData.bumper_topics.includes(topic) ? '#FBBF24' : '#8B5CF6',
                  padding: '0.75rem',
                  borderRadius: '12px',
                  cursor: formData.bumper_topics.includes(topic) ? 'default' : 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  textTransform: 'capitalize',
                  opacity: formData.bumper_topics.includes(topic) ? 0.6 : 1
                }}
                onMouseEnter={(e) => {
                  if (!formData.bumper_topics.includes(topic)) {
                    e.target.style.background = 'rgba(139, 92, 246, 0.2)';
                    e.target.style.borderColor = '#8B5CF6';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!formData.bumper_topics.includes(topic)) {
                    e.target.style.background = 'rgba(139, 92, 246, 0.1)';
                    e.target.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                  }
                }}
              >
                {topic}
              </button>
            ))}
          </div>

          {/* Selected Topics */}
          {formData.bumper_topics.length > 0 && (
            <>
              <label style={{ color: '#FBBF24', fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' }}>
                Selected Topics:
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }} data-testid="selected-topics">
                {formData.bumper_topics.map((topic) => (
                  <span
                    key={topic}
                    data-testid={`selected-topic-${topic}`}
                    style={{
                      background: 'rgba(251, 191, 36, 0.2)',
                      border: '2px solid #FBBF24',
                      color: '#FBBF24',
                      padding: '0.5rem 1rem',
                      borderRadius: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.9rem',
                      textTransform: 'capitalize'
                    }}
                  >
                    {topic}
                    <X
                      size={16}
                      onClick={() => removeTopic(topic)}
                      style={{ cursor: 'pointer' }}
                      data-testid={`remove-topic-${topic}`}
                    />
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Submit Buttons */}
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            data-testid="create-station-btn"
            type="submit"
            className="form-button"
            disabled={loading}
          >
            {loading ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Station' : 'Create Station')}
          </button>
          <button
            data-testid="cancel-btn"
            type="button"
            onClick={onCancel}
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '2px solid rgba(239, 68, 68, 0.5)',
              color: '#ef4444',
              padding: '1.2rem',
              borderRadius: '12px',
              cursor: 'pointer',
              fontWeight: '700',
              flex: '0 0 auto'
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default StationCreator;