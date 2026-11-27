import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerOfMatch, playerOfTournament } from '../src/scoring/award.js';
import { computeState } from '../src/scoring/engine.js';

const squad = (t) => [1, 2, 3].map((n) => ({ id: `${t}${n}`, name: `${t.toUpperCase()}${n}` }));
const open = (bat, bowl) => ({ type: 'innings_start', strikerId: `${bat}1`, nonStrikerId: `${bat}2`, bowlerId: `${bowl}1` });
const balls = (...list) => list.map((runs) => ({ type: 'ball', runs }));
const caught = { type: 'ball', runs: 0, wicket: { kind: 'caught', fielderId: 'a3' } };
const award = (events) => {
  const match = { overs: 1, teams: [{ players: squad('a') }, { players: squad('b') }], events };
  return playerOfMatch(match, computeState(match));
};
const start = [{ type: 'toss', winner: 0, decision: 'bat' }, open('a', 'b')];

test('the big hitter wins it', () => {
  const p = award([...start, ...balls(6, 6, 6, 6, 0, 0), open('b', 'a'), ...balls(1, 0, 0, 0, 0, 0)]);
  assert.deepEqual([p.playerId, p.team, p.name, p.runs, p.balls, p.sixes], ['a1', 0, 'A1', 24, 6, 4]);
});

test('wickets can beat runs', () => {
  const p = award([
    ...start,
    ...balls(1, 1, 0, 0, 0, 0),
    open('b', 'a'),
    caught,
    { type: 'new_batter', batterId: 'b3' },
    caught,
  ]);
  assert.deepEqual([p.playerId, p.wickets, p.conceded, p.overs], ['a1', 2, 0, '0.2']);
});

test('catches are credited to the fielder', () => {
  const match = { overs: 1, teams: [{ players: squad('a') }, { players: squad('b') }], events: [...start, ...balls(0, 0, 0, 0, 0, 0), open('b', 'a'), caught] };
  assert.deepEqual(computeState(match).innings[1].fielders, ['a3']);
});

test('no award for an unfinished or abandoned match', () => {
  assert.equal(award([...start, ...balls(6)]), null);
  assert.equal(award([...start, ...balls(6), { type: 'abandon' }]), null);
});

test('tournament award adds up completed matches only', () => {
  const match = (events) => ({
    overs: 1,
    teams: ['a', 'b'].map((t) => ({ teamId: t, name: `Team ${t}`, shortName: t, players: squad(t) })),
    events,
  });
  const won = match([...start, ...balls(6, 6, 0, 0, 0, 0), open('b', 'a'), ...balls(0, 0, 0, 0, 0, 0)]);
  const unfinished = match([...start, ...balls(6, 6, 6, 6, 6, 6)]);
  const p = playerOfTournament([won, won, unfinished]);
  assert.deepEqual([p.playerId, p.shortName, p.runs, p.balls, p.matches, p.completed], ['a1', 'a', 24, 12, 2, 2]);
  assert.equal(playerOfTournament([unfinished]), null);
});

test('expensive bowling takes no points away', () => {
  // a1 hits the same runs; in one match a1 also gives away plenty of runs.
  const events = (bowler) => [
    ...start,
    ...balls(6, 6, 6, 6, 6, 6),
    { type: 'innings_start', strikerId: 'b1', nonStrikerId: 'b2', bowlerId: bowler },
    ...balls(2, 2, 2, 2, 2, 2),
  ];
  const bowled = award(events('a1'));
  const rested = award(events('a3'));
  assert.deepEqual([bowled.playerId, rested.playerId], ['a1', 'a1']);
  assert.ok(bowled.points >= rested.points);
});
