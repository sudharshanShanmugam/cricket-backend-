import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { HttpError, parse } from '../middleware/errors.js';
import { Team } from '../models/Team.js';

const teamSchema = z.object({
  name: z.string().trim().min(2, 'Team name is too short').max(50),
  shortName: z.string().trim().max(5).optional().default(''),
  players: z
    .array(z.object({ id: z.string().max(40).optional(), name: z.string().trim().min(1).max(40) }))
    .max(30, 'A team can have at most 30 players')
    .default([]),
});

const newId = () => randomBytes(6).toString('hex');

/** "Trident Titans" -> "TT", "Warriors" -> "WAR". */
function defaultShortName(name) {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : (words[0] ?? name).slice(0, 3);
}

function clean({ name, shortName, players }) {
  const names = players.map((p) => p.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new HttpError(400, 'Two players have the same name');
  const ids = new Set();
  return {
    name,
    shortName: (shortName || defaultShortName(name)).toUpperCase(),
    players: players.map((p) => {
      const id = p.id && !ids.has(p.id) ? p.id : newId();
      ids.add(id);
      return { id, name: p.name };
    }),
  };
}

export const teamView = (t) => ({ id: String(t._id), name: t.name, shortName: t.shortName, players: t.players.map(({ id, name }) => ({ id, name })) });

export function teamRoutes(config) {
  const router = Router();

  router.get('/', async (req, res) => {
    const teams = await Team.find().sort({ name: 1 }).lean();
    res.json(teams.map(teamView));
  });

  router.post('/', requireAdmin(config), async (req, res) => {
    const team = await Team.create(clean(parse(teamSchema, req.body)));
    res.status(201).json(teamView(team));
  });

  router.put('/:id', requireAdmin(config), async (req, res) => {
    const data = clean(parse(teamSchema, req.body));
    const team = await Team.findByIdAndUpdate(req.params.id, data, { returnDocument: 'after' }).lean();
    if (!team) throw new HttpError(404, 'Team not found');
    res.json(teamView(team));
  });

  router.delete('/:id', requireAdmin(config), async (req, res) => {
    const team = await Team.findByIdAndDelete(req.params.id);
    if (!team) throw new HttpError(404, 'Team not found');
    res.status(204).end();
  });

  return router;
}
