import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { HttpError, parse } from '../middleware/errors.js';
import { Match } from '../models/Match.js';
import { Team } from '../models/Team.js';
import { WICKET_KINDS, computeState, summarise } from '../scoring/engine.js';
import { listView, matchView } from '../views.js';

const id = z.string().min(1).max(40);

const side = z.object({
  teamId: z.string().regex(/^[a-f\d]{24}$/i, 'Choose a team'),
  playerIds: z.array(id).min(2, 'Pick at least 2 players in each team').max(30),
});

const matchSchema = z.object({
  title: z.string().trim().max(80).default(''),
  venue: z.string().trim().max(80).default(''),
  scheduledAt: z.coerce.date().optional(),
  overs: z.number().int().min(1).max(50),
  stage: z.enum(['league', 'final']).default('league'),
  teamA: side,
  teamB: side,
});

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('toss'), winner: z.union([z.literal(0), z.literal(1)]), decision: z.enum(['bat', 'bowl']) }),
  z.object({ type: z.literal('innings_start'), strikerId: id, nonStrikerId: id, bowlerId: id }),
  z.object({
    type: z.literal('ball'),
    runs: z.number().int().min(0).max(7),
    extra: z.enum(['wide', 'noball', 'bye', 'legbye']).nullish(),
    nbExtra: z.enum(['bye', 'legbye']).nullish(),
    boundary: z.boolean().optional(),
    wicket: z
      .object({ kind: z.enum(WICKET_KINDS), playerOutId: id.nullish(), fielderId: id.nullish() })
      .nullish(),
  }),
  z.object({ type: z.literal('new_batter'), batterId: id }),
  z.object({ type: z.literal('new_bowler'), bowlerId: id }),
  z.object({ type: z.literal('swap_strike') }),
  z.object({ type: z.literal('retire'), batterId: id, kind: z.enum(['hurt', 'out']) }),
  z.object({ type: z.literal('end_innings') }),
  z.object({ type: z.literal('abandon'), reason: z.string().trim().max(80).optional() }),
]);

const revSchema = z.object({ rev: z.number().int().min(0) });

async function buildSides({ teamA, teamB }) {
  if (teamA.teamId === teamB.teamId) throw new HttpError(400, 'Choose two different teams');
  return Promise.all(
    [teamA, teamB].map(async ({ teamId, playerIds }) => {
      const team = await Team.findById(teamId).lean();
      if (!team) throw new HttpError(400, 'Team not found');
      const wanted = new Set(playerIds);
      const players = team.players.filter((p) => wanted.has(p.id)).map(({ id: pid, name }) => ({ id: pid, name }));
      if (players.length < 2) throw new HttpError(400, `Pick at least 2 players for ${team.name}`);
      return { teamId, name: team.name, shortName: team.shortName, players };
    }),
  );
}

async function buildMatch(body) {
  const data = parse(matchSchema, body);
  const match = {
    title: data.title,
    venue: data.venue,
    scheduledAt: data.scheduledAt ?? new Date(),
    overs: data.overs,
    stage: data.stage,
    teams: await buildSides(data),
    events: [],
  };
  match.summary = summarise(match, computeState(match));
  return match;
}

async function findMatch(matchId) {
  const match = await Match.findById(matchId).lean();
  if (!match) throw new HttpError(404, 'Match not found');
  return match;
}

const STALE = 'The score changed on another device. The latest score is now loaded, please check and try again.';

export function matchRoutes(config, live) {
  const router = Router();
  const admin = requireAdmin(config);

  router.get('/', async (req, res) => {
    // Unfinished matches are always returned; only old results are capped.
    const [open, finished] = await Promise.all([
      Match.find({ 'summary.status': { $in: ['live', 'upcoming'] } }, { events: 0 }).sort({ scheduledAt: 1 }).lean(),
      Match.find({ 'summary.status': { $in: ['completed', 'abandoned'] } }, { events: 0 })
        .sort({ scheduledAt: -1 })
        .limit(50)
        .lean(),
    ]);
    res.json([...open, ...finished].map(listView));
  });

  router.get('/:id', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(matchView(await findMatch(req.params.id)));
  });

  router.post('/', admin, async (req, res) => {
    const match = await Match.create(await buildMatch(req.body));
    live.listChanged();
    res.status(201).json(matchView(match.toObject()));
  });

  /** Edit a match. Only allowed before the toss. */
  router.put('/:id', admin, async (req, res) => {
    const existing = await findMatch(req.params.id);
    if (existing.events.length) throw new HttpError(409, 'The match has started and can no longer be edited');
    const data = await buildMatch(req.body);
    const updated = await Match.findOneAndUpdate(
      { _id: existing._id, rev: existing.rev },
      { $set: data, $inc: { rev: 1 } },
      { returnDocument: 'after' },
    ).lean();
    if (!updated) throw new HttpError(409, STALE);
    const view = matchView(updated);
    live.matchChanged(view);
    res.json(view);
  });

  router.delete('/:id', admin, async (req, res) => {
    const match = await Match.findByIdAndDelete(req.params.id);
    if (!match) throw new HttpError(404, 'Match not found');
    live.matchDeleted(req.params.id);
    res.status(204).end();
  });

  /** Replace the event list, guarded by `rev` so two devices cannot overwrite each other. */
  async function save(match, events) {
    const next = { ...match, events };
    const state = computeState(next); // throws ScoringError if the action is illegal
    const updated = await Match.findOneAndUpdate(
      { _id: match._id, rev: match.rev },
      { $set: { events, summary: summarise(next, state) }, $inc: { rev: 1 } },
      { returnDocument: 'after' },
    ).lean();
    if (!updated) throw new HttpError(409, STALE);
    const view = matchView(updated);
    live.matchChanged(view);
    return view;
  }

  router.post('/:id/events', admin, async (req, res) => {
    const { rev } = parse(revSchema, req.body);
    const event = parse(eventSchema, req.body.event);
    const match = await findMatch(req.params.id);
    if (match.rev !== rev) throw new HttpError(409, STALE);
    res.json(await save(match, [...match.events, { ...event, at: new Date().toISOString() }]));
  });

  router.post('/:id/undo', admin, async (req, res) => {
    const { rev } = parse(revSchema, req.body);
    const match = await findMatch(req.params.id);
    if (match.rev !== rev) throw new HttpError(409, STALE);
    if (!match.events.length) throw new HttpError(400, 'Nothing to undo');
    res.json(await save(match, match.events.slice(0, -1)));
  });

  return router;
}
