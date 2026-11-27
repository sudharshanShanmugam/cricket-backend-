import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leaders, pointsTable } from '../src/scoring/points.js';

const TEAMS = ['A', 'B', 'C'].map((x) => ({ id: x, name: `Team ${x}`, shortName: x }));
const players = (t) => [1, 2, 3].map((n) => ({ id: `${t}${n}`, name: `${t}${n}` }));
const fixture = (a, b, events = [], extra = {}) => ({
  overs: 1,
  stage: 'league',
  teams: [a, b].map((t) => ({ teamId: t, name: `Team ${t}`, shortName: t, players: players(t) })),
  events,
  ...extra,
});

const balls = (runs) => runs.map((r) => (r === 'W' ? { type: 'ball', runs: 0, wicket: { kind: 'bowled' } } : { type: 'ball', runs: r }));
const open = (bat, bowl) => ({ type: 'innings_start', strikerId: `${bat}1`, nonStrikerId: `${bat}2`, bowlerId: `${bowl}1` });

/** A one-over match: `a` bats first. A wicket is followed by the next batter. */
function played(a, b, first, second, extra) {
  const innings = (list, team) => {
    let next = 3;
    return balls(list).flatMap((e, i) =>
      e.wicket && next <= 3 && i < list.length - 1 ? [e, { type: 'new_batter', batterId: `${team}${next++}` }] : [e],
    );
  };
  return fixture(a, b, [{ type: 'toss', winner: 0, decision: 'bat' }, open(a, b), ...innings(first, a), open(b, a), ...innings(second, b)], extra);
}

const row = (table, id) => table.rows.find((r) => r.teamId === id);
const SIX = [1, 1, 1, 1, 1, 1];
/** Level scores that the scorer finishes as a tie. */
const drawn = (a, b) => {
  const m = played(a, b, SIX, SIX);
  return { ...m, events: [...m.events, { type: 'abandon' }] };
};

test('every team is listed before any match', () => {
  const t = pointsTable(TEAMS, []);
  assert.equal(t.rows.length, 3);
  assert.ok(t.rows.every((r) => r.played === 0 && r.points === 0 && r.nrr === 0 && !r.qualified));
  assert.equal(t.league.complete, false);
});

test('win, loss and net run rate', () => {
  const t = pointsTable(TEAMS, [played('A', 'B', [2, 2, 2, 2, 2, 2], SIX)]);
  assert.deepEqual([row(t, 'A').won, row(t, 'A').points, row(t, 'A').nrr], [1, 2, 6]);
  assert.deepEqual([row(t, 'B').lost, row(t, 'B').points, row(t, 'B').nrr], [1, 0, -6]);
  assert.deepEqual(t.rows.map((r) => r.teamId), ['A', 'C', 'B']);
});

test('a chase uses the balls actually faced; all out uses the full over', () => {
  const chase = pointsTable(TEAMS, [played('A', 'B', SIX, [6, 1])]);
  assert.equal(row(chase, 'B').nrr, 15); // 7 off 2 balls against 6 off 6
  const bowledOut = pointsTable(TEAMS, [played('A', 'B', [6, 6, 'W', 'W'], [6, 6, 1])]);
  assert.equal(row(bowledOut, 'A').nrr, -14); // 12 over a full over against 13 off 3 balls
});

test('tie and no result give one point each', () => {
  const abandoned = fixture('A', 'C', [{ type: 'abandon' }]);
  const t = pointsTable(TEAMS, [drawn('A', 'B'), abandoned]);
  assert.deepEqual([row(t, 'A').played, row(t, 'A').tied, row(t, 'A').noResult, row(t, 'A').points], [2, 1, 1, 2]);
  assert.equal(row(t, 'C').points, 1);
  assert.equal(row(t, 'C').nrr, 0);
});

test('top two qualify only when every pair has met and nothing is pending', () => {
  const league = [
    played('A', 'B', [2, 2, 2, 2, 2, 2], SIX),
    played('A', 'C', [2, 2, 2, 2, 2, 2], SIX),
    played('B', 'C', [1, 1, 1, 1, 1, 2], SIX),
  ];
  assert.equal(pointsTable(TEAMS, league.slice(0, 2)).league.complete, false);
  assert.equal(pointsTable(TEAMS, [...league, fixture('A', 'B')]).league.complete, false);

  const t = pointsTable(TEAMS, [...league, fixture('A', 'B', [], { stage: 'final' })]);
  assert.equal(t.league.complete, true);
  assert.deepEqual(t.rows.filter((r) => r.qualified).map((r) => r.teamId), ['A', 'B']);
});

test('a dead heat for a qualifying place is not decided by name', () => {
  const t = pointsTable(TEAMS, [
    played('A', 'B', [2, 2, 2, 2, 2, 2], SIX),
    played('A', 'C', [2, 2, 2, 2, 2, 2], SIX),
    drawn('B', 'C'),
  ]);
  assert.deepEqual(t.rows.filter((r) => r.qualified).map((r) => r.teamId), ['A']);
  assert.deepEqual(t.league.tiedForPlace, ['B', 'C']);
});

test('a Super Over win earns the points but leaves net run rate alone', () => {
  const m = played('A', 'B', SIX, SIX);
  const open = (bat, bowl) => ({ type: 'innings_start', strikerId: `${bat}1`, nonStrikerId: `${bat}2`, bowlerId: `${bowl}1` });
  m.events.push(open('B', 'A'), ...balls([6, 0, 0, 0, 0, 0]), open('A', 'B'), ...balls([6, 6]));
  const t = pointsTable(TEAMS, [m]);
  assert.deepEqual([row(t, 'A').won, row(t, 'A').points, row(t, 'A').nrr], [1, 2, 0]);
  assert.deepEqual([row(t, 'B').lost, row(t, 'B').points, row(t, 'B').nrr], [1, 0, 0]);
});

test('leaders add up every match and ignore Super Overs', () => {
  const first = played('A', 'B', [6, 6, 'W', 1, 0, 0], SIX);
  const final = played('A', 'C', [4, 0, 0, 0, 0, 0], ['W', 'W'], { stage: 'final' });
  const tied = played('B', 'C', SIX, SIX);
  tied.events.push(
    { type: 'innings_start', strikerId: 'C1', nonStrikerId: 'C2', bowlerId: 'B1' },
    ...balls([6, 6, 6, 6, 6, 6]),
  );
  const top = leaders([first, final, tied]);
  assert.equal(top.batters.length, 3);
  assert.deepEqual(
    [top.batters[0].playerId, top.batters[0].team, top.batters[0].runs, top.batters[0].balls],
    ['A1', 'A', 16, 9],
  );
  // A1 bowled both wickets of the final; B1 took one in the first match.
  assert.deepEqual(top.bowlers.map((b) => [b.playerId, b.wickets]), [['A1', 2], ['B1', 1]]);
});

test('no leaders before any ball is bowled', () => {
  assert.deepEqual(leaders([fixture('A', 'B')]), { batters: [], bowlers: [] });
});
