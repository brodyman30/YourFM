import { useState, useEffect } from "react";
import "@/App.css";
import axios from "axios";
import LandingPage from "./components/LandingPage";
import StationCreator from "./components/StationCreator";
import StationList from "./components/StationList";
import Player from "./components/Player";
import ErrorBoundary from "./components/ErrorBoundary";
import { Toaster, toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [currentView, setCurrentView] = useState('landing'); // landing, stations, create, edit, player
  const [clientId, setClientId] = useState(null);
  const [feedStations, setFeedStations] = useState([]);
  const [stations, setStations] = useState([]);
  const [currentStation, setCurrentStation] = useState(null);
  const [editingStation, setEditingStation] = useState(null);
  const [loading, setLoading] = useState(false);

  // Create a Feed.fm listener session + load catalog/stations on mount
  useEffect(() => {
    const init = async () => {
      try {
        const res = await axios.post(`${API}/feedfm/session`);
        setClientId(res.data.client_id);
        const st = await axios.get(`${API}/feedfm/stations`, { params: { client_id: res.data.client_id } });
        setFeedStations(st.data.stations || []);
      } catch (e) {
        console.error('Feed.fm init failed:', e);
        toast.error('Could not connect to the music service.');
      }
    };
    init();
    loadStations();
  }, []);

  const loadStations = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/stations`);
      setStations(response.data);
    } catch (error) {
      console.error('Error loading stations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStationCreated = (newStation) => {
    setStations([...stations, newStation]);
    setCurrentView('stations');
    toast.success(`Station "${newStation.name}" created!`);
  };

  const handleStationUpdated = (updatedStation) => {
    setStations(stations.map(s => s.id === updatedStation.id ? updatedStation : s));
    if (currentStation && currentStation.id === updatedStation.id) {
      setCurrentStation(updatedStation);
    }
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

  const Header = ({ children }) => (
    <header className="app-header">
      <div className="app-logo" data-testid="app-logo">YOURFM</div>
      <div className="nav-buttons">{children}</div>
    </header>
  );

  const renderContent = () => {
    switch (currentView) {
      case 'landing':
        return <LandingPage onEnter={() => setCurrentView('stations')} />;

      case 'stations':
        return (
          <div className="app-container">
            <Header>
              <button data-testid="nav-stations-btn" className="nav-button active" onClick={() => setCurrentView('stations')}>My Stations</button>
              <button data-testid="nav-create-btn" className="nav-button" onClick={() => setCurrentView('create')}>Create Station</button>
            </Header>
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
            <Header>
              <button data-testid="back-to-stations-btn" className="nav-button" onClick={() => setCurrentView('stations')}>Back to Stations</button>
            </Header>
            <StationCreator
              feedStations={feedStations}
              onStationCreated={handleStationCreated}
              onCancel={() => setCurrentView('stations')}
            />
          </div>
        );

      case 'edit':
        return (
          <div className="app-container">
            <Header>
              <button data-testid="back-to-stations-btn" className="nav-button" onClick={() => { setEditingStation(null); setCurrentView('stations'); }}>Back to Stations</button>
            </Header>
            <StationCreator
              station={editingStation}
              feedStations={feedStations}
              onStationCreated={handleStationUpdated}
              onCancel={() => { setEditingStation(null); setCurrentView('stations'); }}
            />
          </div>
        );

      case 'player':
        // Rendered by the persistent player layer below
        return null;

      default:
        return <LandingPage onEnter={() => setCurrentView('stations')} />;
    }
  };

  return (
    <>
      <div className="App">
        {renderContent()}
        {currentStation && clientId && (
          <div data-testid="player-layer" style={{ display: currentView === 'player' ? 'block' : 'none' }}>
            <div className="app-container">
              <Header>
                <button data-testid="back-from-player-btn" className="nav-button" onClick={() => setCurrentView('stations')}>Back to Stations</button>
              </Header>
              <ErrorBoundary onReset={() => setCurrentView('stations')}>
                <Player
                  station={currentStation}
                  clientId={clientId}
                  active={currentView === 'player'}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>
      <Toaster position="top-right" richColors />
    </>
  );
}

export default App;
