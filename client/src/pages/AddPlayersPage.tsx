import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchGame, addPlayerToGame, renamePlayer } from '../lib/api';
import type { GameSnapshot } from '../lib/types';
import { useGlobalLoading } from '../lib/loading';

export function AddPlayersPage() {
  const navigate = useNavigate();
  const params = useParams();
  const { withLoading } = useGlobalLoading();
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [color, setColor] = useState('#22c55e');
  const [chooseColorManually, setChooseColorManually] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    const code = params.code ?? '';
    if (!code) return;

    async function loadGame() {
      try {
        const response = await withLoading('Loading players...', () => fetchGame(code));
        setGame(response.game);
      } catch (err) {
        setError('Failed to load game');
      }
    }

    void loadGame();
  }, [params.code, withLoading]);

  const handleAddPlayer = async (event: FormEvent) => {
    event.preventDefault();
    if (!game || !playerName.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await withLoading('Loading players...', () =>
        addPlayerToGame(game.code, {
          playerName,
          ...(chooseColorManually ? { color } : {})
        })
      );
      setGame(response.game);
      setPlayerName('');
      setColor('#22c55e');
      setChooseColorManually(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add player');
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = () => {
    if (game) {
      navigate(`/game/${game.code}`);
    }
  };

  const startEditing = (playerId: string, currentName: string) => {
    setEditingPlayerId(playerId);
    setEditingName(currentName);
  };

  const savePlayerName = async (playerId: string) => {
    if (!game || !editingName.trim() || editingName.trim() === game.players.find(p => p.id === playerId)?.name) {
      setEditingPlayerId(null);
      return;
    }

    try {
      const response = await withLoading('Renaming player...', () =>
        renamePlayer(game.code, { playerId, newName: editingName.trim() })
      );
      setGame(response.game);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename player');
    } finally {
      setEditingPlayerId(null);
    }
  };

  if (!game) {
    return (
      <section className="panel">
        <p>Loading game...</p>
      </section>
    );
  }

  const isFull = game.players.length >= game.settings.playerCount;
  // The local super player is the one who created the game
  const superPlayerId = game.players.find((p) => p.isSuperPlayer)?.id;
  const localPlayerId = typeof window !== 'undefined' ? window.localStorage.getItem(`kcfl-player:${game.code}`) : null;
  const isLocalSuperPlayer = !!localPlayerId && localPlayerId === superPlayerId;

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow">Setup players</p>
        <h2>Add players to your room</h2>
      </div>

      <div className="stack-gap">
        <p className="muted">
          Game: <strong>{game.name}</strong> | Room code: <strong>{game.code}</strong>
        </p>
        <p className="muted">
          Players: {game.players.length} / {game.settings.playerCount}
        </p>
      </div>

      {game.players.length > 0 && (
        <div className="stack-gap">
          <h3>Current players</h3>
          <ol className="ranking-list">
            {game.players.map((player) => (
              <li key={player.id}>
                <span className="player-dot" style={{ backgroundColor: player.color }} />
                {isLocalSuperPlayer && player.id === localPlayerId && editingPlayerId === player.id ? (
                  <input
                    className="player-inline-edit"
                    value={editingName}
                    autoFocus
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => void savePlayerName(player.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void savePlayerName(player.id);
                      if (e.key === 'Escape') setEditingPlayerId(null);
                    }}
                  />
                ) : (
                  <strong>{player.name}</strong>
                )}
                {player.isSuperPlayer && <em className="super-tag">Super Player</em>}
                {isLocalSuperPlayer && player.id === localPlayerId && editingPlayerId !== player.id && (
                  <button
                    type="button"
                    className="player-rename-btn"
                    onClick={() => startEditing(player.id, player.name)}
                    title="Rename player"
                    aria-label={`Rename ${player.name}`}
                  >
                    ✏️
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {!isFull && (
        <form className="form-grid" onSubmit={handleAddPlayer}>
          <label>
            <span>Player name</span>
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Enter player name"
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={chooseColorManually}
              onChange={(event) => setChooseColorManually(event.target.checked)}
            />
            <span>Choose color manually (otherwise random unique color is assigned)</span>
          </label>

          {chooseColorManually ? (
            <label>
              <span>Color</span>
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
          ) : null}

          <button type="submit" disabled={loading || !playerName.trim()}>
            {loading ? 'Adding...' : 'Add player'}
          </button>
        </form>
      )}

      {error ? <p className="error-text">{error}</p> : null}

      {isFull && <p className="room-full-text">✓ Room is full!</p>}

      <button
        type="button"
        onClick={handleStartGame}
        className="start-game-btn"
      >
        Start game →
      </button>
    </section>
  );
}
