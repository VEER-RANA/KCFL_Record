import { Router } from 'express';
import { z } from 'zod';
import { createGame, getGame, addPlayerToGame, updateBid, extendGameDistribution, listGames, endGame } from '../store/gameStore.js';
import { emitGameUpdate } from '../socket.js';

const router = Router();

const createGameSchema = z.object({
  name: z.string().min(2),
  superPlayerName: z.string().min(2),
  settings: z.object({
    playerCount: z.number().int().min(2).max(15),
    maxCardsPerPlayer: z.number().int().min(1),
    distributionDirection: z.enum(['ascending', 'descending']),
    includeWithoutSir: z.boolean(),
    suitOrder: z.array(z.enum(['Hearts', 'Diamonds', 'Clubs', 'Spades', 'Without Sir']))
  })
}).refine((data) => {
  const totalDeckCards = data.settings.includeWithoutSir ? 65 : 52;
  const maxAllowedCardsPerPlayer = Math.floor(totalDeckCards / data.settings.playerCount);
  return data.settings.maxCardsPerPlayer <= maxAllowedCardsPerPlayer;
}, {
  message: 'maxCardsPerPlayer exceeds deck capacity for selected player count',
  path: ['settings', 'maxCardsPerPlayer']
});

const addPlayerSchema = z.object({
  playerName: z.string().min(2),
  color: z.string().min(3).optional()
});

const bidSchema = z.object({
  round: z.number().int().min(1),
  playerId: z.string().min(2),
  bid: z.number().int().min(0),
  completed: z.boolean()
});

const extendDistributionSchema = z.object({
  rowsToAdd: z.number().int().min(1).max(100)
});

router.get('/', async (_request, response) => {
  const games = await listGames();
  response.json({ games });
});

router.get('/:code', async (request, response) => {
  const game = await getGame(request.params.code);
  if (!game) {
    response.status(404).json({ message: 'Game not found' });
    return;
  }

  response.json({ game });
});

router.post('/', async (request, response) => {
  const parsed = createGameSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ issues: parsed.error.flatten() });
    return;
  }

  const game = await createGame(parsed.data.name, parsed.data.settings, parsed.data.superPlayerName);
  emitGameUpdate(game.code, game);
  response.status(201).json({ game });
});

router.post('/:code/add-player', async (request, response) => {
  const parsed = addPlayerSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ issues: parsed.error.flatten() });
    return;
  }

  const game = await addPlayerToGame(request.params.code, parsed.data.playerName, parsed.data.color);
  if (!game) {
    response.status(404).json({ message: 'Game not found' });
    return;
  }

  emitGameUpdate(game.code, game);
  response.json({ game });
});

router.post('/:code/join', async (request, response) => {
  const parsed = addPlayerSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ issues: parsed.error.flatten() });
    return;
  }

  const game = await addPlayerToGame(request.params.code, parsed.data.playerName, parsed.data.color);
  if (!game) {
    response.status(404).json({ message: 'Game not found' });
    return;
  }

  emitGameUpdate(game.code, game);
  response.json({ game });
});

router.patch('/:code/bids', async (request, response) => {
  const parsed = bidSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ issues: parsed.error.flatten() });
    return;
  }

  const game = await updateBid(request.params.code, parsed.data.round, parsed.data.playerId, parsed.data.bid, parsed.data.completed);
  if (!game) {
    response.status(404).json({ message: 'Game not found' });
    return;
  }

  emitGameUpdate(game.code, game);
  response.json({ game });
});

router.post('/:code/distribution/extend', async (request, response) => {
  const parsed = extendDistributionSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ issues: parsed.error.flatten() });
    return;
  }

  const game = await extendGameDistribution(request.params.code, parsed.data.rowsToAdd);
  if (!game) {
    response.status(404).json({ message: 'Game not found' });
    return;
  }

  emitGameUpdate(game.code, game);
  response.json({ game });
});

router.post('/:code/end-game', async (request, response) => {
  const gameCode = request.params.code;

  // Mark the game as finished and broadcast the final snapshot to everyone in the room
  const game = await endGame(gameCode);
  if (!game) {
    response.status(404).json({ message: 'Game not found' });
    return;
  }

  emitGameUpdate(game.code, game);

  response.json({ game, status: 'success' });
});

export default router;
