import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchGame } from '../lib/api';
import { useGlobalLoading } from '../lib/loading';

export function JoinGamePage() {
  const navigate = useNavigate();
  const { withLoading } = useGlobalLoading();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) {
      setError('Room code is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await withLoading('Loading table...', () => fetchGame(code));
      navigate(`/game/${code}?viewer=true`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Room not found');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow">Join game</p>
        <h2>Enter room code to watch the live game</h2>
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          <span>Room code</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={6}
            placeholder="e.g., 1234"
            autoFocus
          />
        </label>

        <button type="submit" disabled={loading || !code.trim()}>
          {loading ? 'Joining...' : 'Join room'}
        </button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
