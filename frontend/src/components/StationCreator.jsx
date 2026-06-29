import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { X, Radio } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const availableTopics = [
  'artist history', 'album facts', 'music trivia', 'genre evolution',
  'song meanings', 'collaborations', 'awards and achievements',
  'music influences', 'behind the scenes', 'chart performance',
  'fan favorites', 'local weather', 'concert tours'
];

const StationCreator = ({ station, feedStations = [], onStationCreated, onCancel }) => {
  const isEditing = !!station;

  const [formData, setFormData] = useState({
    name: station?.name || '',
    feedfm_station_id: station?.feedfm_station_id || '',
    feedfm_station_name: station?.feedfm_station_name || '',
    bumper_topics: station?.bumper_topics || [],
    voice_id: station?.voice_id || '',
    voice_name: station?.voice_name || ''
  });

  const [voices, setVoices] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadVoices();
  }, []);

  const loadVoices = async () => {
    try {
      const response = await axios.get(`${API}/elevenlabs/voices`);
      setVoices(response.data.voices || []);
    } catch (error) {
      console.error('Error loading voices:', error);
      toast.error('Failed to load voices. Please check ElevenLabs API key.');
    }
  };

  const selectStation = (fs) => {
    setFormData({ ...formData, feedfm_station_id: String(fs.id), feedfm_station_name: fs.name });
  };

  const toggleTopic = (topic) => {
    setFormData((prev) => ({
      ...prev,
      bumper_topics: prev.bumper_topics.includes(topic)
        ? prev.bumper_topics.filter(t => t !== topic)
        : [...prev.bumper_topics, topic]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.feedfm_station_id || !formData.voice_id) {
      toast.error('Please add a name, pick a station, and choose a voice');
      return;
    }
    const payload = {
      name: formData.name,
      feedfm_station_id: formData.feedfm_station_id,
      feedfm_station_name: formData.feedfm_station_name,
      genres: formData.feedfm_station_name ? [formData.feedfm_station_name] : [],
      artists: [],
      bumper_topics: formData.bumper_topics,
      voice_id: formData.voice_id,
      voice_name: formData.voice_name
    };
    try {
      setLoading(true);
      if (isEditing) {
        const response = await axios.put(`${API}/stations/${station.id}`, payload);
        onStationCreated(response.data);
      } else {
        const response = await axios.post(`${API}/stations`, payload);
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

        {/* Genre / Feed.fm station */}
        <div className="form-group">
          <label className="form-label">Genre / Station *</label>
          <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Choose the licensed station this plays from
          </p>
          {feedStations.length === 0 ? (
            <div style={{ color: '#8B5CF6', padding: '1rem' }}>Loading available stations…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }} data-testid="feedfm-stations">
              {feedStations.map((fs) => {
                const selected = formData.feedfm_station_id === String(fs.id);
                return (
                  <button
                    key={fs.id}
                    type="button"
                    data-testid={`feedfm-station-${fs.id}`}
                    onClick={() => selectStation(fs)}
                    style={{
                      background: selected ? 'rgba(251, 191, 36, 0.2)' : 'rgba(139, 92, 246, 0.1)',
                      border: selected ? '2px solid #FBBF24' : '2px solid rgba(139, 92, 246, 0.3)',
                      color: selected ? '#FBBF24' : '#8B5CF6',
                      padding: '1rem',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    <Radio size={18} />
                    {fs.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Voice */}
        <div className="form-group">
          <label className="form-label">Voice *</label>
          <select
            data-testid="voice-select"
            className="form-input"
            value={formData.voice_id}
            onChange={(e) => {
              const voice = voices.find(v => v.voice_id === e.target.value);
              setFormData({ ...formData, voice_id: e.target.value, voice_name: voice ? voice.name : '' });
            }}
          >
            <option value="">Select a voice</option>
            {voices.map(voice => (
              <option key={voice.voice_id} value={voice.voice_id}>{voice.name}</option>
            ))}
          </select>
        </div>

        {/* Bumper Topics */}
        <div className="form-group">
          <label className="form-label">Bumper Topics (Optional)</label>
          <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Choose what your DJ talks about between songs
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }}>
            {availableTopics.map((topic) => {
              const selected = formData.bumper_topics.includes(topic);
              return (
                <button
                  key={topic}
                  type="button"
                  data-testid={`topic-option-${topic}`}
                  onClick={() => toggleTopic(topic)}
                  style={{
                    background: selected ? 'rgba(251, 191, 36, 0.3)' : 'rgba(139, 92, 246, 0.1)',
                    border: selected ? '2px solid #FBBF24' : '2px solid rgba(139, 92, 246, 0.3)',
                    color: selected ? '#FBBF24' : '#8B5CF6',
                    padding: '0.75rem',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    textTransform: 'capitalize'
                  }}
                >
                  {topic}
                </button>
              );
            })}
          </div>

          {formData.bumper_topics.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }} data-testid="selected-topics">
              {formData.bumper_topics.map((topic) => (
                <span key={topic} data-testid={`selected-topic-${topic}`} style={{
                  background: 'rgba(251, 191, 36, 0.2)', border: '2px solid #FBBF24', color: '#FBBF24',
                  padding: '0.5rem 1rem', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '0.5rem',
                  fontSize: '0.9rem', textTransform: 'capitalize'
                }}>
                  {topic}
                  <X size={16} onClick={() => toggleTopic(topic)} style={{ cursor: 'pointer' }} data-testid={`remove-topic-${topic}`} />
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button data-testid="create-station-btn" type="submit" className="form-button" disabled={loading}>
            {loading ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Station' : 'Create Station')}
          </button>
          <button data-testid="cancel-btn" type="button" onClick={onCancel} style={{
            background: 'rgba(239, 68, 68, 0.2)', border: '2px solid rgba(239, 68, 68, 0.5)', color: '#ef4444',
            padding: '1.2rem', borderRadius: '12px', cursor: 'pointer', fontWeight: 700, flex: '0 0 auto'
          }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default StationCreator;
