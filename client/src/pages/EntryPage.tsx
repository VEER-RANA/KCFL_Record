import { useEffect, useState } from 'react';
import { CreateGamePage } from './CreateGamePage';
import { JoinGamePage } from './JoinGamePage';

type EntryMode = 'join' | 'create';

interface EntryPageProps {
  initialMode: EntryMode;
}

export function EntryPage({ initialMode }: EntryPageProps) {
  const [mode, setMode] = useState<EntryMode>(initialMode);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  return (
    <section className="entry-shell">
      <header className="panel entry-switch-panel">
        <div className="entry-switch-actions" role="tablist" aria-label="Choose room action">
          <button
            type="button"
            className={`entry-switch-btn ${mode === 'join' ? 'active' : ''}`}
            onClick={() => setMode('join')}
            aria-pressed={mode === 'join'}
          >
            Join room
          </button>
          <button
            type="button"
            className={`entry-switch-btn ${mode === 'create' ? 'active' : ''}`}
            onClick={() => setMode('create')}
            aria-pressed={mode === 'create'}
          >
            Create game
          </button>
        </div>
      </header>

      {mode === 'join' ? <JoinGamePage /> : <CreateGamePage />}
    </section>
  );
}
