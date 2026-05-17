import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchGame, submitBid, extendDistribution, endGameRequest, initiateEditPoll, voteOnEditPoll, closeEditPoll, resetEditPoll } from '../lib/api';
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
  const [liveBids, setLiveBids] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addingRows, setAddingRows] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [modalRound, setModalRound] = useState<number | null>(null);
  const [modalBids, setModalBids] = useState<Record<string, number | undefined>>({});
  const [showEditPollModal, setShowEditPollModal] = useState(false);
  const [editRound, setEditRound] = useState<number | null>(null);
  const [editMessage, setEditMessage] = useState('');
  const [editMessageError, setEditMessageError] = useState('');
  const [pollTimeRemaining, setPollTimeRemaining] = useState<number | null>(null);
  const [showSaveToast, setShowSaveToast] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const [editVoterId] = useState(() => {
    const code = params.code ?? 'unknown';
    const storageKey = `kcfl-edit-voter:${code}`;

    if (typeof window === 'undefined') {
      return storageKey;
    }

    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
      return existing;
    }

    const generated = window.crypto?.randomUUID?.() ?? `voter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(storageKey, generated);
    return generated;
  });
  const currentGameCodeRef = useRef<string>('');
  const editApprovalHandledRef = useRef<string | null>(null);
  const sawActivePollRef = useRef(false);
  const saveToastTimeoutRef = useRef<number | undefined>(undefined);
  const lastSirenKeyRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const rankingRef = useRef<HTMLDivElement>(null);
  // Check if this is a read-only viewer
  const isViewer = new URLSearchParams(window.location.search).get('viewer') === 'true';
  const playerColumns = useMemo(() => game?.players ?? [], [game?.players]);

  const getLocalPlayerId = (code: string) => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(`kcfl-player:${code}`);
  };

  const getEditApprovalKey = (
    code: string,
    round: number,
    approvedAt: number
  ) => `kcfl-edit-approved:${code}:${round}:${approvedAt}`;

  const hasSeenEditApproval = (key: string) => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(key) === 'true';
  };

  const markEditApprovalSeen = (key: string) => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(key, 'true');
  };

  // Store audio instance
  const sirenAudioRef = useRef<HTMLAudioElement | null>(null);

  const playSiren = () => {
    if (typeof window === 'undefined') return;

    // Prevent playing if disabled
    if (!soundEnabledRef.current) return;

    // Create audio only once
    if (!sirenAudioRef.current) {
      sirenAudioRef.current = new Audio('/sounds/edit_siren.mp3');
      sirenAudioRef.current.volume = 0.8;
    }

    // Restart from beginning every time
    sirenAudioRef.current.currentTime = 0;

    sirenAudioRef.current
      .play()
      .catch((err) => console.log('Audio play blocked:', err));
  };

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
      setLiveBids({});
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

    // Handle live bid updates from super player
    function handleLiveBid(payload: unknown) {
      const data = payload as { gameCode: string; cardRound: number; playerId: string; bidValue: number };
      if (data.gameCode === currentGameCodeRef.current) {
        setLiveBids((prev) => ({
          ...prev,
          [`${data.cardRound}-${data.playerId}`]: data.bidValue
        }));
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
    socket.off('bid:live', handleLiveBid);
    socket.off('connect', handleSocketConnect);
    socket.emit('game:join', code);
    socket.on('game:update', handleGameUpdate);
    socket.on('bid:live', handleLiveBid);
    socket.on('connect', handleSocketConnect);

    return () => {
      socket.off('game:update', handleGameUpdate);
      socket.off('bid:live', handleLiveBid);
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

  useEffect(() => {
    if (game?.editPoll?.active) {
      sawActivePollRef.current = true;
    }
  }, [game?.editPoll?.active]);

  useEffect(() => {
    const enableSound = () => {
      soundEnabledRef.current = true;
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        void audioContextRef.current.resume();
      }
    };

    window.addEventListener('pointerdown', enableSound, { once: true });
    window.addEventListener('keydown', enableSound, { once: true });

    return () => {
      window.removeEventListener('pointerdown', enableSound);
      window.removeEventListener('keydown', enableSound);
    };
  }, []);

  useEffect(() => {
    function handleEditSignal(payload: unknown) {
      const data = payload as { gameCode?: string; round?: number; at?: number };
      if (!data?.gameCode || data.gameCode !== currentGameCodeRef.current) {
        return;
      }

      const key = `${data.gameCode}-${data.round ?? 'unknown'}-${data.at ?? 'unknown'}`;
      if (lastSirenKeyRef.current === key) {
        return;
      }

      lastSirenKeyRef.current = key;
      playSiren();
    }

    socket.off('edit:signal', handleEditSignal);
    socket.on('edit:signal', handleEditSignal);

    return () => {
      socket.off('edit:signal', handleEditSignal);
    };
  }, []);

  useEffect(() => {
    const activeGameSnapshot = game;
    const localPlayerId = activeGameSnapshot?.code ? getLocalPlayerId(activeGameSnapshot.code) : null;
    const isSuperClient =
      !!localPlayerId &&
      (activeGameSnapshot?.players ?? []).some((player) => player.id === localPlayerId && player.isSuperPlayer);
    const approvalGame = activeGameSnapshot;

    if (!approvalGame?.editPoll) {
      editApprovalHandledRef.current = null;
      sawActivePollRef.current = false;
      return;
    }

    if (!approvalGame.editPoll.active || !isSuperClient || isViewer) {
      if (!approvalGame.editPoll.active && !approvalGame.editPoll.approvedAt) {
        editApprovalHandledRef.current = null;
        sawActivePollRef.current = false;
      }
      return;
    }

    if (!approvalGame || !approvalGame.editPoll) {
      return;
    }

    const approvalGameSnapshot = approvalGame;
    const approvalPoll = approvalGameSnapshot.editPoll;

    if (!approvalPoll) {
      return;
    }

    const approvedRound = approvalPoll.round;
    const approvedAt = approvalPoll.approvedAt;

    if (!hasThresholdMet() || !sawActivePollRef.current) {
      return;
    }

    const approvalKey = `${approvalGameSnapshot.code}-${approvalPoll.round}`;
    if (approvedAt) {
      const seenKey = getEditApprovalKey(approvalGameSnapshot.code, approvalPoll.round, approvedAt);
      if (hasSeenEditApproval(seenKey)) {
        return;
      }
    }
    if (editApprovalHandledRef.current === approvalKey) {
      return;
    }

    editApprovalHandledRef.current = approvalKey;

    async function approveAndOpenEditor() {
      try {
        const response = await closeEditPoll(approvalGameSnapshot.code);
        setGame(response.game);
        setShowEditPollModal(false);
        setModalRound(null);
        setEditRound(approvedRound);
        if (approvedRound !== null) {
          // Do not open editor if game has finished
          if (response.game.status === 'finished') {
            return;
          }

          if (approvedAt) {
            const seenKey = getEditApprovalKey(approvalGameSnapshot.code, approvedRound, approvedAt);
            markEditApprovalSeen(seenKey);
          }

          // Ensure local bids state contains the round bids so tick toggles will work
          setBids((prev) => {
            const next = { ...prev };
            const serverRoundBids = response.game.bids?.[approvedRound] ?? {};
            next[approvedRound] = {
              ...(next[approvedRound] ?? {}),
            };
            Object.entries(serverRoundBids).forEach(([pid, entry]) => {
              next[approvedRound][pid] = {
                bid: entry.bid,
                completed: entry.completed,
                status: entry.status
              } as any;
            });
            return next;
          });

          openBidsModal(approvedRound);
        }
      } catch (err) {
        editApprovalHandledRef.current = null;
        setError(err instanceof Error ? err.message : 'Failed to close edit poll');
      }
    }

    void approveAndOpenEditor();
  }, [game?.code, game?.editPoll?.active, game?.editPoll?.round, game?.editPoll?.approvedAt, isViewer]);

  // When server marks poll closed and approved, open editor modal for super player
  useEffect(() => {
    const poll = game?.editPoll;
    if (!poll) return;
    const localPlayerId = game?.code ? getLocalPlayerId(game.code) : null;
    const isSuperClient =
      !isViewer &&
      !!localPlayerId &&
      (game?.players ?? []).some((player) => player.id === localPlayerId && player.isSuperPlayer);

    if (!poll.active && poll.approvedAt && isSuperClient && game?.status !== 'finished') {
      if (!sawActivePollRef.current) {
        return;
      }
      const seenKey = getEditApprovalKey(game.code, poll.round, poll.approvedAt);
      if (hasSeenEditApproval(seenKey)) {
        return;
      }
      const approvalKey = `${game.code}-${poll.round}`;
      if (editApprovalHandledRef.current === approvalKey) {
        return;
      }

      editApprovalHandledRef.current = approvalKey;
      markEditApprovalSeen(seenKey);
      // Open editor modal for the approved round
      setEditRound(poll.round);
      setModalRound(poll.round);
      const initial: Record<string, number | undefined> = {};
      (game?.players ?? []).forEach((p) => {
        initial[p.id] = bids[poll.round]?.[p.id]?.bid;
      });
      setModalBids(initial);
    }
  }, [game?.editPoll?.active, game?.editPoll?.approvedAt, game?.editPoll?.round, isViewer, game?.status, game?.players, bids]);

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
  const localPlayerId = getLocalPlayerId(activeGame.code);
  const isSuperPlayer =
    !isViewer &&
    !!localPlayerId &&
    activeGame.players.some((player) => player.id === localPlayerId && player.isSuperPlayer);
  const editPoll = activeGame.editPoll;
  const canEditSubmittedBids = modalRound !== null && editPoll?.approvedAt !== undefined && editPoll.round === modalRound;
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

    // Broadcast live bid to other players
    if (game?.code && bidValue !== undefined) {
      socket.emit('bid:live', {
        gameCode: game.code,
        cardRound,
        playerId,
        bidValue
      });
    }
  };

  const openBidsModal = (round: number) => {
    // initialize modal inputs from current bids
    const initial: Record<string, number | undefined> = {};
    (activeGame.players ?? []).forEach((p) => {
      initial[p.id] = bids[round]?.[p.id]?.bid;
    });
    setModalBids(initial);
    setModalRound(round);
  };

  const closeBidsModal = () => {
    setModalRound(null);
    setModalBids({});
  };

  const handleModalInputChange = (playerId: string, value?: number) => {
    setModalBids((prev) => ({ ...prev, [playerId]: value }));
  };

  // Get the card number for the current round (e.g., '3 Spades ♠' => 3)
  const getCardCountForRound = (round: number) => {
    const dist = activeGame.distribution.find((row) => row.round === round);
    if (dist) {
      const match = dist.label.match(/^(\d+)/);
      return match ? Number(match[1]) : 0;
    }
    return 0;
  };

  const getTotalBidCount = (roundBids: Record<string, number | undefined>) => {
    return Object.values(roundBids).reduce((sum: number, bid) => {
      if (bid === undefined || Number.isNaN(bid)) {
        return sum;
      }
      return sum + bid;
    }, 0);
  };

  const saveModalBids = async () => {
    if (modalRound === null) return;

    const cardCount = getCardCountForRound(modalRound);
    const totalBids = getTotalBidCount(modalBids);
    if (cardCount > 0 && totalBids === cardCount) {
      alert('Total bid is equal to total card number. Please enter a different total.');
      return;
    }

    if (canEditSubmittedBids && activeGame.code) {
      try {
        setSavingEdits(true);
        setError('');
        const roundBids = bids[modalRound] ?? {};
        const originalRoundBids = activeGame.bids?.[modalRound] ?? {};
        const changedEntries = Object.entries(roundBids).filter(([playerId, currentBid]) => {
          const originalBid = originalRoundBids[playerId];
          return currentBid?.bid !== undefined && !Number.isNaN(currentBid.bid) && originalBid?.completed !== currentBid.completed;
        });

        await withLoading('Editing points...', async () => {
          for (const [playerId, currentBid] of changedEntries) {
            const response = await submitBid(activeGame.code, {
              round: modalRound,
              playerId,
              bid: currentBid!.bid as number,
              completed: currentBid!.completed
            });

            setGame(response.game);
            populateBidsFromGame(response.game);
          }

          await resetEditPoll(activeGame.code);
        });
        setShowSaveToast(true);
        if (saveToastTimeoutRef.current) {
          window.clearTimeout(saveToastTimeoutRef.current);
        }
        saveToastTimeoutRef.current = window.setTimeout(() => {
          setShowSaveToast(false);
          closeBidsModal();
        }, 800);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save edited bids');
      } finally {
        setSavingEdits(false);
        if (!showSaveToast) {
          closeBidsModal();
        }
      }
      return;
    }

    setBids((prev) => {
      const next: BidEntry = { ...prev };
      next[modalRound] = {
        ...(next[modalRound] ?? {})
      };

      Object.entries(modalBids).forEach(([playerId, bidVal]) => {
        next[modalRound][playerId] = {
          bid: bidVal,
          completed: false,
          status: 'pending'
        };
      });

      return next;
    });

    // close modal but do not submit to server (not final)
    closeBidsModal();
  };

  const handleEditCompletionToggle = (playerId: string, isComplete: boolean) => {
    if (modalRound === null) return;

    const existingBid = bids[modalRound]?.[playerId];
    if (existingBid?.bid === undefined || Number.isNaN(existingBid.bid)) {
      return;
    }

    setBids((prev) => ({
      ...prev,
      [modalRound]: {
        ...(prev[modalRound] ?? {}),
        [playerId]: {
          bid: existingBid.bid,
          completed: isComplete,
          status: isComplete ? 'success' : 'fail'
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

    const cardCount = getCardCountForRound(cardRound);
    const currentRoundBids = Object.fromEntries(
      playerColumns.map((player) => [player.id, bids[cardRound]?.[player.id]?.bid])
    );
    currentRoundBids[playerId] = bidValue;
    const totalBids = getTotalBidCount(currentRoundBids);
    if (cardCount > 0 && totalBids === cardCount) {
      alert('Total bid is equal to total card number. Please enter a different total.');
      return;
    }

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

    // Clear live bid display once submitted
    const liveBidKey = `${cardRound}-${playerId}`;
    setLiveBids((prev) => {
      const { [liveBidKey]: _, ...rest } = prev;
      return rest;
    });

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

  const checkAllBidsSubmitted = () => {
    if (!activeGame) return false;
    return activeGame.players.every((player) => {
      const hasSubmittedBid = Object.values(activeGame.bids).some((roundBids) => {
        const bidEntry = roundBids[player.id];
        return bidEntry && (bidEntry.status === 'success' || bidEntry.status === 'fail');
      });
      return hasSubmittedBid;
    });
  };

  const checkRoundBidsSubmitted = (round: number) => {
    if (!activeGame) return false;
    const roundBids = activeGame.bids[round];
    if (!roundBids) return false;
    
    return activeGame.players.every((player) => {
      const bidEntry = roundBids[player.id];
      return bidEntry && (bidEntry.status === 'success' || bidEntry.status === 'fail');
    });
  };

  const isWithin2MinuteWindow = (round: number) => {
    const submittedAt = game?.roundCompletionTimes?.[round];
    if (!submittedAt) return false;

    const timeSinceSubmission = Date.now() - submittedAt;
    return timeSinceSubmission <= 2 * 60 * 1000;
  };

  const getPollVoteStats = () => {
    if (!game?.editPoll) return { yes: 0, no: 0, total: game?.players.length ?? 0 };
    const votes = game.editPoll.votes ?? {};
    const yesCount = Object.values(votes).filter((v) => v === true).length;
    const noCount = Object.values(votes).filter((v) => v === false).length;
    return { yes: yesCount, no: noCount, total: game.players.length };
  };

  const hasThresholdMet = () => {
    const stats = getPollVoteStats();
    if (stats.total === 0) return false;
    return stats.yes >= Math.ceil(stats.total * 0.5);
  };

  const handleOpenEditPoll = (round: number) => {
    setEditRound(round);
    setEditMessage('');
    setEditMessageError('');
    setShowEditPollModal(true);

    if (game?.code) {
      socket.emit('edit:signal', { gameCode: game.code, round, at: Date.now() });
    }
  };

  const closeEditPollModal = () => {
    setShowEditPollModal(false);
    setEditMessage('');
    setEditMessageError('');
  };

  const handleSubmitEditPoll = async () => {
    if (!editMessage.trim()) {
      setEditMessageError('Please enter a message for the edit request');
      return;
    }

    if (!activeGame.code || !isSuperPlayer || editRound === null) return;

    setError('');
    try {
      const response = await withLoading('Initiating poll...', () =>
        initiateEditPoll(activeGame.code, {
          playerId: activeGame.players.find((p) => p.isSuperPlayer)?.id ?? '',
          message: editMessage,
          round: editRound
        })
      );
      setGame(response.game);
      closeEditPollModal();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to initiate edit poll';
      setError(errorMsg);
    }
  };


  const handleVoteOnPoll = async (vote: boolean) => {
    if (!activeGame.code) return;

    if (!editVoterId) return;

    try {
      const response = await voteOnEditPoll(activeGame.code, {
        playerId: editVoterId,
        vote
      });
      setGame(response.game);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to vote';
      setError(errorMsg);
    }
  };

  const handleManualClosePoll = async () => {
    if (!activeGame.code || !isSuperPlayer) return;

    setError('');
    try {
      const response = await closeEditPoll(activeGame.code);
      setGame(response.game);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to close poll';
      setError(errorMsg);
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

  const getCardSuitClass = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes('heart') || normalized.includes('diamond')) {
      return 'suit-red';
    }
    if (normalized.includes('spade') || normalized.includes('club')) {
      return 'suit-black';
    }
    return 'suit-black';
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
    const liveBidKey = `${cardRound}-${player.id}`;
    const liveBidValue = liveBids[liveBidKey];


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
                  handleBidChange(cardRound, player.id, nextBid);
                }}
                placeholder="0"
                disabled={isSubmitted}
              />
            </div>
            <div className="bid-actions">
              <button
                onClick={() => handleMarkBid(cardRound, player.id, true)}
                disabled={bidEntry?.bid === undefined || Number.isNaN(bidEntry.bid) || isSubmitted}
                className="bid-btn success"
                title="Mark as complete (✓)"
              >
                ✓
              </button>
              <button
                onClick={() => handleMarkBid(cardRound, player.id, false)}
                disabled={bidEntry?.bid === undefined || Number.isNaN(bidEntry.bid) || isSubmitted}
                className="bid-btn fail"
                title="Mark as incomplete (✗)"
              >
                ✗
              </button>
            </div>
          </div>
        );
      }
      // Already submitted: show as read-only
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
        ) : liveBidValue !== undefined ? (
          <span className="bid-value live-bid">#{liveBidValue}</span>
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

      {showSaveToast ? (
        <div className="save-toast" role="status" aria-live="polite">
          ✓ Saved
        </div>
      ) : null}

      {modalRound !== null ? (
        <div className="bids-modal-overlay" role="dialog" aria-modal="true">
          <div className="bids-modal-backdrop" />
          <div className="bids-modal-card">
            <button
              type="button"
              className="bids-modal-close"
              onClick={closeBidsModal}
              aria-label="Close bids modal"
            >
              Close
            </button>
            <p className="eyebrow">Batch edit bids</p>
            <h2>Round {modalRound}</h2>
            <p className="muted">
              {activeGame.distribution.find((d) => d.round === modalRound)?.label}
            </p>


            <div className="bids-modal-list">
              {activeGame.players.map((p) => {
                const submittedBid = bids[modalRound]?.[p.id];
                const isSubmitted = submittedBid && (submittedBid.status === 'success' || submittedBid.status === 'fail');
                return (
                  <div key={p.id} className="bids-modal-row">
                    <label className="muted">{p.name}</label>
                    {canEditSubmittedBids ? (
                      <div className="bids-modal-edit-controls">
                        <span className="bids-modal-bid-chip">
                          <span>{submittedBid?.bid ?? ''}</span>
                          <span
                            className={`edit-status-indicator ${submittedBid?.completed ? 'is-complete' : 'is-incomplete'}`}
                          >
                            {submittedBid?.completed ? '✓' : '✗'}
                          </span>
                        </span>
                        <div className="bids-modal-edit-actions">
                          <button
                            type="button"
                            className={`bid-btn success ${submittedBid?.completed ? 'is-active' : ''}`}
                            onClick={() => handleEditCompletionToggle(p.id, true)}
                            title="Mark as complete (✓)"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            className={`bid-btn fail ${submittedBid?.completed === false ? 'is-active' : ''}`}
                            onClick={() => handleEditCompletionToggle(p.id, false)}
                            title="Mark as incomplete (✗)"
                          >
                            ✗
                          </button>
                        </div>
                      </div>
                    ) : isSubmitted ? (
                      <span style={{ minWidth: 60, textAlign: 'center', fontWeight: 700 }}>
                        {submittedBid?.bid ?? ''}
                        <span style={{ marginLeft: 6, color: submittedBid?.status === 'success' ? '#16a34a' : '#b91c1c' }}>
                          {submittedBid?.status === 'success' ? '✓' : '✗'}
                        </span>
                      </span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={maxTwoDigitBid}
                        value={modalBids[p.id] ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const numeric = raw.replace(/\D/g, '');
                          if (numeric === '') {
                            handleModalInputChange(p.id, undefined);
                            return;
                          }
                          handleModalInputChange(p.id, Math.min(Number(numeric), maxTwoDigitBid));
                        }}
                        placeholder="0"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bids-modal-actions">
              {(() => {
                // Hide Save if all bids are submitted
                const allSubmitted = activeGame.players.every((p) => {
                  const submittedBid = bids[modalRound]?.[p.id];
                  return submittedBid && (submittedBid.status === 'success' || submittedBid.status === 'fail');
                });
                return (!allSubmitted || canEditSubmittedBids) ? (
                  <button
                    type="button"
                    onClick={saveModalBids}
                    className="start-game-btn"
                    disabled={savingEdits}
                  >
                    {canEditSubmittedBids ? (savingEdits ? 'Editing points...' : 'Save Edits') : 'Save'}
                  </button>
                ) : null;
              })()}
              
            </div>
          </div>
        </div>
      ) : null}

      {showEditPollModal && !game?.editPoll?.active ? (
        <div className="edit-poll-modal-overlay" role="dialog" aria-modal="true">
          <div className="edit-poll-modal-backdrop" />
          <div className="edit-poll-modal-card">
            <button
              type="button"
              className="edit-poll-modal-close"
              onClick={closeEditPollModal}
              aria-label="Close edit poll modal"
            >
              Close
            </button>
            <p className="eyebrow">Request Edit Permission</p>
            <h2>
              Edit Round {editRound}
              {editRound && activeGame.distribution.find((d) => d.round === editRound) && (
                <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 400, marginTop: '4px' }}>
                  {activeGame.distribution.find((d) => d.round === editRound)?.label}
                </span>
              )}
            </h2>
            <p className="muted">
              Describe what you want to edit. A poll will be sent to all players. You need at least 50% approval to edit.
            </p>

            <div className="edit-poll-form">
              <label className="muted">Edit Message</label>
              <textarea
                value={editMessage}
                onChange={(e) => {
                  setEditMessage(e.target.value);
                  setEditMessageError('');
                }}
                placeholder="e.g., 'Need to correct player 1 bid for this round'"
                maxLength={500}
                rows={4}
              />
              {editMessageError && <p style={{ color: '#dc2626', fontSize: '0.875rem' }}>{editMessageError}</p>}
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                {editMessage.length} / 500 characters
              </p>
            </div>

            <div className="edit-poll-actions">
              <button
                type="button"
                onClick={handleSubmitEditPoll}
                className="start-game-btn"
              >
                Send Poll to Players
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {game?.editPoll?.active ? (
        <div className="edit-poll-voting-modal-overlay" role="dialog" aria-modal="true">
          <div className="edit-poll-voting-modal-backdrop" />
          <div className="edit-poll-voting-modal-card">
            {isSuperPlayer && (
              <button
                type="button"
                className="edit-poll-modal-close"
                onClick={handleManualClosePoll}
                aria-label="Close edit poll"
                title="Close poll (super player only)"
              >
                ✕
              </button>
            )}
            <p className="eyebrow">Edit Poll - Round {editPoll?.round}</p>
            <h2>
              Edit Round {editPoll?.round}
              {editPoll?.round && activeGame.distribution.find((d) => d.round === editPoll.round) && (
                <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 400, marginTop: '4px' }}>
                  {activeGame.distribution.find((d) => d.round === editPoll.round)?.label}
                </span>
              )}
            </h2>
            <p className="muted">
              {editPoll?.message}
            </p>

            {(() => {
              const stats = getPollVoteStats();
              return (
                <div className="poll-stats">
                  <div className="poll-stat-row">
                    <span>Total Players:</span>
                    <strong>{stats.total}</strong>
                  </div>
                  <div className="poll-stat-row">
                    <span>Yes Votes:</span>
                    <strong style={{ color: '#16a34a' }}>{stats.yes}</strong>
                  </div>
                  <div className="poll-stat-row">
                    <span>No Votes:</span>
                    <strong style={{ color: '#b91c1c' }}>{stats.no}</strong>
                  </div>
                  <div className="poll-stat-row">
                    <span>Still Voting:</span>
                    <strong>{stats.total - stats.yes - stats.no}</strong>
                  </div>
                  {pollTimeRemaining !== null && (
                    <div className="poll-stat-row">
                      <span>Time Remaining:</span>
                      <strong>{pollTimeRemaining}s</strong>
                    </div>
                  )}
                  {stats.yes + stats.no > 0 && (
                    <div className="poll-requirement">
                      {hasThresholdMet() ? (
                        <p style={{ color: '#16a34a' }}>✓ Threshold met! Edit will be allowed.</p>
                      ) : (
                        <p style={{ color: '#b91c1c' }}>Need {Math.ceil(stats.total * 0.5)} votes (50%) to proceed.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {!editPoll || !Object.prototype.hasOwnProperty.call(editPoll.votes, editVoterId) ? (
              <div className="poll-voting-actions">
                <button
                  type="button"
                  onClick={() => handleVoteOnPoll(true)}
                  className="vote-yes-btn"
                  style={{ backgroundColor: '#16a34a' }}
                >
                  ✓ Yes
                </button>
                <button
                  type="button"
                  onClick={() => handleVoteOnPoll(false)}
                  className="vote-no-btn"
                  style={{ backgroundColor: '#b91c1c' }}
                >
                  ✗ No
                </button>
              </div>
            ) : (
              <div className="poll-voted-message">
                <p>✓ You have voted and cannot change it</p>
              </div>
            )}
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
            {isViewer ? (
              <thead>
                <tr>
                  <th scope="col">Cards</th>
                  {playerColumns.map((player) => (
                    <th
                      key={player.id}
                      scope="col"
                      className="player-column viewer-player-column"
                      title={player.name}
                    >
                      <span className="player-dot" aria-hidden="true" />
                      <span className="player-name-short" aria-label={player.name}>
                        {getPlayerShortName(player.name)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {activeGame.distribution.map((row) => {
                const roundBidsComplete = checkRoundBidsSubmitted(row.round);
                const showEditButton = isSuperPlayer && roundBidsComplete && isWithin2MinuteWindow(row.round) && !game?.editPoll?.active;
                
                return (
                  <tr key={row.round}>
                    <td
                      onClick={() => {
                        if (isSuperPlayer) {
                          openBidsModal(row.round);
                        }
                      }}
                      role={isSuperPlayer ? 'button' : undefined}
                      aria-pressed={isSuperPlayer ? false : undefined}
                      style={isSuperPlayer ? { cursor: 'pointer' } : undefined}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                        <div>
                          <strong className={`card-label-full ${getCardSuitClass(row.label)}`}>{row.label}</strong>
                          <strong className={`card-label-short ${getCardSuitClass(row.label)}`} aria-label={row.label}>
                            {getCardShortLabel(row.label)}
                          </strong>
                        </div>
                        {showEditButton && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditPoll(row.round);
                            }}
                            className="row-edit-btn"
                            title="Edit this round's bids"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
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
                );
              })}
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
