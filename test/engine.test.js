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

const level = [ball(4), ...dots(5), second, ball(4), ...dots(5)];
const bravoFirst = second; // the side that batted second starts the Super Over
const alphaChase = { type: 'innings_start', strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' };
const out = { type: 'ball', runs: 0, wicket: { kind: 'bowled' } };

test('level scores wait for the scorer to decide', () => {
  const m = setup({ overs: 1 });
  const s = play(m, ...level);
  assert.deepEqual([s.status, s.phase, s.result], ['live', 'tied', null]);
  assert.equal(summarise(m, s).line, 'Scores level - waiting for the decision');
  assert.throws(() => play(m, ...level, ball(1)), /no innings/);
});

test('Super Over: second side bats first, six balls, winner takes the match', () => {
  const m = setup({ overs: 5 });
  const tied = [ball(4), { type: 'end_innings' }, second, ball(4), { type: 'end_innings' }];
  const mid = play(m, ...tied, bravoFirst, ball(6), ...dots(5));
  const inn = mid.innings[2];
  assert.deepEqual([inn.battingTeam, inn.superOver, inn.closeReason, mid.phase], [1, 1, 'overs', 'innings_break']);
  assert.equal(summarise(m, mid).line, 'Super Over break - target 7');

  const s = play(m, ...tied, bravoFirst, ball(6), ...dots(5), alphaChase, ball(1), ball(6));
  assert.equal(s.innings[3].battingTeam, 0);
  assert.deepEqual(s.result, { winner: 0, text: 'Match tied - Alpha won the Super Over' });
});

test('Super Over innings ends after two wickets', () => {
  const s = play(setup({ overs: 1 }), ...level, bravoFirst, out, { type: 'new_batter', batterId: 'b3' }, out);
  assert.equal(s.innings[2].closeReason, 'all out');
  assert.equal(s.innings[2].legalBalls, 2);
});

test('a level Super Over leads to another, with the order swapped', () => {
  const again = [...level, bravoFirst, ball(2), ...dots(5), alphaChase, ball(2), ...dots(5)];
  const m = setup({ overs: 1 });
  assert.equal(play(m, ...again).phase, 'tied');
  const s = play(m, ...again, alphaChase, ball(4), ...dots(5), second, ...dots(6));
  assert.deepEqual([s.innings[4].battingTeam, s.innings[4].superOver], [0, 2]);
  assert.equal(s.result.text, 'Match tied - Alpha won the Super Over');
});

test('the scorer can finish level scores as a tie', () => {
  for (const extra of [[], [bravoFirst, ball(1)]]) {
    const s = play(setup({ overs: 1 }), ...level, ...extra, { type: 'abandon' });
    assert.deepEqual([s.status, s.result], ['completed', { winner: null, text: 'Match tied' }]);
  }
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

// Events as the server records them now: the last batter plays on alone.
const alone = (event) => ({ ...event, lastMan: true });
const lastOne = [alone(out), { type: 'new_batter', batterId: 'a3' }, alone(out)];

test('the last batter plays on alone and keeps the strike', () => {
  const m = setup({ size: 3 });
  const s = play(m, ...lastOne);
  const inn = s.innings[0];
  assert.deepEqual([s.phase, inn.closed, inn.lastBatter, inn.strikerId, inn.nonStrikerId], ['ready', false, true, 'a2', null]);
  assert.match(s.commentary.at(-1).text, /A2 is the last batter/);

  // One run, then to the end of the over: nobody else to take strike.
  const on = play(m, ...lastOne, alone(ball(1)), alone(ball(3)), alone(ball(0)), alone(ball(0)));
  assert.deepEqual([on.phase, on.innings[0].strikerId, on.innings[0].nonStrikerId], ['need_bowler', 'a2', null]);
  assert.equal(on.innings[0].batting.find((b) => b.id === 'a2').runs, 4);
  assert.throws(() => play(m, ...lastOne, { type: 'swap_strike' }), /only one batter/);
});

test('the innings ends when the last batter is out', () => {
  for (const end of [alone(out), alone({ type: 'retire', batterId: 'a2', kind: 'out' })]) {
    const s = play(setup({ size: 3 }), ...lastOne, end);
    assert.deepEqual([s.phase, s.innings[0].closeReason, s.innings[0].wickets], ['innings_break', 'all out', 3]);
  }
});

test('a run out can leave the non-striker as the last batter', () => {
  const runOut = alone(ball(1, { wicket: { kind: 'run out', playerOutId: 'a2' } }));
  const inn = play(setup({ size: 2 }), runOut).innings[0];
  assert.deepEqual([inn.lastBatter, inn.strikerId, inn.nonStrikerId], [true, 'a1', null]);
});

test('every player is a wicket in hand for the chasing side', () => {
  const s = play(setup({ overs: 1 }), alone(ball(4)), ...dots(5).map(alone), second, alone(ball(6)));
  assert.equal(s.result.text, 'Bravo won by 4 wickets (5 balls left)');
});
