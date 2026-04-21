import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGame } from '../lib/api';
import { NumberStepper } from '../components/NumberStepper';
import { useGlobalLoading } from '../lib/loading';

const defaultSuitOrder = ['Hearts', 'Diamonds', 'Clubs', 'Spades'] as const;

export function CreateGamePage() {
  const navigate = useNavigate();
  const { withLoading } = useGlobalLoading();
  const [form, setForm] = useState<{
    name: string;
    superPlayerName: string;
    playerCount: number;
    maxCardsPerPlayer: number;
    distributionDirection: 'ascending' | 'descending';
    includeWithoutSir: boolean;
  }>({
    name: 'Friday Match',
    superPlayerName: 'Super Player',
    playerCount: 4,
    maxCardsPerPlayer: 8,
    distributionDirection: 'descending',
    includeWithoutSir: false
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const totalDeckCards = form.includeWithoutSir ? 65 : 52;
  const distributedCards = form.playerCount * form.maxCardsPerPlayer;
  const unusedCards = Math.max(0, totalDeckCards - distributedCards);
  const deckUsagePercent = Math.min(100, Math.round((distributedCards / totalDeckCards) * 100));

  const maxAllowedCardsPerPlayer = useMemo(() => {
    return Math.max(1, Math.floor(totalDeckCards / form.playerCount));
  }, [form.includeWithoutSir, form.playerCount]);

  useEffect(() => {
    if (form.maxCardsPerPlayer > maxAllowedCardsPerPlayer) {
      setForm((prev) => ({ ...prev, maxCardsPerPlayer: maxAllowedCardsPerPlayer }));
    }
  }, [form.maxCardsPerPlayer, maxAllowedCardsPerPlayer]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await withLoading('Loading table...', () =>
        createGame({
          name: form.name,
          superPlayerName: form.superPlayerName,
          settings: {
            playerCount: form.playerCount,
            maxCardsPerPlayer: form.maxCardsPerPlayer,
            distributionDirection: form.distributionDirection,
            includeWithoutSir: form.includeWithoutSir,
            suitOrder: form.includeWithoutSir
              ? [...defaultSuitOrder, 'Without Sir' as const]
              : [...defaultSuitOrder]
          }
        })
      );

      navigate(`/game/${response.game.code}/add-players`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create game');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="create-game-shell">
      <div className="create-game-hero panel">
        <div>
          <p className="eyebrow">Create game</p>
          <h2>Build your table in seconds</h2>
          <p className="muted">Configure room settings, preview deck usage, then invite players.</p>
        </div>
        <div className="create-game-chip-row" aria-label="Deck quick stats">
          <article className="create-game-chip">
            <span>Deck size</span>
            <strong>{totalDeckCards}</strong>
          </article>
          <article className="create-game-chip">
            <span>Cards in play</span>
            <strong>{distributedCards}</strong>
          </article>
          <article className="create-game-chip">
            <span>Unused cards</span>
            <strong>{unusedCards}</strong>
          </article>
        </div>
      </div>

      <div className="create-game-grid">
        <form className="panel create-game-form" onSubmit={handleSubmit}>
          <div className="panel-heading">
            <h3>Room setup</h3>
          </div>

          <div className="form-grid create-form-grid">
            <label>
              <span>Game name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              <span>Your name (super player)</span>
              <input value={form.superPlayerName} onChange={(event) => setForm({ ...form, superPlayerName: event.target.value })} />
            </label>
            <NumberStepper
              label="Player count"
              min={2}
              max={15}
              value={form.playerCount}
              onChange={(nextPlayerCount) => {
                setForm({
                  ...form,
                  playerCount: nextPlayerCount,
                  maxCardsPerPlayer: Math.min(
                    form.maxCardsPerPlayer,
                    Math.max(1, Math.floor((form.includeWithoutSir ? 65 : 52) / nextPlayerCount))
                  )
                });
              }}
            />
            <NumberStepper
              label="Max cards per player"
              min={1}
              max={maxAllowedCardsPerPlayer}
              value={form.maxCardsPerPlayer}
              onChange={(nextMaxCards) => setForm({ ...form, maxCardsPerPlayer: nextMaxCards })}
              helperText={`Max allowed for ${form.playerCount} players: ${maxAllowedCardsPerPlayer}`}
            />
            <label>
              <span>Card order</span>
              <select
                value={form.distributionDirection}
                onChange={(event) =>
                  setForm({ ...form, distributionDirection: event.target.value as 'ascending' | 'descending' })
                }
              >
                <option value="descending">Max to 1</option>
                <option value="ascending">1 to Max</option>
              </select>
            </label>
            <label className="checkbox-row create-checkbox-row">
              <input
                type="checkbox"
                checked={form.includeWithoutSir}
                onChange={(event) => {
                  const includeWithoutSir = event.target.checked;
                  const deckSize = includeWithoutSir ? 65 : 52;
                  const nextMaxAllowed = Math.max(1, Math.floor(deckSize / form.playerCount));
                  setForm({
                    ...form,
                    includeWithoutSir,
                    maxCardsPerPlayer: Math.min(form.maxCardsPerPlayer, nextMaxAllowed)
                  });
                }}
              />
              <span>Include without-sir cards in the suit cycle</span>
            </label>

            <button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Next: Add players'}
            </button>
          </div>

          {error ? <p className="error-text">{error}</p> : null}
        </form>

        <aside className="panel create-game-preview" aria-live="polite">
          <h3>Live preview</h3>
          <p className="muted">Deck usage updates instantly as you change options.</p>

          <div className="create-preview-bar-track" role="img" aria-label={`Deck usage ${deckUsagePercent} percent`}>
            <div className="create-preview-bar-fill" style={{ width: `${deckUsagePercent}%` }} />
          </div>
          <p className="create-preview-percent">{deckUsagePercent}% of deck in play</p>

          <ul className="create-preview-list">
            <li>
              <span>Mode</span>
              <strong>{form.includeWithoutSir ? 'Classic + Without Sir' : 'Classic deck'}</strong>
            </li>
            <li>
              <span>Flow</span>
              <strong>{form.distributionDirection === 'descending' ? 'Max to 1' : '1 to Max'}</strong>
            </li>
            <li>
              <span>Per player limit</span>
              <strong>{maxAllowedCardsPerPlayer}</strong>
            </li>
            <li>
              <span>Expected hands</span>
              <strong>{form.maxCardsPerPlayer} each</strong>
            </li>
          </ul>
        </aside>
      </div>
    </section>
  );
}