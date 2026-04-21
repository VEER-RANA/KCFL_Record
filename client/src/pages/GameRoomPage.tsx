import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchGame, submitBid, extendDistribution, endGameRequest } from '../lib/api';
import { socket } from '../lib/socket';
import { generateGameReportPDF } from '../lib/pdfExport';
import type { GameSnapshot } from '../lib/types';
import { useGlobalLoading } from '../lib/loading';

interface BidEntry {
  [cardRound: number]: {
    [playerId: string]: { bid?: number; completed: boolean; status: 'pending' | 'success' | 'fail' };
  };
}

type PlayerColumn = GameSnapshot['players'][number];

export function GameRoomPage() {
  const navigate = useNavigate();
  const params = useParams();
  const { withLoading, showRouteTransition } = useGlobalLoading();
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [bids, setBids] = useState<BidEntry>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addingRows, setAddingRows] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const currentGameCodeRef = useRef<string>('');
  const tableRef = useRef<HTMLDivElement>(null);
  const rankingRef = useRef<HTMLDivElement>(null);
  // Check if this is a read-only viewer
  const isViewer = new URLSearchParams(window.location.search).get('viewer') === 'true';
  const playerColumns = useMemo(() => game?.players ?? [], [game?.players]);

  const populateBidsFromGame = (gameData: GameSnapshot) => {
    setBids((previousBids) => {
      const mergedBids: BidEntry = { ...previousBids };

      Object.entries(gameData.bids).forEach(([roundKey, playerBids]) => {
        const round = Number(roundKey);
        mergedBids[round] = {
          ...(previousBids[round] ?? {})
        };

        Object.entries(playerBids).forEach(([playerId, entry]) => {
          mergedBids[round][playerId] = {
            bid: entry.bid,
            completed: entry.completed,
            status: entry.status
          };
        });
      });

      return mergedBids;
    });
  };

  useEffect(() => {
    const code = params.code ?? '';

    async function loadGame() {
      // Reset bids when loading a new game
      setBids({});
      setError('');

      if (!code) {
        setGame(null);
        setError('Game code is missing');
        return;
      }

      try {
        const response = await withLoading('Loading table...', () => fetchGame(code));
        setGame(response.game);
        populateBidsFromGame(response.game);
      } catch {
        setGame(null);
        setError('Game not found or no longer available');
      }
    }

    void loadGame();
  }, [params.code, withLoading]);

  useEffect(() => {
    const code = params.code ?? game?.code;
    if (!code) {
      return;
    }

    // Update the ref so the listener always has the current game code
    currentGameCodeRef.current = code;

    // Handle game updates - accepts any event, filters by game code
    function handleGameUpdate(payload: unknown) {
      const updatedGame = payload as GameSnapshot;
      // Only update if this update is for the current game code (use ref instead of closure)
      if (updatedGame.code === currentGameCodeRef.current) {
        setGame(updatedGame);
        populateBidsFromGame(updatedGame);
      }
    }

    function handleSocketConnect() {
      socket.emit('game:join', code);
    }

    // Ensure socket is connected
    if (!socket.connected) {
      socket.connect();
    }

    // Leave previous room first, then join current game room
    socket.emit('game:leave');
    socket.off('game:update', handleGameUpdate);
    socket.off('connect', handleSocketConnect);
    socket.emit('game:join', code);
    socket.on('game:update', handleGameUpdate);
    socket.on('connect', handleSocketConnect);

    return () => {
      socket.off('game:update', handleGameUpdate);
      socket.off('connect', handleSocketConnect);
      socket.emit('game:leave');
      currentGameCodeRef.current = '';
    };
  }, [params.code, game?.code]);

  useEffect(() => {
    if (game?.status === 'finished') {
      setShowCelebration(true);
      return;
    }

    setShowCelebration(false);
  }, [game?.status]);

  if (!game) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <h3>Game Room</h3>
          <p>{error || 'Loading game...'}</p>
        </div>
      </section>
    );
  }

  const activeGame = game;
  const isSuperPlayer = !isViewer && activeGame.players.some((p) => p.isSuperPlayer);
  const useCompactCardLabels = playerColumns.length > 5;
  const maxTwoDigitBid = Math.min(activeGame.settings.maxCardsPerPlayer, 99);
  const celebrationRanking = activeGame.ranking;
  const roomMetrics = [
    { label: 'Players', value: `${activeGame.players.length}/${activeGame.settings.playerCount}` },
    { label: 'Rounds', value: `${activeGame.distribution.length}` },
    { label: 'Max bid', value: `${activeGame.settings.maxCardsPerPlayer}` }
  ];

  const handleBidChange = (cardRound: number, playerId: string, bidValue?: number) => {
    setBids((prev) => ({
      ...prev,
      [cardRound]: {
        ...(prev[cardRound] ?? {}),
        [playerId]: {
          bid: bidValue,
          completed: false,
          status: 'pending'
        }
      }
    }));
  };

  const handleMarkBid = (cardRound: number, playerId: string, isComplete: boolean) => {
    if (!activeGame.code || !isSuperPlayer) return;

    const bidEntry = bids[cardRound]?.[playerId];
    if (bidEntry?.bid === undefined || Number.isNaN(bidEntry.bid)) {
      return;
    }

    const bidValue = bidEntry.bid;

    setBids((prev) => ({
      ...prev,
      [cardRound]: {
        ...(prev[cardRound] ?? {}),
        [playerId]: {
          bid: bidValue,
          completed: isComplete,
          status: isComplete ? 'success' : 'fail'
        }
      }
    }));

    void submitBid(activeGame.code, {
      round: cardRound,
      playerId,
      bid: bidValue,
      completed: isComplete
    })
      .then((response) => {
        setGame(response.game);
        populateBidsFromGame(response.game);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to submit bid');
      });
  };

  const handleEndGame = async () => {
    if (!activeGame.code || !isSuperPlayer) return;

    setSubmitting(true);
    setError('');
    try {
      const response = await withLoading('Showing result...', () => endGameRequest(activeGame.code));
      setGame(response.game);
      setShowCelebration(true);
      setError('Game ended. Data will remain available for report generation for 1 hour.');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to end game';
      setError(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddRows = async () => {
    if (!activeGame.code || !isSuperPlayer) return;

    setAddingRows(true);
    setError('');
    try {
      await withLoading('Loading table...', () => extendDistribution(activeGame.code, { rowsToAdd: 5 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add more rows');
    } finally {
      setAddingRows(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!game) return;

    setDownloading(true);
    try {
      await withLoading('Downloading report...', () =>
        generateGameReportPDF(
          game.name,
          game.code,
          game,
          tableRef.current,
          rankingRef.current
        )
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to download PDF';
      setError(errorMsg);
    } finally {
      setDownloading(false);
    }
  };

  const handleBackToCreate = () => {
    showRouteTransition('Loading home...');
    navigate('/create', { replace: true });
  };

  const getPlayerShortName = (name: string) => {
    const compactName = name.replace(/\s+/g, '').trim();
    if (!compactName) {
      return '';
    }

    const firstLetter = compactName.charAt(0);
    const lastTwoLetters = compactName.slice(-2);
    return `${firstLetter}${lastTwoLetters}`.toUpperCase();
  };

  const getCardShortLabel = (label: string) => {
    const normalized = label.toLowerCase();
    const suitSymbol = normalized.includes('heart')
      ? '♥'
      : normalized.includes('diamond')
        ? '♦'
        : normalized.includes('club')
          ? '♣'
          : normalized.includes('spade')
            ? '♠'
            : normalized.includes('without sir')
              ? 'W'
              : 'C';

    const roundNumberMatch = label.match(/\d+/);
    return roundNumberMatch ? `${suitSymbol}${roundNumberMatch[0]}` : suitSymbol;
  };

  const getBidMeta = (cardRound: number, playerId: string) => {
    const bidEntry = bids[cardRound]?.[playerId];
    const status = bidEntry?.status ?? 'pending';
    const isSubmitted = bidEntry?.status === 'success' || bidEntry?.status === 'fail';
    const scoreEarned = isSubmitted && bidEntry ? (bidEntry.completed ? ((bidEntry.bid ?? 0) + 10) : 0) : null;

    return {
      bidEntry,
      status,
      isSubmitted,
      scoreEarned
    };
  };

  const renderBidContent = (cardRound: number, player: PlayerColumn) => {
    const { bidEntry, isSubmitted, scoreEarned } = getBidMeta(cardRound, player.id);

    if (isSuperPlayer) {
      if (!isSubmitted) {
        return (
          <div className="bid-controls">
            <div className="bid-input-wrap">
              <span className="bid-label">{getPlayerShortName(player.name)}</span>
              <input
                type="number"
                min="0"
                max={maxTwoDigitBid}
                value={bidEntry?.bid ?? ''}
                onChange={(e) => {
                  const rawValue = e.target.value;
                  const numericValue = rawValue.replace(/\D/g, '').slice(0, 2);

                  if (numericValue === '') {
                    handleBidChange(cardRound, player.id, undefined);
                    return;
                  }

                  const nextBid = Math.min(Number(numericValue), maxTwoDigitBid);
                  handleBidChange(
                    cardRound,
                    player.id,
                    nextBid
                  );
                }}
                placeholder="0"
              />
            </div>
            <div className="bid-actions">
              <button
                onClick={() => handleMarkBid(cardRound, player.id, true)}
                disabled={bidEntry?.bid === undefined || Number.isNaN(bidEntry.bid)}
                className="bid-btn success"
                title="Mark as complete (✓)"
              >
                ✓
              </button>
              <button
                onClick={() => handleMarkBid(cardRound, player.id, false)}
                disabled={bidEntry?.bid === undefined || Number.isNaN(bidEntry.bid)}
                className="bid-btn fail"
                title="Mark as incomplete (✗)"
              >
                ✗
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="bid-result">
          <span className="bid-value">{bidEntry?.bid}</span>
          <span className="score-label">{scoreEarned === 0 ? '0 pts' : `${scoreEarned} pts`}</span>
        </div>
      );
    }

    return (
      <div className="bid-result">
        {isSubmitted && bidEntry ? (
          <>
            <span className="bid-value">{bidEntry.bid}</span>
            <span className="score-label">{scoreEarned === 0 ? '0 pts' : `${scoreEarned} pts`}</span>
          </>
        ) : (
          '—'
        )}
      </div>
    );
  };

  return (
    <section className="room-layout">
      {showCelebration && activeGame.status === 'finished' ? (
        <div className="celebration-overlay" role="dialog" aria-modal="true" aria-labelledby="celebration-title">
          <div className="celebration-backdrop" />
          <div className="celebration-card">
            <button
              type="button"
              className="celebration-close"
              onClick={handleBackToCreate}
              aria-label="Close celebration"
            >
              Close
            </button>
            <p className="eyebrow">Game complete</p>
            <h2 id="celebration-title">Celebration time</h2>
            <p className="celebration-copy">Final leaderboard with all player points.</p>

            <ol className="celebration-podium">
              {celebrationRanking.map((entry, index) => (
                <li
                  key={entry.playerId}
                  className={`podium-place podium-place-${index + 1} ${index < 3 ? `podium-top-three podium-top-${index + 1}` : ''}`}
                >
                  <span className="podium-rank">#{index + 1}</span>
                  <strong>{entry.playerName}</strong>
                  <em>{entry.totalScore} pts</em>
                </li>
              ))}
            </ol>

            <div className="celebration-actions">
              <button
                type="button"
                onClick={() => {
                  void handleDownloadPDF();
                }}
                disabled={downloading}
                className="start-game-btn celebration-download-btn"
              >
                {downloading ? 'Downloading...' : 'Download PDF'}
              </button>
            </div>
          </div>

          <div className="celebration-confetti" aria-hidden="true">
            {Array.from({ length: 28 }, (_, index) => (
              <span
                key={index}
                className="confetti-piece"
                style={{
                  left: `${(index * 7.25) % 100}%`,
                  animationDelay: `${index * 0.08}s`,
                  animationDuration: `${2.4 + (index % 4) * 0.35}s`,
                  backgroundColor: [
                    '#f87171',
                    '#fbbf24',
                    '#34d399',
                    '#60a5fa',
                    '#f472b6'
                  ][index % 5]
                } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
      ) : null}

      <header className="room-header panel">
        <div>
          <p className="eyebrow">Live room</p>
          <h2>{activeGame.name}</h2>
          <p className="muted">Room code {activeGame.code}</p>
          <div className="room-metrics" aria-label="Room summary">
            {roomMetrics.map((metric) => (
              <div key={metric.label} className="metric-chip">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="header-controls">
          <button
            onClick={() => {
              void handleDownloadPDF();
            }}
            disabled={downloading}
            className="download-pdf-btn"
            title="Download game report as PDF"
          >
            {downloading ? 'Downloading...' : '📥 Download PDF'}
          </button>
          {isSuperPlayer && (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to end this game? This cannot be undone.')) {
                  void handleEndGame();
                }
              }}
              disabled={submitting}
              className="end-game-btn"
            >
              End Game
            </button>
          )}
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="panel" ref={rankingRef}>
        <div className="panel-heading">
          <h3>Player ranking</h3>
          <p>Sorted by total score</p>
        </div>
        <ol className="ranking-list">
          {activeGame.ranking.map((entry, index) => (
            <li key={entry.playerId}>
              <span>{index + 1}</span>
              <strong>{entry.playerName}</strong>
              <em>{entry.totalScore} pts</em>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel table-panel" ref={tableRef}>
        <div className="panel-heading">
          <h3>Bid Table</h3>
          <div className="table-heading-actions">
            <p>{isSuperPlayer ? 'Super player: Enter bids and mark as complete (✓) or incomplete (✗)' : 'Watch the live bids in real time'}</p>
          </div>
        </div>

        <details className="player-shortname-list">
          <summary>Player full and short names</summary>
          <ul>
            {playerColumns.map((player) => (
              <li key={player.id}>
                <span>{player.name}</span>
                <strong>{getPlayerShortName(player.name)}</strong>
              </li>
            ))}
          </ul>
        </details>

        <div className="table-scroll">
          <table className={useCompactCardLabels ? 'compact-card-labels' : undefined}>
            <tbody>
              {activeGame.distribution.map((row) => (
                <tr key={row.round}>
                  <td>
                    <strong className="card-label-full">{row.label}</strong>
                    <strong className="card-label-short" aria-label={row.label}>{getCardShortLabel(row.label)}</strong>
                  </td>
                  {playerColumns.map((player) => {
                    const { status } = getBidMeta(row.round, player.id);

                    return (
                      <td key={player.id} className={`bid-cell player-column ${status}`} style={{ '--player-color': player.color } as React.CSSProperties}>
                        {renderBidContent(row.round, player)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isSuperPlayer ? (
          <div className="table-footer-actions">
            <button
              type="button"
              onClick={() => {
                void handleAddRows();
              }}
              className="add-rows-btn"
              disabled={addingRows || submitting}
            >
              {addingRows ? 'Adding...' : 'Add 5 rows'}
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
