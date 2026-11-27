/**
 * Pure cricket scoring engine.
 *
 * A match is stored as an ordered list of events. The full scorecard is always
 * rebuilt by replaying them, so "undo" is simply "drop the last event" and the
 * score can never drift out of sync.
 */

export const BALLS_PER_OVER = 6;
export const SUPER_OVER_WICKETS = 2;

export const WICKET_KINDS = [
  'bowled',
  'caught',
  'lbw',
  'run out',
  'stumped',
  'hit wicket',
  'obstructing the field',
];

const BOWLER_WICKETS = new Set(['bowled', 'caught', 'lbw', 'stumped', 'hit wicket']);

/** Which dismissals the Laws allow on each type of delivery. */
const ALLOWED_ON = {
  wide: new Set(['run out', 'stumped', 'hit wicket', 'obstructing the field']),
  noball: new Set(['run out', 'obstructing the field']),
  bye: new Set(['run out', 'obstructing the field']),
  legbye: new Set(['run out', 'obstructing the field']),
};

export class ScoringError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScoringError';
  }
}

const fail = (message) => {
  throw new ScoringError(message);
};

export const oversText = (balls) => `${Math.floor(balls / BALLS_PER_OVER)}.${balls % BALLS_PER_OVER}`;

const rate = (runs, balls) => (balls ? Number(((runs * BALLS_PER_OVER) / balls).toFixed(2)) : 0);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function computeState(match) {
  const state = {
    status: 'upcoming',
    phase: 'toss',
    toss: null,
    innings: [],
    result: null,
    commentary: [],
  };
  for (const event of match.events ?? []) apply(match, state, event);
  decorate(match, state);
  return state;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const current = (state) => state.innings[state.innings.length - 1];

function playerName(match, teamIndex, id) {
  return match.teams[teamIndex].players.find((p) => p.id === id)?.name ?? 'Unknown';
}

function requirePlayer(match, teamIndex, id, role) {
  if (!match.teams[teamIndex].players.some((p) => p.id === id)) {
    fail(`The ${role} must be a player from ${match.teams[teamIndex].name}`);
  }
}

function batter(match, inn, id) {
  let row = inn.batting.find((b) => b.id === id);
  if (!row) {
    row = {
      id,
      name: playerName(match, inn.battingTeam, id),
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      status: 'batting',
      howOut: '',
    };
    inn.batting.push(row);
  }
  return row;
}

function bowler(match, inn, id) {
  let row = inn.bowling.find((b) => b.id === id);
  if (!row) {
    row = {
      id,
      name: playerName(match, inn.bowlingTeam, id),
      balls: 0,
      maidens: 0,
      runs: 0,
      wickets: 0,
      wides: 0,
      noballs: 0,
    };
    inn.bowling.push(row);
  }
  return row;
}

/** Batters who could still walk in (includes anyone who retired hurt). */
function availableBatters(match, inn) {
  return match.teams[inn.battingTeam].players.filter((p) => {
    if (p.id === inn.strikerId || p.id === inn.nonStrikerId) return false;
    return inn.batting.find((b) => b.id === p.id)?.status !== 'out';
  });
}

function note(state, inn, text, kind = 'info') {
  state.commentary.push({
    innings: state.innings.indexOf(inn),
    over: inn ? oversText(inn.legalBalls) : '',
    kind,
    text,
  });
}

function currentOver(inn) {
  let over = inn.overs[inn.overs.length - 1];
  if (!over || over.complete) {
    over = {
      number: inn.overs.length + 1,
      balls: [],
      legal: 0,
      runs: 0,
      wickets: 0,
      bowlerRuns: 0,
      bowlerIds: [],
      complete: false,
    };
    inn.overs.push(over);
  }
  return over;
}

/* ------------------------------------------------------------------ */
/* Event handlers                                                      */
/* ------------------------------------------------------------------ */

function apply(match, state, event) {
  if (state.status === 'abandoned') fail('This match has been abandoned');
  if (event.type === 'abandon') {
    if (state.status === 'completed') fail('The match is already complete');
    // Once the scores have finished level, stopping early leaves a tie, not "no result".
    if (state.innings[1]?.closed) return finish(state, current(state), { winner: null, text: 'Match tied' });
    state.status = 'abandoned';
    state.phase = 'done';
    state.result = { winner: null, text: event.reason ? `Match abandoned - ${event.reason}` : 'Match abandoned' };
    note(state, current(state), state.result.text, 'result');
    return;
  }
  if (state.status === 'completed') fail('The match is already complete');

  switch (event.type) {
    case 'toss':
      return onToss(match, state, event);
    case 'innings_start':
      return onInningsStart(match, state, event);
    case 'ball':
      return onBall(match, state, event);
    case 'new_batter':
      return onNewBatter(match, state, event);
    case 'new_bowler':
      return onNewBowler(match, state, event);
    case 'swap_strike':
      return onSwapStrike(state);
    case 'retire':
      return onRetire(match, state, event);
    case 'end_innings': {
      const inn = openInnings(state);
      return closeInnings(match, state, inn, 'ended');
    }
    default:
      return fail(`Unknown event type: ${event.type}`);
  }
}

function openInnings(state) {
  const inn = current(state);
  if (!inn || inn.closed) fail('There is no innings in progress');
  return inn;
}

function onToss(match, state, { winner, decision }) {
  if (state.toss) fail('The toss has already been recorded');
  if (![0, 1].includes(winner)) fail('Choose which team won the toss');
  if (!['bat', 'bowl'].includes(decision)) fail('Choose bat or bowl');
  state.toss = { winner, decision };
  state.status = 'live';
  state.phase = 'innings_start';
  note(state, undefined, `${match.teams[winner].name} won the toss and chose to ${decision}`);
}

function onInningsStart(match, state, { strikerId, nonStrikerId, bowlerId }) {
  if (!state.toss) fail('Record the toss first');
  const previous = current(state);
  if (previous && !previous.closed) fail('An innings is already in progress');

  // Innings come in pairs: the match itself, then one pair for each Super Over.
  const played = state.innings.length;
  const superOver = Math.floor(played / 2);
  const chasing = played % 2 === 1;
  const { winner, decision } = state.toss;
  let battingTeam;
  if (!previous) battingTeam = decision === 'bat' ? winner : 1 - winner;
  // The side that batted second goes first in the next Super Over.
  else battingTeam = chasing ? 1 - previous.battingTeam : previous.battingTeam;
  const bowlingTeam = 1 - battingTeam;

  requirePlayer(match, battingTeam, strikerId, 'striker');
  requirePlayer(match, battingTeam, nonStrikerId, 'non-striker');
  requirePlayer(match, bowlingTeam, bowlerId, 'bowler');
  if (strikerId === nonStrikerId) fail('Choose two different opening batters');

  const inn = {
    battingTeam,
    bowlingTeam,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    extras: { wide: 0, noball: 0, bye: 0, legbye: 0, total: 0 },
    batting: [],
    bowling: [],
    overs: [],
    fow: [],
    fielders: [], // one entry for each catch, stumping or run out
    partnership: { runs: 0, balls: 0 },
    strikerId,
    nonStrikerId,
    bowlerId,
    lastOverBowlerId: null,
    target: chasing ? previous.runs + 1 : null,
    superOver, // 0 for the match itself
    maxBalls: (superOver ? 1 : match.overs) * BALLS_PER_OVER,
    closed: false,
    closeReason: null,
  };
  state.innings.push(inn);
  batter(match, inn, strikerId);
  batter(match, inn, nonStrikerId);
  bowler(match, inn, bowlerId);
  state.phase = 'ready';
  note(
    state,
    inn,
    `${superOver ? `Super Over${superOver > 1 ? ` ${superOver}` : ''}: ` : ''}${match.teams[battingTeam].name} innings begins. ${playerName(match, battingTeam, strikerId)} and ` +
      `${playerName(match, battingTeam, nonStrikerId)} to open, ${playerName(match, bowlingTeam, bowlerId)} to bowl.`,
  );
}

function onBall(match, state, event) {
  const inn = openInnings(state);
  if (!inn.strikerId || !inn.nonStrikerId) fail('Select the new batter first');
  if (!inn.bowlerId) fail('Select the bowler first');

  const runs = event.runs ?? 0;
  const extra = event.extra ?? null;
  const nbExtra = extra === 'noball' ? (event.nbExtra ?? null) : null;
  const wicket = event.wicket ?? null;

  if (!Number.isInteger(runs) || runs < 0 || runs > 7) fail('Runs must be between 0 and 7');
  if (extra && !['wide', 'noball', 'bye', 'legbye'].includes(extra)) fail('Unknown extra type');
  if ((extra === 'bye' || extra === 'legbye') && runs === 0) fail('Byes and leg byes need at least 1 run');

  const legal = extra !== 'wide' && extra !== 'noball';
  const offBat = !extra || (extra === 'noball' && !nbExtra);
  const batRuns = offBat ? runs : 0;
  const penalty = legal ? 0 : 1;
  const total = runs + penalty;
  const boundary = offBat && event.boundary !== false && (runs === 4 || runs === 6);
  const bowlerRuns = penalty + batRuns + (extra === 'wide' ? runs : 0);

  let outId = null;
  if (wicket) {
    if (!WICKET_KINDS.includes(wicket.kind)) fail('Unknown dismissal type');
    if (extra && !ALLOWED_ON[extra].has(wicket.kind)) {
      fail(`A batter cannot be ${wicket.kind} on a ${extra === 'noball' ? 'no ball' : extra}`);
    }
    const canBeEither = wicket.kind === 'run out' || wicket.kind === 'obstructing the field';
    outId = canBeEither ? (wicket.playerOutId ?? inn.strikerId) : inn.strikerId;
    if (outId !== inn.strikerId && outId !== inn.nonStrikerId) fail('The dismissed player is not at the crease');
    if (!canBeEither && runs > 0) fail(`No runs can be scored when a batter is ${wicket.kind}`);
    if (wicket.fielderId) requirePlayer(match, inn.bowlingTeam, wicket.fielderId, 'fielder');
  }

  const striker = batter(match, inn, inn.strikerId);
  const bowl = bowler(match, inn, inn.bowlerId);
  const over = currentOver(inn);
  const ballNumber = `${over.number - 1}.${over.legal + 1}`;

  // Team totals
  inn.runs += total;
  inn.partnership.runs += total;
  if (extra === 'wide') inn.extras.wide += total;
  if (extra === 'noball') inn.extras.noball += penalty;
  if (extra === 'bye') inn.extras.bye += runs;
  if (extra === 'legbye') inn.extras.legbye += runs;
  if (nbExtra) inn.extras[nbExtra] += runs;
  inn.extras.total += total - batRuns;

  // Batter
  if (extra !== 'wide') {
    striker.balls += 1;
    inn.partnership.balls += 1;
  }
  striker.runs += batRuns;
  if (boundary && runs === 4) striker.fours += 1;
  if (boundary && runs === 6) striker.sixes += 1;

  // Bowler
  bowl.runs += bowlerRuns;
  if (extra === 'wide') bowl.wides += total;
  if (extra === 'noball') bowl.noballs += 1;
  if (legal) {
    bowl.balls += 1;
    inn.legalBalls += 1;
    over.legal += 1;
  }
  over.runs += total;
  over.bowlerRuns += bowlerRuns;
  if (!over.bowlerIds.includes(bowl.id)) over.bowlerIds.push(bowl.id);

  const strikerName = striker.name;

  // Batters cross on an odd number of runs actually run (boundaries are even).
  if (runs % 2 === 1) [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];

  let wicketText = '';
  if (wicket) {
    const out = batter(match, inn, outId);
    out.status = 'out';
    out.howOut = dismissalText(match, inn, wicket, bowl);
    inn.wickets += 1;
    over.wickets += 1;
    if (BOWLER_WICKETS.has(wicket.kind)) bowl.wickets += 1;
    if (wicket.fielderId && ['caught', 'stumped', 'run out'].includes(wicket.kind)) inn.fielders.push(wicket.fielderId);
    inn.fow.push({ wicket: inn.wickets, runs: inn.runs, over: oversText(inn.legalBalls), playerId: outId, name: out.name });
    inn.partnership = { runs: 0, balls: 0 };
    if (inn.strikerId === outId) inn.strikerId = null;
    else inn.nonStrikerId = null;
    wicketText = `OUT! ${out.name} ${out.howOut} - ${out.runs} (${out.balls})`;
  }

  const ball = { label: ballLabel({ runs, extra, nbExtra, wicket }), kind: ballKind({ runs, extra, wicket, boundary }) };
  over.balls.push(ball);
  state.commentary.push({
    innings: state.innings.indexOf(inn),
    over: ballNumber,
    kind: ball.kind,
    label: ball.label,
    text: `${bowl.name} to ${strikerName}, ${describeBall({ runs, extra, nbExtra, boundary })}${wicketText ? `. ${wicketText}` : ''}`,
  });

  // End of over
  if (over.legal === BALLS_PER_OVER) {
    over.complete = true;
    if (over.bowlerIds.length === 1 && over.bowlerRuns === 0) bowl.maidens += 1;
    inn.lastOverBowlerId = inn.bowlerId;
    inn.bowlerId = null;
    [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];
    note(
      state,
      inn,
      `End of over ${over.number}: ${plural(over.runs, 'run')}, ${plural(over.wickets, 'wicket')}. ` +
        `${match.teams[inn.battingTeam].name} ${inn.runs}/${inn.wickets}`,
      'over',
    );
  }

  if (inn.target && inn.runs >= inn.target) return closeInnings(match, state, inn, 'target');
  if (wicket && isAllOut(match, inn)) return closeInnings(match, state, inn, 'all out');
  if (inn.legalBalls >= inn.maxBalls) return closeInnings(match, state, inn, 'overs');
  updatePhase(state, inn);
}

const isAllOut = (match, inn) =>
  (inn.superOver > 0 && inn.wickets >= SUPER_OVER_WICKETS) || availableBatters(match, inn).length === 0;

function updatePhase(state, inn) {
  if (!inn.strikerId || !inn.nonStrikerId) state.phase = 'need_batter';
  else if (!inn.bowlerId) state.phase = 'need_bowler';
  else state.phase = 'ready';
}

function onNewBatter(match, state, { batterId }) {
  const inn = openInnings(state);
  if (inn.strikerId && inn.nonStrikerId) fail('Both batters are already at the crease');
  if (!availableBatters(match, inn).some((p) => p.id === batterId)) fail('That player is not available to bat');
  const returning = inn.batting.some((b) => b.id === batterId);
  const row = batter(match, inn, batterId);
  row.status = 'batting';
  row.howOut = '';
  if (!inn.strikerId) inn.strikerId = batterId;
  else inn.nonStrikerId = batterId;
  note(state, inn, `${row.name} ${returning ? 'returns to the crease' : 'comes to the crease'}`);
  updatePhase(state, inn);
}

function onNewBowler(match, state, { bowlerId }) {
  const inn = openInnings(state);
  requirePlayer(match, inn.bowlingTeam, bowlerId, 'bowler');
  if (bowlerId === inn.bowlerId) fail('That player is already bowling');
  const row = bowler(match, inn, bowlerId);
  inn.bowlerId = bowlerId;
  note(state, inn, `${row.name} into the attack`);
  updatePhase(state, inn);
}

function onSwapStrike(state) {
  const inn = openInnings(state);
  [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];
  note(state, inn, 'Strike changed');
  updatePhase(state, inn);
}

function onRetire(match, state, { batterId, kind }) {
  const inn = openInnings(state);
  if (!batterId || (batterId !== inn.strikerId && batterId !== inn.nonStrikerId)) {
    fail('Only a batter at the crease can retire');
  }
  if (!['hurt', 'out'].includes(kind)) fail('Choose retired hurt or retired out');
  const row = batter(match, inn, batterId);
  if (inn.strikerId === batterId) inn.strikerId = null;
  else inn.nonStrikerId = null;
  inn.partnership = { runs: 0, balls: 0 };

  if (kind === 'out') {
    row.status = 'out';
    row.howOut = 'retired out';
    inn.wickets += 1;
    inn.fow.push({ wicket: inn.wickets, runs: inn.runs, over: oversText(inn.legalBalls), playerId: batterId, name: row.name });
    note(state, inn, `${row.name} retired out - ${row.runs} (${row.balls})`, 'wicket');
    if (isAllOut(match, inn)) return closeInnings(match, state, inn, 'all out');
  } else {
    row.status = 'retired hurt';
    row.howOut = 'retired hurt';
    note(state, inn, `${row.name} retired hurt - ${row.runs} (${row.balls})`);
  }
  updatePhase(state, inn);
}

function closeInnings(match, state, inn, reason) {
  inn.closed = true;
  inn.closeReason = reason;
  for (const row of inn.batting) if (row.status === 'batting') row.status = 'not out';
  const team = match.teams[inn.battingTeam].name;
  note(state, inn, `Innings complete: ${team} ${inn.runs}/${inn.wickets} in ${oversText(inn.legalBalls)} overs`, 'over');

  if (state.innings.length % 2 === 1) {
    state.phase = 'innings_break';
    return;
  }

  const [first, second] = state.innings.slice(-2);
  if (first.runs === second.runs) {
    state.phase = 'tied';
    note(state, inn, `Scores level on ${inn.runs}. ${inn.superOver ? 'Another Super Over' : 'A Super Over'} will decide it.`, 'result');
    return;
  }

  const side = second.runs > first.runs ? second : first;
  const name = match.teams[side.battingTeam].name;
  let text;
  if (inn.superOver) {
    text = `Match tied - ${name} won the Super Over`;
  } else if (side === second) {
    const left = match.teams[second.battingTeam].players.length - 1 - second.wickets;
    const ballsLeft = second.maxBalls - second.legalBalls;
    text = `${name} won by ${plural(Math.max(left, 1), 'wicket')}` + (ballsLeft > 0 ? ` (${plural(ballsLeft, 'ball')} left)` : '');
  } else {
    text = `${name} won by ${plural(first.runs - second.runs, 'run')}`;
  }
  finish(state, inn, { winner: side.battingTeam, text });
}

function finish(state, inn, result) {
  state.result = result;
  state.status = 'completed';
  state.phase = 'done';
  note(state, inn, result.text, 'result');
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

function dismissalText(match, inn, wicket, bowl) {
  const fielder = wicket.fielderId ? playerName(match, inn.bowlingTeam, wicket.fielderId) : '';
  switch (wicket.kind) {
    case 'bowled':
      return `b ${bowl.name}`;
    case 'lbw':
      return `lbw b ${bowl.name}`;
    case 'caught':
      if (wicket.fielderId === bowl.id) return `c & b ${bowl.name}`;
      return fielder ? `c ${fielder} b ${bowl.name}` : `c b ${bowl.name}`;
    case 'stumped':
      return fielder ? `st ${fielder} b ${bowl.name}` : `st b ${bowl.name}`;
    case 'hit wicket':
      return `hit wicket b ${bowl.name}`;
    case 'run out':
      return fielder ? `run out (${fielder})` : 'run out';
    default:
      return wicket.kind;
  }
}

function ballLabel({ runs, extra, nbExtra, wicket }) {
  const plus = (n) => (n ? `+${n}` : '');
  let label;
  if (extra === 'wide') label = `Wd${plus(runs)}`;
  else if (extra === 'noball') label = `Nb${plus(runs)}${nbExtra && runs ? (nbExtra === 'bye' ? 'b' : 'lb') : ''}`;
  else if (extra === 'bye') label = `${runs}B`;
  else if (extra === 'legbye') label = `${runs}Lb`;
  else label = String(runs);
  if (!wicket) return label;
  return !extra && runs === 0 ? 'W' : `W ${label}`;
}

function ballKind({ runs, extra, wicket, boundary }) {
  if (wicket) return 'wicket';
  if (boundary) return runs === 6 ? 'six' : 'four';
  if (extra) return 'extra';
  return runs === 0 ? 'dot' : 'run';
}

function describeBall({ runs, extra, nbExtra, boundary }) {
  if (extra === 'wide') return runs ? `wide + ${plural(runs, 'run')}` : 'wide';
  if (extra === 'noball') {
    if (!runs) return 'NO BALL';
    if (boundary) return `NO BALL and ${runs === 6 ? 'SIX' : 'FOUR'}!`;
    const how = nbExtra === 'bye' ? 'bye' : nbExtra === 'legbye' ? 'leg bye' : 'run';
    return `NO BALL + ${plural(runs, how)}`;
  }
  if (extra === 'bye') return plural(runs, 'bye');
  if (extra === 'legbye') return plural(runs, 'leg bye');
  if (boundary) return runs === 6 ? 'SIX!' : 'FOUR!';
  if (runs === 0) return 'no run';
  return plural(runs, 'run');
}

/* ------------------------------------------------------------------ */
/* Derived figures                                                     */
/* ------------------------------------------------------------------ */

function decorate(match, state) {
  for (const inn of state.innings) {
    inn.overs_text = oversText(inn.legalBalls);
    inn.runRate = rate(inn.runs, inn.legalBalls);
    for (const b of inn.batting) b.strikeRate = b.balls ? Number(((b.runs * 100) / b.balls).toFixed(1)) : 0;
    for (const b of inn.bowling) {
      b.overs = oversText(b.balls);
      b.economy = rate(b.runs, b.balls);
    }
    const done = new Set(inn.batting.map((b) => b.id));
    inn.yetToBat = match.teams[inn.battingTeam].players.filter((p) => !done.has(p.id));
    inn.availableBatters = inn.closed ? [] : availableBatters(match, inn);
    if (inn.target && !inn.closed) {
      const need = inn.target - inn.runs;
      const ballsLeft = inn.maxBalls - inn.legalBalls;
      inn.chase = { need, ballsLeft, requiredRate: rate(need, ballsLeft) };
    }
  }
}

/** Compact version stored on the match for fast list pages. */
export function summarise(match, state) {
  const inn = current(state);
  let line = '';
  if (state.result) line = state.result.text;
  else if (state.phase === 'tied') line = 'Scores level - Super Over next';
  else if (state.phase === 'innings_break') line = `${inn.superOver ? 'Super Over' : 'Innings'} break - target ${inn.runs + 1}`;
  else if (inn?.chase) {
    line = `${match.teams[inn.battingTeam].shortName} need ${plural(inn.chase.need, 'run')} from ${plural(inn.chase.ballsLeft, 'ball')}`;
  } else if (state.toss) {
    line = `${match.teams[state.toss.winner].shortName} won the toss and chose to ${state.toss.decision}`;
  }
  return {
    status: state.status,
    phase: state.phase,
    line,
    winner: state.result?.winner ?? null,
    innings: state.innings.map((i) => ({
      battingTeam: i.battingTeam,
      runs: i.runs,
      wickets: i.wickets,
      overs: oversText(i.legalBalls),
      closed: i.closed,
      superOver: i.superOver,
    })),
  };
}
