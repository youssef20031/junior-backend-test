import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/db/connect';

/**
 * Each test file gets its own in-memory MongoDB via the same `connectDatabase`
 * the application uses, so the zero-setup code path is itself under test.
 */
beforeAll(async () => {
  await connectDatabase();
});

/** Wiping between tests keeps them order-independent. */
afterEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await disconnectDatabase();
});
