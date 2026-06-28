import { Router } from 'express';

const router = Router();

// GET /health － PRD FR-01
router.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'pokemon-card-tracker-api', time: new Date().toISOString() });
});

export default router;
