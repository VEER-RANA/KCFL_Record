import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './db.js';
import { initializeSocket } from './socket.js';

async function main() {
  const app = createApp();
  const server = createServer(app);

  initializeSocket(server, env.clientOrigin);

  await connectDatabase();

  server.listen(env.port);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
