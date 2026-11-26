import { computeState } from './scoring/engine.js';

const base = (m) => ({
  id: String(m._id),
  title: m.title,
  venue: m.venue,
  scheduledAt: m.scheduledAt,
  overs: m.overs,
  rev: m.rev,
});

/** Card shown on list pages. */
export const listView = (m) => ({
  ...base(m),
  teams: m.teams.map(({ name, shortName }) => ({ name, shortName })),
  ...m.summary,
});

/** Full live scorecard. */
export const matchView = (m) => ({
  ...base(m),
  teams: m.teams,
  eventCount: m.events.length,
  ...computeState(m),
});
