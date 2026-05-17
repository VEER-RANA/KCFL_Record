import { createGameCode, createPlayerState, buildDistribution, appendDistribution, calculateRanking } from '../services/gameEngine.js';
import { GameModel } from '../models/Game.js';
import type { BidCell, GameSettings, GameSnapshot } from '../types.js';

const GAME_TTL_MS = 60 * 60 * 1000;
const PLAYER_COLOR_PALETTE = [
  '#22c55e',
  '#38bdf8',
  '#e879f9',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#84cc16',
  '#f97316',
  '#06b6d4'
];

function getExpiryDate() {
  return new Date(Date.now() + GAME_TTL_MS);
}

function normalizeBids(rawBids: unknown): GameSnapshot['bids'] {
  if (!rawBids || typeof rawBids !== 'object' || Array.isArray(rawBids)) {
    return {};
  }

  return rawBids as GameSnapshot['bids'];
}

function toSnapshot(gameDoc: Record<string, unknown>): GameSnapshot {
  return {
    id: String(gameDoc.code ?? ''),
    code: String(gameDoc.code ?? ''),
    name: String(gameDoc.name ?? ''),
    status: (gameDoc.status as GameSnapshot['status']) ?? 'lobby',
    settings: gameDoc.settings as GameSettings,
    players: (gameDoc.players as GameSnapshot['players']) ?? [],
    bids: normalizeBids(gameDoc.bids),
    distribution: (gameDoc.distribution as GameSnapshot['distribution']) ?? [],
    ranking: (gameDoc.ranking as GameSnapshot['ranking']) ?? [],
    allBidsSubmittedAt: gameDoc.allBidsSubmittedAt as number | undefined,
    roundCompletionTimes: gameDoc.roundCompletionTimes as Record<number, number> | undefined,
    editPoll: gameDoc.editPoll as GameSnapshot['editPoll'] | undefined
  };
}

function toPersistence(game: GameSnapshot) {
  return {
    code: game.code,
    name: game.name,
    status: game.status,
    settings: game.settings,
    players: game.players,
    bids: game.bids,
    distribution: game.distribution,
    ranking: game.ranking,
    allBidsSubmittedAt: game.allBidsSubmittedAt,
    roundCompletionTimes: game.roundCompletionTimes,
    editPoll: game.editPoll
  };
}

function getRandomHexColor() {
  const randomColor = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `#${randomColor}`;
}

function getPlayerColor(game: GameSnapshot, selectedColor?: string) {
  if (selectedColor) {
    return selectedColor;
  }

  const usedColors = new Set(game.players.map((player) => player.color.toLowerCase()));
  const availableColors = PLAYER_COLOR_PALETTE.filter((color) => !usedColors.has(color.toLowerCase()));

  if (availableColors.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableColors.length);
    return availableColors[randomIndex];
  }

  let fallbackColor = getRandomHexColor();
  while (usedColors.has(fallbackColor.toLowerCase())) {
    fallbackColor = getRandomHexColor();
  }

  return fallbackColor;
}

export async function createGame(name: string, settings: GameSettings, superPlayerName: string) {
  const code = createGameCode();
  const host = createPlayerState(superPlayerName, '#d97706', true, true);
  const players = [host];
  const game: GameSnapshot = {
    id: code,
    code,
    name,
    status: 'lobby',
    settings,
    players,
    bids: {},
    distribution: buildDistribution(players, settings),
    ranking: calculateRanking(players)
  };

  await GameModel.create({
    ...toPersistence(game),
    expiresAt: getExpiryDate()
  });

  return game;
}

export async function getGame(code: string) {
  const gameDoc = await GameModel.findOne({ code }).lean();
  if (!gameDoc) {
    return null;
  }

  return toSnapshot(gameDoc as Record<string, unknown>);
}

