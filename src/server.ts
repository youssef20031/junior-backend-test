import { type Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './db/connect';
import { seedDatabase } from './db/seed';

async function start(): Promise<void> {
  const { inMemory } = await connectDatabase();

  // An in-memory database starts empty every time, so seed it automatically —
  // otherwise there would be no account to log in with.
  if (inMemory) {
    await seedDatabase();
  }

  const server: Server = createApp().listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  /** Finish in-flight requests, then close the database, before exiting. */
  const shutdown = (signal: string): void => {
    console.log(`[server] ${signal} received — shutting down`);

    server.close(async (closeError) => {
      if (closeError) {
        console.error('[server] error while closing HTTP server', closeError);
      }
      try {
        await disconnectDatabase();
      } catch (error) {
        console.error('[server] error while closing the database connection', error);
      }
      process.exit(closeError ? 1 : 0);
    });

    // Never hang forever waiting on a stuck connection.
    setTimeout(() => {
      console.error('[server] forced exit after shutdown timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error: unknown) => {
  console.error('[server] failed to start', error);
  process.exit(1);
});
