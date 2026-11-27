import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app.js';

const config = {
  mongoUri: process.env.TEST_MONGODB_URI || `mongodb://127.0.0.1:27017/trident_cricket_test_${process.pid}`,
  adminId: 'tester',
  adminPassword: 'tester-password',
  jwtSecret: 'test-secret-test-secret',
  tokenTtl: '1h',
  corsOrigin: '*',
};

let ctx;
let url;
let token;

const call = async (path, { method = 'GET', body, auth = true } = {}) => {
  const res = await fetch(url + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
};

before(async () => {
  await mongoose.connect(config.mongoUri);
  ctx = createApp(config);
  await new Promise((resolve) => ctx.server.listen(0, resolve));
  url = `http://127.0.0.1:${ctx.server.address().port}`;
});

after(async () => {
  await ctx.live.io.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('login and protection', async () => {
  assert.equal((await call('/api/teams', { method: 'POST', body: { name: 'X team' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { adminId: 'tester', password: 'nope' } })).status, 401);
  const ok = await call('/api/auth/login', { method: 'POST', body: { adminId: 'tester', password: 'tester-password' } });
  assert.equal(ok.status, 200);
  token = ok.data.token;
});

test('full flow with live updates, stale-write protection and undo', async () => {
  const make = async (name) =>
    (await call('/api/teams', { method: 'POST', body: { name, players: [{ name: `${name} 1` }, { name: `${name} 2` }, { name: `${name} 3` }] } })).data;
  const a = await make('Alpha');
  const b = await make('Bravo');
  const side = (t) => ({ teamId: t.id, playerIds: t.players.map((p) => p.id) });

  assert.equal((await call('/api/matches', { method: 'POST', body: { overs: 2, teamA: side(a), teamB: side(a) } })).status, 400);
  const created = await call('/api/matches', { method: 'POST', body: { overs: 2, teamA: side(a), teamB: side(b) } });
  assert.equal(created.status, 201);
  const { id } = created.data;

  const socket = connect(url, { transports: ['websocket'] });
  await new Promise((resolve) => socket.on('connect', resolve));
  socket.emit('watch', id);
  await new Promise((resolve) => setTimeout(resolve, 100));

  let rev = 0;
  const send = async (event) => {
    const res = await call(`/api/matches/${id}/events`, { method: 'POST', body: { rev, event } });
    if (res.status === 200) rev = res.data.rev;
    return res;
  };

  const pushed = new Promise((resolve) => socket.once('match:update', resolve));
  assert.equal((await send({ type: 'toss', winner: 0, decision: 'bat' })).data.status, 'live');
  assert.equal((await pushed).rev, 1);

  await send({ type: 'innings_start', strikerId: a.players[0].id, nonStrikerId: a.players[1].id, bowlerId: b.players[0].id });
  assert.equal((await send({ type: 'ball', runs: 4 })).data.innings[0].runs, 4);

  const stale = await call(`/api/matches/${id}/events`, { method: 'POST', body: { rev: rev - 1, event: { type: 'ball', runs: 1 } } });
  assert.equal(stale.status, 409);
  assert.equal((await send({ type: 'ball', runs: 99 })).status, 400);
  assert.equal((await send({ type: 'new_batter', batterId: a.players[2].id })).status, 400);

  // Two identical requests at once must only be scored once.
  const twice = await Promise.all(
    [1, 2].map(() => call(`/api/matches/${id}/events`, { method: 'POST', body: { rev, event: { type: 'ball', runs: 1 } } })),
  );
  assert.deepEqual(twice.map((r) => r.status).sort(), [200, 409]);
  rev += 1;

  const undone = await call(`/api/matches/${id}/undo`, { method: 'POST', body: { rev } });
  assert.equal(undone.data.innings[0].runs, 4);

  const list = await call('/api/matches', { auth: false });
  assert.equal(list.data[0].innings[0].runs, 4);
  assert.equal((await call(`/api/matches/${id}`, { auth: false })).status, 200);
  const points = await call('/api/points', { auth: false });
  assert.equal(points.status, 200);
  assert.equal(points.data.rows.length, 2);
  assert.equal(points.data.league.pending, 1);
  assert.equal(points.data.final, null);
  assert.equal(points.data.leaders.batters[0].runs, 4);
  assert.equal(points.data.playerOfTournament, null);
  assert.equal((await call(`/api/matches/${id}`, { method: 'PUT', body: {} })).status, 409);
  assert.equal((await call(`/api/matches/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/matches/${id}`)).status, 404);
  assert.equal((await call('/api/matches/not-an-id')).status, 404);
  socket.close();
});