export async function addPlayerToGame(code: string, playerName: string, color?: string) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  const playerColor = getPlayerColor(game, color);
  const player = createPlayerState(playerName, playerColor, false, false);
  const nextPlayers = [...game.players, player].slice(0, game.settings.playerCount);
  const nextGame: GameSnapshot = {
    ...game,
    players: nextPlayers,
    distribution: buildDistribution(nextPlayers, game.settings),
    ranking: calculateRanking(nextPlayers)
  };

  const savedDoc = await GameModel.findOneAndUpdate(
    { code },
    {
      $set: {
        ...toPersistence(nextGame),
        expiresAt: getExpiryDate()
      }
    },
    { new: true, lean: true }
  );

  return savedDoc ? toSnapshot(savedDoc as Record<string, unknown>) : null;
}

export async function extendGameDistribution(code: string, rowsToAdd: number) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  const sanitizedRowsToAdd = Math.max(1, Math.floor(rowsToAdd));
  const nextDistribution = appendDistribution(game.players, game.settings, game.distribution, sanitizedRowsToAdd);
  const nextGame: GameSnapshot = {
    ...game,
    distribution: nextDistribution
  };

  const savedDoc = await GameModel.findOneAndUpdate(
    { code },
    {
      $set: {
        ...toPersistence(nextGame),
        expiresAt: getExpiryDate()
      }
    },
    { new: true, lean: true }
  );

  return savedDoc ? toSnapshot(savedDoc as Record<string, unknown>) : null;
}

export async function updateBid(code: string, round: number, playerId: string, bid: number, completed: boolean) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  const existingBid = game.bids[round]?.[playerId];
  const canEditSubmittedBid = hasApprovedEdit(game, round);
  if (existingBid && !canEditSubmittedBid) {
    return game;
  }

  const roundBids = game.bids[round] ?? {};
  const nextBidsForPlayers: GameSnapshot['bids'] = {
    ...game.bids,
    [round]: {
      ...roundBids,
      [playerId]: {
        bid,
        completed,
        status: (completed ? 'success' : 'fail') as BidCell['status']
      }
    }
  };

  const nextPlayers = rebuildPlayerScores({
    ...game,
    bids: nextBidsForPlayers
  });

  const updatedRoundBids = nextBidsForPlayers[round];
  const allRoundBidsSubmitted = game.players.every((player) => {
    const bidEntry = updatedRoundBids[player.id];
    return bidEntry && (bidEntry.status === 'success' || bidEntry.status === 'fail');
  });

  const roundCompletionTimes = { ...(game.roundCompletionTimes ?? {}) };
  if (allRoundBidsSubmitted && !roundCompletionTimes[round]) {
    roundCompletionTimes[round] = Date.now();
  }

  const nextGame: GameSnapshot = {
    ...game,
    players: nextPlayers,
    bids: nextBidsForPlayers,
    ranking: calculateRanking(nextPlayers),
    roundCompletionTimes
  };

  const savedDoc = await GameModel.findOneAndUpdate(
    { code },
    {
      $set: {
        ...toPersistence(nextGame),
        expiresAt: getExpiryDate()
      }
    },
    { new: true, lean: true }
  );

  return savedDoc ? toSnapshot(savedDoc as Record<string, unknown>) : null;
}

export async function resetEditPoll(code: string) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  if (!game.editPoll) {
    return game;
  }

  const nextGame: GameSnapshot = {
    ...game,
    editPoll: undefined
  };

  const savedDoc = await GameModel.findOneAndUpdate(
    { code },
    {
      $set: {
        ...toPersistence(nextGame),
        expiresAt: getExpiryDate()
      }
    },
    { new: true, lean: true }
  );

  return savedDoc ? toSnapshot(savedDoc as Record<string, unknown>) : null;
}

export async function endGame(code: string) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  const nextGame: GameSnapshot = {
    ...game,
    status: 'finished'
  };

  // Keep finished game for report generation; TTL will remove it automatically.
  const savedDoc = await GameModel.findOneAndUpdate(
    { code },
    {
      $set: {
        ...toPersistence(nextGame),
        expiresAt: getExpiryDate()
      }
    },
    { new: true, lean: true }
  );

  return savedDoc ? toSnapshot(savedDoc as Record<string, unknown>) : null;
}

