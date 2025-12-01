import { useState, useEffect } from "react";
import "@/App.css";
import axios from "axios";
import LandingPage from "./components/LandingPage";
import StationCreator from "./components/StationCreator";
import StationList from "./components/StationList";
import Player from "./components/Player";
import { Toaster, toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [currentView, setCurrentView] = useState('landing'); // landing, stations, create, edit, player
  const [stations, setStations] = useState([]);
  const [currentStation, setCurrentStation] = useState(null);
  const [editingStation, setEditingStation] = useState(null);
  const [loading, setLoading] = useState(false);

  // Check for Spotify auth on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('spotify_auth') === 'success') {
      fetchSpotifyToken();
      toast.success('Successfully authenticated with Spotify!');
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const fetchSpotifyToken = async () => {
    try {
      const response = await axios.get(`${API}/spotify/token`);
      setSpotifyToken(response.data.access_token);
      setCurrentView('stations');
      loadStations();
    } catch (error) {
      console.error('Error fetching token:', error);
      if (error.response?.status === 404) {
        // No token, stay on landing
      }
    }
  };

  const loadStations = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/stations`);
      setStations(response.data);
    } catch (error) {
      console.error('Error loading stations:', error);
      toast.error('Failed to load stations');
    } finally {
      setLoading(false);
    }
  };

  const handleSpotifyLogin = async () => {
    try {
      const response = await axios.get(`${API}/spotify/auth`);
      window.location.href = response.data.auth_url;
    } catch (error) {
      console.error('Error initiating Spotify auth:', error);
      toast.error('Failed to connect to Spotify. Please check API credentials.');
    }
  };

  const handleStationCreated = (newStation) => {
    setStations([...stations, newStation]);
    setCurrentView('stations');
    toast.success(`Station "${newStation.name}" created!`);
  };

  const handleStationUpdated = (updatedStation) => {
    setStations(stations.map(s => s.id === updatedStation.id ? updatedStation : s));
    setEditingStation(null);
    setCurrentView('stations');
    toast.success(`Station "${updatedStation.name}" updated!`);
  };

  const handleEditStation = (station) => {
    setEditingStation(station);
    setCurrentView('edit');
  };

  const handleStationSelect = (station) => {
    setCurrentStation(station);
    setCurrentView('player');
  };

  const handleDeleteStation = async (stationId) => {
    try {
      await axios.delete(`${API}/stations/${stationId}`);
      setStations(stations.filter(s => s.id !== stationId));
      toast.success('Station deleted');
    } catch (error) {
      console.error('Error deleting station:', error);
      toast.error('Failed to delete station');
    }
  };

  const renderContent = () => {
    switch (currentView) {
      case 'landing':
        return <LandingPage onSpotifyLogin={handleSpotifyLogin} />;
      
      case 'stations':
        return (
          <div className="app-container">
            <header className="app-header">
              <div className="app-logo" data-testid="app-logo">YOURFM</div>
              <div className="nav-buttons">
                <button
                  data-testid="nav-stations-btn"
                  className="nav-button active"
                  onClick={() => setCurrentView('stations')}
                >
                  My Stations
                </button>
                <button
                  data-testid="nav-create-btn"
                  className="nav-button"
                  onClick={() => setCurrentView('create')}
                >
                  Create Station
                </button>
              </div>
            </header>
            <StationList
              stations={stations}
              onStationSelect={handleStationSelect}
              onDeleteStation={handleDeleteStation}
              onEditStation={handleEditStation}
              loading={loading}
            />
          </div>
        );
      
      case 'create':
        return (
          <div className="app-container">
            <header className="app-header">
              <div className="app-logo">YOURFM</div>
              <div className="nav-buttons">
                <button
                  data-testid="back-to-stations-btn"
                  className="nav-button"
                  onClick={() => setCurrentView('stations')}
                >
                  Back to Stations
                </button>
              </div>
            </header>
            <StationCreator
              onStationCreated={handleStationCreated}
              onCancel={() => setCurrentView('stations')}
            />
          </div>
        );
      
      case 'edit':
        return (
          <div className="app-container">
            <header className="app-header">
              <div className="app-logo">YOURFM</div>
              <div className="nav-buttons">
                <button
                  data-testid="back-to-stations-btn"
                  className="nav-button"
                  onClick={() => {
                    setEditingStation(null);
                    setCurrentView('stations');
                  }}
                >
                  Back to Stations
                </button>
              </div>
            </header>
            <StationCreator
              station={editingStation}
              onStationCreated={handleStationUpdated}
              onCancel={() => {
                setEditingStation(null);
                setCurrentView('stations');
              }}
            />
          </div>
        );
      
      case 'player':
        return (
          <div className="app-container">
            <header className="app-header">
              <div className="app-logo">YOURFM</div>
              <div className="nav-buttons">
                <button
                  data-testid="back-from-player-btn"
                  className="nav-button"
                  onClick={() => setCurrentView('stations')}
                >
                  Back to Stations
                </button>
              </div>
            </header>
            <Player
              station={currentStation}
              spotifyToken={spotifyToken}
            />
          </div>
        );
      
      default:
        return <LandingPage onSpotifyLogin={handleSpotifyLogin} />;
    }
  };

  return (
    <>
      <div className="App">
        {renderContent()}
      </div>
      <Toaster position="top-right" richColors />
    </>
  );
}

export default App;