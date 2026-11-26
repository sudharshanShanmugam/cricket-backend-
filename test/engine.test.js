import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeState, summarise } from '../src/scoring/engine.js';

const squad = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix.toUpperCase()}${i + 1}` }));

const setup = ({ overs = 2, size = 4 } = {}) => ({
  overs,
  teams: [
    { name: 'Alpha', shortName: 'ALP', players: squad('a', size) },
    { name: 'Bravo', shortName: 'BRV', players: squad('b', size) },
  ],
  events: [
    { type: 'toss', winner: 0, decision: 'bat' },
    { type: 'innings_start', strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' },
  ],
});

const ball = (runs, extra = {}) => ({ type: 'ball', runs, ...extra });
const play = (match, ...events) => computeState({ ...match, events: [...match.events, ...events] });
const dots = (n) => Array.from({ length: n }, () => ball(0));

test('upcoming match has no innings', () => {
  const s = computeState({ ...setup(), events: [] });
  assert.equal(s.status, 'upcoming');
  assert.equal(s.phase, 'toss');
});

test('toss decision picks the batting side', () => {
  const m = { ...setup(), events: [{ type: 'toss', winner: 0, decision: 'bowl' }] };
  const s = play(m, { type: 'innings_start', strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' });
  assert.equal(s.innings[0].battingTeam, 1);
});

test('odd runs rotate strike, boundaries count', () => {
  const s = play(setup(), ball(1), ball(4), ball(6));
  const inn = s.innings[0];
  assert.equal(inn.runs, 11);
  assert.equal(inn.strikerId, 'a2');
  const a2 = inn.batting.find((b) => b.id === 'a2');
  assert.deepEqual([a2.runs, a2.balls, a2.fours, a2.sixes], [10, 2, 1, 1]);
});

test('an all-run four is not counted as a boundary', () => {
  const inn = play(setup(), ball(4, { boundary: false })).innings[0];
  assert.equal(inn.batting[0].fours, 0);
  assert.equal(inn.batting[0].runs, 4);
});

test('wide: one penalty plus runs, not a legal ball', () => {
  const inn = play(setup(), ball(0, { extra: 'wide' }), ball(1, { extra: 'wide' })).innings[0];
  assert.equal(inn.runs, 3);
  assert.equal(inn.legalBalls, 0);
  assert.equal(inn.extras.wide, 3);
  assert.equal(inn.batting[0].balls, 0);
  assert.equal(inn.bowling[0].runs, 3);
  assert.equal(inn.strikerId, 'a2');
});

test('no ball: bat runs go to the batter, byes are not charged to the bowler', () => {
  const inn = play(setup(), ball(4, { extra: 'noball' }), ball(2, { extra: 'noball', nbExtra: 'bye' })).innings[0];
  assert.equal(inn.runs, 8);
  assert.equal(inn.legalBalls, 0);
  assert.equal(inn.batting[0].runs, 4);
  assert.equal(inn.batting[0].balls, 2);
  assert.equal(inn.bowling[0].runs, 6);
  assert.deepEqual(inn.extras, { wide: 0, noball: 2, bye: 2, legbye: 0, total: 4 });
});

test('byes and leg byes are legal balls not charged to the bowler', () => {
  const inn = play(setup(), ball(2, { extra: 'bye' }), ball(1, { extra: 'legbye' })).innings[0];
  assert.equal(inn.runs, 3);
  assert.equal(inn.legalBalls, 2);
  assert.equal(inn.bowling[0].runs, 0);
  assert.equal(inn.batting[0].runs, 0);
});

test('over ends after six legal balls: strike swaps, new bowler needed, maiden recorded', () => {
  const s = play(setup(), ...dots(6));
  const inn = s.innings[0];
  assert.equal(s.phase, 'need_bowler');
  assert.equal(inn.strikerId, 'a2');
  assert.equal(inn.bowling[0].maidens, 1);
  assert.throws(() => play(setup(), ...dots(6), ball(0)), /bowler/i);
});

test('the same bowler can bowl the next over', () => {
  const s = play(setup(), ...dots(6), { type: 'new_bowler', bowlerId: 'b1' }, ...dots(6));
  const inn = s.innings[0];
  assert.equal(inn.legalBalls, 12);
  assert.deepEqual([inn.bowling.length, inn.bowling[0].overs, inn.bowling[0].maidens], [1, '2.0', 2]);
});

test('wicket: new batter is required and takes the vacant end', () => {
  const s = play(setup(), ball(0, { wicket: { kind: 'caught', fielderId: 'b2' } }));
  assert.equal(s.phase, 'need_batter');
  assert.equal(s.innings[0].batting[0].howOut, 'c B2 b B1');
  assert.equal(s.innings[0].bowling[0].wickets, 1);
  const next = play(setup(), ball(0, { wicket: { kind: 'bowled' } }), { type: 'new_batter', batterId: 'a3' });
  assert.equal(next.innings[0].strikerId, 'a3');
  assert.throws(() => play(setup(), ball(0, { wicket: { kind: 'bowled' } }), { type: 'new_batter', batterId: 'a1' }), /not available/);
});

test('wicket on the last ball of an over: new batter goes to the non-striker end', () => {
  const s = play(setup(), ...dots(5), ball(0, { wicket: { kind: 'bowled' } }), { type: 'new_batter', batterId: 'a3' });
  assert.equal(s.innings[0].strikerId, 'a2');
  assert.equal(s.innings[0].nonStrikerId, 'a3');
  assert.equal(s.phase, 'need_bowler');
});

test('run out of the non-striker after a completed run, not credited to bowler', () => {
  const inn = play(setup(), ball(1, { wicket: { kind: 'run out', playerOutId: 'a2', fielderId: 'b3' } })).innings[0];
  assert.equal(inn.runs, 1);
  assert.equal(inn.batting.find((b) => b.id === 'a2').status, 'out');
  assert.equal(inn.nonStrikerId, 'a1');
  assert.equal(inn.strikerId, null);
  assert.equal(inn.bowling[0].wickets, 0);
});

test('illegal dismissals are rejected', () => {
  assert.throws(() => play(setup(), ball(0, { extra: 'noball', wicket: { kind: 'bowled' } })), /cannot be bowled/);
  assert.throws(() => play(setup(), ball(0, { extra: 'wide', wicket: { kind: 'caught' } })), /cannot be caught/);
  assert.throws(() => play(setup(), ball(2, { wicket: { kind: 'bowled' } })), /No runs/);
});

test('all out closes the innings', () => {
  const out = ball(0, { wicket: { kind: 'bowled' } });
  const s = play(setup({ size: 3 }), out, { type: 'new_batter', batterId: 'a3' }, out);
  assert.equal(s.phase, 'innings_break');
  assert.equal(s.innings[0].closeReason, 'all out');
});

const second = { type: 'innings_start', strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' };

test('chasing side wins by wickets', () => {
  const s = play(setup({ overs: 1 }), ball(4), ...dots(5), second, ball(6));
  assert.equal(s.status, 'completed');
  assert.equal(s.result.text, 'Bravo won by 3 wickets (5 balls left)');
  assert.throws(() => play(setup({ overs: 1 }), ball(4), ...dots(5), second, ball(6), ball(1)), /complete/);
});

test('defending side wins by runs', () => {
  const s = play(setup({ overs: 1 }), ball(4), ...dots(5), second, ...dots(6));
  assert.equal(s.result.text, 'Alpha won by 4 runs');
  assert.equal(s.result.winner, 0);
});

test('tie', () => {
  const s = play(setup({ overs: 1 }), ball(4), ...dots(5), second, ball(4), ...dots(5));
  assert.equal(s.result.text, 'Match tied');
});

test('chase figures and summary', () => {
  const m = setup({ overs: 1 });
  const s = play(m, ball(4), ...dots(5), second, ball(1));
  assert.deepEqual(s.innings[1].chase, { need: 4, ballsLeft: 5, requiredRate: 4.8 });
  assert.equal(summarise(m, s).line, 'BRV need 4 runs from 5 balls');
});

test('retired hurt can return; retired out counts as a wicket', () => {
  const hurt = [{ type: 'retire', batterId: 'a1', kind: 'hurt' }, { type: 'new_batter', batterId: 'a3' }];
  const s = play(setup(), ...hurt, { type: 'retire', batterId: 'a2', kind: 'out' }, { type: 'new_batter', batterId: 'a1' });
  assert.equal(s.innings[0].wickets, 1);
  assert.equal(s.innings[0].batting[0].status, 'batting');
});

test('abandon stops further scoring', () => {
  const s = play(setup(), { type: 'abandon', reason: 'rain' });
  assert.equal(s.status, 'abandoned');
  assert.throws(() => play(setup(), { type: 'abandon' }, ball(1)), /abandoned/);
});
