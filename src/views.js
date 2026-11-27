import { playerOfMatch } from './scoring/award.js';
import { computeState } from './scoring/engine.js';

const base = (m) => ({
  id: String(m._id),
  title: m.title,
  venue: m.venue,
  scheduledAt: m.scheduledAt,
  overs: m.overs,
  stage: m.stage ?? 'league',
  rev: m.rev,
});

/** Card shown on list pages. */
export const listView = (m) => ({
  ...base(m),
  teams: m.teams.map(({ name, shortName }) => ({ name, shortName })),
  ...m.summary,
});

/** Full live scorecard. */
export const matchView = (m) => {
  const state = computeState(m);
  return {
    ...base(m),
    teams: m.teams,
    eventCount: m.events.length,
    ...state,
    playerOfMatch: playerOfMatch(m, state),
  };
};
