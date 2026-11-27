import { Router } from 'express';
import { Match } from '../models/Match.js';
import { Team } from '../models/Team.js';
import { leaders, pointsTable } from '../scoring/points.js';
import { listView } from '../views.js';
import { teamView } from './teams.js';

export function pointsRoutes() {
  const router = Router();

  router.get('/', async (req, res) => {
    const [teams, matches] = await Promise.all([Team.find().lean(), Match.find().sort({ scheduledAt: 1 }).lean()]);
    // An abandoned final has to be played again, so it no longer counts as the final.
    const final = matches.findLast((m) => m.stage === 'final' && m.summary.status !== 'abandoned');
    res.set('Cache-Control', 'no-store');
    res.json({ ...pointsTable(teams.map(teamView), matches), leaders: leaders(matches), final: final ? listView(final) : null });
  });

  return router;
}
