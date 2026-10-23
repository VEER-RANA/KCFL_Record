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

export async function renamePlayer(code: string, playerId: string, newName: string) {
  const game = await getGame(code);
  if (!game) {
    return null;
  }

  const playerIndex = game.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return null;
  }

  const nextPlayers = game.players.map((p) =>
    p.id === playerId ? { ...p, name: newName } : p
  );

  // Also update playerName in distribution cardsByPlayer entries
  const nextDistribution = game.distribution.map((row) => ({
    ...row,
    cardsByPlayer: row.cardsByPlayer.map((card) =>
      card.playerId === playerId ? { ...card, playerName: newName } : card
    )
  }));

  const nextRanking = game.ranking.map((entry) =>
    entry.playerId === playerId ? { ...entry, playerName: newName } : entry
  );

  const nextGame: GameSnapshot = {
    ...game,
    players: nextPlayers,
    distribution: nextDistribution,
    ranking: nextRanking
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
