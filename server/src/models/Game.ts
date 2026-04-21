import { Schema, model, type InferSchemaType } from 'mongoose';

const playerSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, required: true },
    isHost: { type: Boolean, default: false },
    isSuperPlayer: { type: Boolean, default: false },
    currentBid: { type: Number, default: 0 },
    completedBid: { type: Boolean, default: false },
    bidSuccess: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    totalScore: { type: Number, default: 0 }
  },
  { _id: false }
);

const distributionCellSchema = new Schema(
  {
    round: { type: Number, required: true },
    label: { type: String, required: true },
    cardsByPlayer: [
      {
        playerId: { type: String, required: true },
        playerName: { type: String, required: true },
        cardLabel: { type: String, required: true }
      }
    ]
  },
  { _id: false }
);

const gameSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    status: { type: String, enum: ['lobby', 'running', 'finished'], default: 'lobby' },
    settings: {
      playerCount: { type: Number, required: true },
      maxCardsPerPlayer: { type: Number, required: true },
      distributionDirection: { type: String, enum: ['ascending', 'descending'], required: true },
      includeWithoutSir: { type: Boolean, default: false },
      suitOrder: [{ type: String, required: true }]
    },
    players: { type: [playerSchema], default: [] },
    bids: { type: Schema.Types.Mixed, default: {} },
    distribution: { type: [distributionCellSchema], default: [] },
    ranking: {
      type: [
        {
          playerId: { type: String, required: true },
          playerName: { type: String, required: true },
          totalScore: { type: Number, required: true }
        }
      ],
      default: []
    },
    // MongoDB TTL index uses this field to auto-delete old game snapshots.
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
  },
  { timestamps: true }
);

export type GameDocument = InferSchemaType<typeof gameSchema>;
export const GameModel = model('Game', gameSchema);