export async function listGames() {
  const games = await GameModel.find().lean();
  return games.map((gameDoc) => toSnapshot(gameDoc as Record<string, unknown>));
}

function checkAllBidsSubmitted(game: GameSnapshot): boolean {
  const players = game.players;
  if (players.length === 0) return false;

  // All players must have submitted at least one bid
  return players.every((player) => {
    // Check if player has any submitted bid in any round
    return Object.values(game.bids).some((roundBids) => {
      const bidEntry = roundBids[player.id];
      return bidEntry && (bidEntry.status === 'success' || bidEntry.status === 'fail');
    });
  });
}

function checkRoundBidsSubmitted(game: GameSnapshot, round: number): boolean {
  const players = game.players;
  if (players.length === 0) return false;

  const roundBids = game.bids[round];
  if (!roundBids) return false;

  // All players must have submitted bid for this round
  return players.every((player) => {
    const bidEntry = roundBids[player.id];
    return bidEntry && (bidEntry.status === 'success' || bidEntry.status === 'fail');
  });
}

function hasApprovedEdit(game: GameSnapshot, round: number): boolean {
  return game.editPoll?.approvedAt !== undefined && game.editPoll.round === round;
}

function rebuildPlayerScores(game: GameSnapshot): GameSnapshot['players'] {
  const nextPlayers = game.players.map((player) => ({
    ...player,
    currentBid: 0,
    completedBid: false,
    bidSuccess: false,
    score: 0,
    totalScore: 0
  }));

  const playerById = new Map(nextPlayers.map((player) => [player.id, player] as const));

  Object.entries(game.bids).forEach(([, roundBids]) => {
    Object.entries(roundBids).forEach(([playerId, bidEntry]) => {
      const player = playerById.get(playerId);
      if (!player) {
        return;
      }

      const score = bidEntry.completed ? bidEntry.bid + 10 : 0;
      player.currentBid = bidEntry.bid;
      player.completedBid = bidEntry.completed;
      player.bidSuccess = bidEntry.completed;
      player.score = score;
      player.totalScore += score;
    });
  });

  return nextPlayers;
}

export async function initiateEditPoll(code: string, initiatedByPlayerId: string, message: string, round: number) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  // Check if all bids for this round are submitted
  if (!checkRoundBidsSubmitted(game, round)) {
    throw new Error('Not all players have submitted bids for this round yet');
  }

  // Check if edit poll already exists for this round
  if (game.editPoll?.active) {
    throw new Error('An edit poll is already active for this game');
  }

  // Ensure this round is still within the 2-minute edit visibility window
  const roundSubmittedAt = game.roundCompletionTimes?.[round];
  if (!roundSubmittedAt) {
    throw new Error('Round submission time not found');
  }

  const TWO_MIN_MS = 2 * 60 * 1000;
  if (Date.now() - roundSubmittedAt > TWO_MIN_MS) {
    throw new Error('Edit window for this round has expired');
  }

  // Ensure initiator is the super player
  const initiator = game.players.find((p) => p.id === initiatedByPlayerId);
  if (!initiator || !initiator.isSuperPlayer) {
    throw new Error('Only super player may initiate an edit poll');
  }

  const initiatedAt = Date.now();

  const nextGame: GameSnapshot = {
    ...game,
    editPoll: {
      active: true,
      initiatedAt,
      initiatedBy: initiatedByPlayerId,
      message,
      round,
      votes: {}
    }
  };

  const savedDoc = await GameModel.findOneAndUpdate(
    { code },
    {
      $set: {
        ...toPersistence(nextGame),
        expiresAt: getExpiryDate()
      }
    },
    { new: true, lean: true }
  );

  return savedDoc ? toSnapshot(savedDoc as Record<string, unknown>) : null;
}

