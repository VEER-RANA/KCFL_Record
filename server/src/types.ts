export type CardSuit = 'Hearts' | 'Diamonds' | 'Clubs' | 'Spades' | 'Without Sir';

export type DistributionDirection = 'ascending' | 'descending';

export interface GameSettings {
  playerCount: number;
  maxCardsPerPlayer: number;
  distributionDirection: DistributionDirection;
  includeWithoutSir: boolean;
  suitOrder: CardSuit[];
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  isSuperPlayer: boolean;
  currentBid: number;
  completedBid: boolean;
  bidSuccess: boolean;
  score: number;
  totalScore: number;
}

export interface DistributionCell {
  round: number;
  label: string;
  cardsByPlayer: Array<{
    playerId: string;
    playerName: string;
    cardLabel: string;
  }>;
}

export interface BidCell {
  bid: number;
  completed: boolean;
  status: 'success' | 'fail';
}

export interface GameSnapshot {
  id: string;
  code: string;
  name: string;
  status: 'lobby' | 'running' | 'finished';
  settings: GameSettings;
  players: PlayerState[];
  bids: Record<number, Record<string, BidCell>>;
  distribution: DistributionCell[];
  ranking: Array<{
    playerId: string;
    playerName: string;
    totalScore: number;
  }>;
}
