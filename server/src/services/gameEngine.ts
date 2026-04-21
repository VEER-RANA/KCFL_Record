import { nanoid } from 'nanoid';
import type { DistributionCell, GameSettings, PlayerState } from '../types.js';

const DEFAULT_DISTRIBUTION_ROWS = 10;
const FORWARD_SUIT_SEQUENCE = ['Spades', 'Diamonds', 'Clubs', 'Hearts'] as const;
const SUIT_SYMBOLS: Record<typeof FORWARD_SUIT_SEQUENCE[number], string> = {
  Spades: '♠',
  Diamonds: '♦',
  Clubs: '♣',
  Hearts: '♥'
};

function getWaveNumber(index: number, maxCardsPerPlayer: number, distributionDirection: GameSettings['distributionDirection']) {
  const cycleLength = maxCardsPerPlayer * 2;
  const cycleIndex = index % cycleLength;

  if (distributionDirection === 'ascending') {
    if (cycleIndex < maxCardsPerPlayer) {
      return cycleIndex + 1;
    }

    return cycleLength - cycleIndex;
  }

  if (cycleIndex < maxCardsPerPlayer) {
    return maxCardsPerPlayer - cycleIndex;
  }

  return cycleIndex - maxCardsPerPlayer + 1;
}

function getSuitForRow(index: number, includeWithoutSir: boolean) {
  const blockSize = includeWithoutSir ? FORWARD_SUIT_SEQUENCE.length + 1 : FORWARD_SUIT_SEQUENCE.length;
  const positionInBlock = index % blockSize;

  if (includeWithoutSir && positionInBlock === FORWARD_SUIT_SEQUENCE.length) {
    return 'Without Sir' as const;
  }

  return FORWARD_SUIT_SEQUENCE[positionInBlock] as typeof FORWARD_SUIT_SEQUENCE[number];
}

function formatSuitLabel(suit: ReturnType<typeof getSuitForRow>) {
  if (suit === 'Without Sir') {
    return 'Without';
  }

  return `${suit} ${SUIT_SYMBOLS[suit]}`;
}

export function createGameCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function createPlayerState(name: string, color: string, isHost = false, isSuperPlayer = false): PlayerState {
  return {
    id: nanoid(8),
    name,
    color,
    isHost,
    isSuperPlayer,
    currentBid: 0,
    completedBid: false,
    bidSuccess: false,
    score: 0,
    totalScore: 0
  };
}

export function buildDistribution(
  players: PlayerState[],
  settings: GameSettings,
  totalRows = DEFAULT_DISTRIBUTION_ROWS,
  startRound = 1
): DistributionCell[] {
  return Array.from({ length: totalRows }, (_, rowOffset) => {
    const rowIndex = startRound - 1 + rowOffset;
    const round = rowIndex + 1;
    const number = getWaveNumber(rowIndex, settings.maxCardsPerPlayer, settings.distributionDirection);
    const suit = getSuitForRow(rowIndex, settings.includeWithoutSir);
    const suitLabel = formatSuitLabel(suit);
    const label = `${number} ${suitLabel}`;

    const assignedPlayerIndex = players.length > 0 ? rowIndex % players.length : 0;
    const assignedPlayer = players[assignedPlayerIndex];

    const cardsByPlayer = assignedPlayer
      ? [
          {
            playerId: assignedPlayer.id,
            playerName: assignedPlayer.name,
            cardLabel: label
          }
        ]
      : [];

    return {
      round,
      label,
      cardsByPlayer
    };
  });
}

export function appendDistribution(players: PlayerState[], settings: GameSettings, existingRows: DistributionCell[], rowsToAdd: number) {
  const startRound = existingRows.length + 1;
  const appendedRows = buildDistribution(players, settings, rowsToAdd, startRound);
  return [...existingRows, ...appendedRows];
}

export function calculateRanking(players: PlayerState[]) {
  return [...players]
    .sort((left, right) => right.totalScore - left.totalScore)
    .map((player) => ({
      playerId: player.id,
      playerName: player.name,
      totalScore: player.totalScore
    }));
}

export function applyBidResult(players: PlayerState[], playerId: string, bid: number, completed: boolean) {
  return players.map((player) => {
    if (player.id !== playerId) {
      return player;
    }

    const score = completed ? bid + 10 : 0;
    return {
      ...player,
      currentBid: bid,
      completedBid: completed,
      bidSuccess: completed,
      score,
      totalScore: player.totalScore + score
    };
  });
}
