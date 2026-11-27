/**
 * Man of the Match and Man of the Tournament, worked out from the scorecards.
 *
 * Impact points for a match. Taking part never costs points: there are bonuses
 * for beating the match scoring rate, but nothing is taken away for falling short.
 *   batting   runs, +1 per four, +2 per six, plus half of the runs made above
 *             the match scoring rate
 *   bowling   20 per wicket, plus half of the runs saved against that rate
 *   fielding  8 per catch, stumping or run out
 *   result    10 for being on the winning side
 *
 * The match award counts Super Overs. The tournament award adds up the points of
 * every completed match and, like other tournament statistics, leaves them out.
 */
import { computeState, oversText } from './engine.js';

export const AWARD = { four: 1, six: 2, wicket: 20, fielding: 8, winner: 10, rate: 0.5 };

const FIGURES = ['runs', 'balls', 'fours', 'sixes', 'wickets', 'conceded', 'bowled', 'dismissals'];

/** Everyone who contributed in these innings, with their figures and impact points. */
function impact(match, winner, innings) {
  const total = (key) => innings.reduce((sum, inn) => sum + inn[key], 0);
  const balls = total('legalBalls');
  const par = balls ? total('runs') / balls : 0; // runs per ball in this match

  const players = new Map();
  const tally = (side, id) => {
    const key = `${side}:${id}`;
    if (!players.has(key)) {
      players.set(key, {
        playerId: id,
        team: side,
        name: match.teams[side].players.find((p) => p.id === id)?.name ?? 'Unknown',
        ...Object.fromEntries(FIGURES.map((f) => [f, 0])),
      });
    }
    return players.get(key);
  };

  for (const inn of innings) {
    for (const row of inn.batting) {
      const p = tally(inn.battingTeam, row.id);
      for (const key of ['runs', 'balls', 'fours', 'sixes']) p[key] += row[key];
    }
    for (const row of inn.bowling) {
      const p = tally(inn.bowlingTeam, row.id);
      p.wickets += row.wickets;
      p.conceded += row.runs;
      p.bowled += row.balls;
    }
    for (const id of inn.fielders) tally(inn.bowlingTeam, id).dismissals += 1;
  }

  const points = (p) =>
    p.runs +
    p.fours * AWARD.four +
    p.sixes * AWARD.six +
    Math.max(0, p.runs - par * p.balls) * AWARD.rate +
    p.wickets * AWARD.wicket +
    Math.max(0, par * p.bowled - p.conceded) * AWARD.rate +
    p.dismissals * AWARD.fielding +
    (winner === p.team ? AWARD.winner : 0);

  // Somebody has to have contributed: being on the winning side alone is not enough.
  return [...players.values()]
    .filter((p) => p.runs || p.wickets || p.dismissals || p.bowled)
    .map((p) => ({ ...p, points: points(p) }));
}

const best = (players) =>
  players.sort((a, b) => b.points - a.points || b.wickets - a.wickets || b.runs - a.runs || a.name.localeCompare(b.name))[0];

const present = ({ bowled, points, ...rest }) => ({ ...rest, overs: oversText(bowled), points: Math.round(points) });

/** Returns null unless the match was played to a finish. */
export function playerOfMatch(match, state) {
  if (state.status !== 'completed') return null;
  const winner = best(impact(match, state.result.winner, state.innings));
  return winner ? present(winner) : null;
}

/** The player with the most impact across all completed matches, the final included. */
export function playerOfTournament(matches) {
  const totals = new Map();
  let completed = 0;

  for (const match of matches) {
    const state = computeState(match);
    if (state.status !== 'completed') continue;
    completed += 1;
    const main = state.innings.filter((inn) => !inn.superOver);
    for (const p of impact(match, state.result.winner, main)) {
      const { teamId, name: teamName, shortName } = match.teams[p.team];
      const key = `${teamId}:${p.playerId}`;
      const sum = totals.get(key) ?? { points: 0, matches: 0, ...Object.fromEntries(FIGURES.map((f) => [f, 0])) };
      for (const f of [...FIGURES, 'points']) sum[f] += p[f];
      sum.matches += 1;
      // Matches arrive oldest first, so renamed players and teams show their latest name.
      Object.assign(sum, { playerId: p.playerId, teamId: String(teamId), name: p.name, teamName, shortName });
      totals.set(key, sum);
    }
  }

  const leader = best([...totals.values()]);
  return leader ? { ...present(leader), completed } : null;
}
