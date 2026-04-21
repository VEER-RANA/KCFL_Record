import { Router } from 'express';
import gamesRouter from './games.js';

const router = Router();

router.get('/health', (_request, response) => {
  response.json({ ok: true });
});

router.use('/games', gamesRouter);

export default router;
