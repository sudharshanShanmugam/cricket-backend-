// Adds two sample teams and one upcoming match. Does nothing if teams already exist.
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { loadConfig } from '../src/config.js';
import { Match } from '../src/models/Match.js';
import { Team } from '../src/models/Team.js';
import { computeState, summarise } from '../src/scoring/engine.js';

const config = loadConfig();
await mongoose.connect(config.mongoUri);

if (await Team.countDocuments()) {
  console.log('Teams already exist, nothing to seed.');
} else {
  const make = (name, shortName, names) => ({
    name,
    shortName,
    players: names.map((n) => ({ id: randomBytes(6).toString('hex'), name: n })),
  });
  const teams = await Team.insertMany([
    make('Trident Titans', 'TIT', ['Arun', 'Bala', 'Charan', 'Deepak', 'Eshwar', 'Farhan', 'Gokul', 'Hari', 'Imran', 'Jegan', 'Karthik']),
    make('Trident Warriors', 'WAR', ['Lokesh', 'Mani', 'Naveen', 'Omkar', 'Prakash', 'Rahul', 'Suresh', 'Tarun', 'Uday', 'Vignesh', 'Yash']),
  ]);
  const match = {
    title: 'Friendly Match',
    venue: 'Trident Ground',
    scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    overs: 10,
    teams: teams.map((t) => ({ teamId: String(t._id), name: t.name, shortName: t.shortName, players: t.players.map(({ id, name }) => ({ id, name })) })),
    events: [],
  };
  await Match.create({ ...match, summary: summarise(match, computeState(match)) });
  console.log('Seeded 2 teams and 1 upcoming match.');
}
await mongoose.disconnect();
