import mongoose from 'mongoose';
import { env } from '../config/env';

/** Held so `disconnectDatabase` can shut the in-memory server down cleanly. */
let memoryServer: { getUri: () => string; stop: () => Promise<boolean> } | undefined;

export interface DatabaseConnection {
  uri: string;
  /** True when this process provisioned a throwaway in-memory MongoDB. */
  inMemory: boolean;
}

/**
 * Connects to `MONGODB_URI` when it is set, and otherwise spins up an in-memory
 * MongoDB so that a fresh clone runs with zero setup.
 *
 * `mongodb-memory-server` is imported lazily so that deployments pointing at a
 * real cluster never pay for loading it.
 */
export async function connectDatabase(): Promise<DatabaseConnection> {
  let uri = env.mongoUri;
  let inMemory = false;

  if (uri === undefined) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({
      instance: { dbName: 'product-inventory' },
    });
    uri = memoryServer.getUri();
    inMemory = true;

    if (!env.isTest) {
      console.warn(
        '[db] MONGODB_URI is not set — started an in-memory MongoDB. Data is ' +
          'discarded when this process exits. Set MONGODB_URI to persist it.',
      );
    }
  }

  await mongoose.connect(uri);
  return { uri, inMemory };
}

/** Closes the Mongoose connection and, if we started one, the in-memory server. */
export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();

  if (memoryServer !== undefined) {
    await memoryServer.stop();
    memoryServer = undefined;
  }
}