export async function voteOnEditPoll(code: string, playerId: string, vote: boolean) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  if (!game.editPoll || !game.editPoll.active) {
    throw new Error('No active edit poll');
  }

  // If the poll has expired on the server, close it and return
  const POLL_WINDOW_MS = 60 * 1000;
  if (Date.now() - (game.editPoll.initiatedAt ?? 0) > POLL_WINDOW_MS) {
    const closedGame: GameSnapshot = {
      ...game,
      editPoll: {
        ...game.editPoll,
        active: false
      }
    };

    const savedExpired = await GameModel.findOneAndUpdate(
      { code },
      {
        $set: {
          ...toPersistence(closedGame),
          expiresAt: getExpiryDate()
        }
      },
      { new: true, lean: true }
    );

    return savedExpired ? toSnapshot(savedExpired as Record<string, unknown>) : null;
  }

  if (Object.prototype.hasOwnProperty.call(game.editPoll.votes, playerId)) {
    return game;
  }

  // Record the vote
  const updatedVotes = {
    ...game.editPoll.votes,
    [playerId]: vote
  };

  let nextEditPoll = {
    ...game.editPoll,
    votes: updatedVotes
  } as NonNullable<GameSnapshot['editPoll']>;

  const totalVotesRequired = game.players.length;
  const totalVotesCast = Object.keys(updatedVotes).length;
  const yesVotes = Object.values(updatedVotes).filter((currentVote) => currentVote === true).length;
  const remainingVotes = Math.max(totalVotesRequired - totalVotesCast, 0);
  const canStillReachThreshold = yesVotes + remainingVotes >= Math.ceil(totalVotesRequired * 0.5);

  // Close the poll when it is approved or when every player has voted.
  const tentativeGame: GameSnapshot = {
    ...game,
    editPoll: nextEditPoll
  };

  if (hasThresholdMet(tentativeGame)) {
    nextEditPoll = {
      ...nextEditPoll,
      active: false,
      approvedAt: Date.now()
    } as NonNullable<GameSnapshot['editPoll']>;
  } else if (!canStillReachThreshold) {
    nextEditPoll = {
      ...nextEditPoll,
      active: false
    } as NonNullable<GameSnapshot['editPoll']>;
  } else if (totalVotesCast >= totalVotesRequired) {
    nextEditPoll = {
      ...nextEditPoll,
      active: false
    } as NonNullable<GameSnapshot['editPoll']>;
  } else {
    // Explicitly ensure poll remains active when threshold is not met
    nextEditPoll = {
      ...nextEditPoll,
      active: true
    } as NonNullable<GameSnapshot['editPoll']>;
  }

  const nextGame: GameSnapshot = {
    ...game,
    editPoll: nextEditPoll
  };

  const savedDoc = await GameModel.findOneAndUpdate(
    { code },
    {
      $set: {
        ...toPersistence(nextGame),
        expiresAt: getExpiryDate()
      }
    },
    { new: true, lean: true }
  );

  return savedDoc ? toSnapshot(savedDoc as Record<string, unknown>) : null;
}

export async function closedEditPoll(code: string) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  if (!game.editPoll) {
    return game;
  }

  const nextGame: GameSnapshot = {
    ...game,
    editPoll: {
      ...game.editPoll,
      active: false,
      approvedAt: hasThresholdMet(game) ? Date.now() : game.editPoll.approvedAt
    }
  };

  const savedDoc = await GameModel.findOneAndUpdate(
    { code },
    {
      $set: {
        ...toPersistence(nextGame),
        expiresAt: getExpiryDate()
      }
    },
    { new: true, lean: true }
  );

  return savedDoc ? toSnapshot(savedDoc as Record<string, unknown>) : null;
}

function hasThresholdMet(game: GameSnapshot) {
  const playerCount = game.players.length;
  if (playerCount === 0 || !game.editPoll) {
    return false;
  }

  const yesVotes = Object.values(game.editPoll.votes).filter((vote) => vote === true).length;
  return yesVotes >= Math.ceil(playerCount * 0.5);
}
