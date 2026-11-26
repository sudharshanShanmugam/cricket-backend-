import mongoose from 'mongoose';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();

await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
const { server, live } = createApp(config);

server.listen(config.port, () => console.log(`Cricket scorer API listening on port ${config.port}`));

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), 8000).unref();
  await live.io.close(); // also closes the HTTP server
  await mongoose.disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
