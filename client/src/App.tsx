import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { GameRoomPage } from './pages/GameRoomPage';
import { AddPlayersPage } from './pages/AddPlayersPage';
import { EntryPage } from './pages/EntryPage';
import { useGlobalLoading } from './lib/loading';

export function App() {
  const location = useLocation();
  const { showRouteTransition } = useGlobalLoading();
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    showRouteTransition();
  }, [location.hash, location.pathname, location.search, showRouteTransition]);

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Navigate to="/join" replace />} />
        <Route path="/create" element={<EntryPage initialMode="create" />} />
        <Route path="/join" element={<EntryPage initialMode="join" />} />
        <Route path="/game/:code/add-players" element={<AddPlayersPage />} />
        <Route path="/game/:code" element={<GameRoomPage />} />
      </Routes>
    </div>
  );
}
