/**
 * League points table.
 *
 * Nothing is stored: the table is worked out from the match events every time,
 * so a corrected or deleted match is reflected straight away.
 */
import { BALLS_PER_OVER, computeState } from './engine.js';

export const POINTS = { win: 2, loss: 0, tie: 1, noResult: 1 };
export const FINALISTS = 2;

const FINISHED = new Set(['completed', 'abandoned']);

const pairKey = (a, b) => [a, b].sort().join(':');

/**
 * Overs that count towards net run rate. A side that is bowled out (or whose
 * innings the scorer ends early) is charged its full quota of overs.
 */
const ballsCounted = (match, inn) =>
  inn.closeReason === 'all out' || inn.closeReason === 'ended' ? match.overs * BALLS_PER_OVER : inn.legalBalls;

const perOver = (runs, balls) => (balls ? (runs * BALLS_PER_OVER) / balls : 0);

const netRunRate = (r) => perOver(r.runsFor, r.ballsFaced) - perOver(r.runsAgainst, r.ballsBowled);

/** Level on points and net run rate (ignoring floating point noise). */
const level = (a, b) => a.points === b.points && Math.abs(a.nrr - b.nrr) < 1e-9;

const compare = (a, b) => {
  if (level(a, b)) return a.name.localeCompare(b.name);
  return b.points - a.points || b.nrr - a.nrr;
};

/**
 * @param teams   [{ id, name, shortName }]
 * @param matches stored matches, each with `stage`, `overs`, `teams` and `events`
 */
export function pointsTable(teams, matches) {
  const rows = new Map(
    teams.map((t) => [
      t.id,
      {
        teamId: t.id,
        name: t.name,
        shortName: t.shortName,
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        noResult: 0,
        points: 0,
        runsFor: 0,
        ballsFaced: 0,
        runsAgainst: 0,
        ballsBowled: 0,
      },
    ]),
  );
  const met = new Set();
  let pending = 0;

  for (const match of matches) {
    if (match.stage === 'final') continue;
    const ids = match.teams.map((t) => String(t.teamId));
    const state = computeState(match);
    if (!FINISHED.has(state.status)) {
      pending += 1;
      continue;
    }
    met.add(pairKey(...ids));

    const winner = state.result.winner;
    ids.forEach((id, side) => {
      const row = rows.get(id);
      if (!row) return; // the team has since been deleted
      row.played += 1;
      let outcome;
      if (state.status === 'abandoned') outcome = 'noResult';
      else if (winner === null) outcome = 'tie';
      else outcome = winner === side ? 'win' : 'loss';
      row[{ win: 'won', loss: 'lost', tie: 'tied', noResult: 'noResult' }[outcome]] += 1;
      row.points += POINTS[outcome];

      // A match without a result does not affect net run rate.
      if (state.status === 'abandoned') return;
      for (const inn of state.innings) {
        const balls = ballsCounted(match, inn);
        if (inn.battingTeam === side) {
          row.runsFor += inn.runs;
          row.ballsFaced += balls;
        } else {
          row.runsAgainst += inn.runs;
          row.ballsBowled += balls;
        }
      }
    });
  }

  const table = [...rows.values()].map((r) => ({ ...r, nrr: netRunRate(r) })).sort(compare);

  // Single round robin at least: every pair has met and no league fixture is left.
  const everyoneMet = table.every((a, i) => table.slice(i + 1).every((b) => met.has(pairKey(a.teamId, b.teamId))));
  const complete = table.length > FINALISTS && pending === 0 && everyoneMet;
  const pairs = (table.length * (table.length - 1)) / 2;
  const pairsMet = table.reduce((n, a, i) => n + table.slice(i + 1).filter((b) => met.has(pairKey(a.teamId, b.teamId))).length, 0);

  // Teams that cannot be separated across the cut-off are not declared qualified.
  const cut = table[FINALISTS - 1];
  const next = table[FINALISTS];
  const deadlock = complete && level(cut, next);
  const tiedForPlace = deadlock ? table.filter((r) => level(r, cut)).map((r) => r.teamId) : [];

  return {
    rows: table.map((r, i) => ({
      position: i + 1,
      teamId: r.teamId,
      name: r.name,
      shortName: r.shortName,
      played: r.played,
      won: r.won,
      lost: r.lost,
      tied: r.tied,
      noResult: r.noResult,
      nrr: Number(r.nrr.toFixed(3)) || 0, // never "-0"
      points: r.points,
      qualified: complete && i < FINALISTS && !tiedForPlace.includes(r.teamId),
    })),
    league: { complete, pending, pairs, pairsMet, finalists: FINALISTS, tiedForPlace },
  };
}
