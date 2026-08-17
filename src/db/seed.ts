import { env } from '../config/env';
import { Product, type IProduct } from '../models/Product';
import { User } from '../models/User';
import { type UserRole } from '../types/roles';
import { connectDatabase, disconnectDatabase } from './connect';

type SeedProduct = Pick<IProduct, 'name' | 'category' | 'price' | 'quantity'>;

/**
 * Prices deliberately straddle the $50–$200 band and categories repeat, so the
 * queries in challenge-2/ return meaningful results against a seeded database.
 * 25 products means three pages at the default page size of 10.
 */
const SAMPLE_PRODUCTS: SeedProduct[] = [
  { name: 'Wireless Mouse', category: 'Electronics', price: 25.99, quantity: 120 },
  { name: 'Mechanical Keyboard', category: 'Electronics', price: 89.5, quantity: 45 },
  { name: 'USB-C Hub', category: 'Electronics', price: 54.0, quantity: 80 },
  { name: '27" Monitor', category: 'Electronics', price: 199.99, quantity: 18 },
  { name: 'Noise-Cancelling Headphones', category: 'Electronics', price: 149.95, quantity: 32 },
  { name: 'Webcam 1080p', category: 'Electronics', price: 62.4, quantity: 60 },
  { name: 'Laptop Stand', category: 'Electronics', price: 39.99, quantity: 95 },
  { name: 'Portable SSD 1TB', category: 'Electronics', price: 129.0, quantity: 27 },
  { name: 'Bluetooth Speaker', category: 'Electronics', price: 75.25, quantity: 54 },
  { name: 'Graphics Tablet', category: 'Electronics', price: 249.0, quantity: 9 },

  { name: 'Ergonomic Office Chair', category: 'Furniture', price: 189.0, quantity: 14 },
  { name: 'Standing Desk', category: 'Furniture', price: 349.5, quantity: 7 },
  { name: 'Bookshelf', category: 'Furniture', price: 95.0, quantity: 22 },
  { name: 'Desk Lamp', category: 'Furniture', price: 34.75, quantity: 78 },
  { name: 'Filing Cabinet', category: 'Furniture', price: 142.3, quantity: 16 },

  { name: 'Stainless Water Bottle', category: 'Kitchen', price: 19.99, quantity: 210 },
  { name: 'Espresso Machine', category: 'Kitchen', price: 179.0, quantity: 11 },
  { name: 'Chef Knife Set', category: 'Kitchen', price: 88.4, quantity: 36 },
  { name: 'Electric Kettle', category: 'Kitchen', price: 52.6, quantity: 64 },

  { name: 'Running Shoes', category: 'Sportswear', price: 119.99, quantity: 41 },
  { name: 'Yoga Mat', category: 'Sportswear', price: 44.5, quantity: 88 },
  { name: 'Adjustable Dumbbells', category: 'Sportswear', price: 199.0, quantity: 13 },

  { name: 'Hardcover Notebook', category: 'Stationery', price: 12.5, quantity: 300 },
  { name: 'Fountain Pen', category: 'Stationery', price: 68.0, quantity: 47 },

  // No category, to prove the field really is optional end to end.
  { name: 'Unclassified Gadget', price: 57.0, quantity: 5 },
];

async function ensureUser(email: string, password: string, role: UserRole): Promise<void> {
  const existing = await User.exists({ email });

  if (existing !== null) {
    console.log(`[seed] user ${email} already exists — left unchanged`);
    return;
  }

  // `User.create` runs the pre-save hook, so the password is hashed here.
  // `insertMany` would skip it and store plaintext.
  await User.create({ email, password, role });
  console.log(`[seed] created ${role}: ${email}`);
}

export interface SeedOptions {
  /** Delete existing products before inserting the samples. */
  reset?: boolean;
}

/**
 * Idempotent by default: existing users are left alone and products are only
 * inserted when the collection is empty, so running it twice is harmless.
 */
export async function seedDatabase(options: SeedOptions = {}): Promise<void> {
  await ensureUser(env.seed.adminEmail, env.seed.adminPassword, 'admin');
  await ensureUser(env.seed.userEmail, env.seed.userPassword, 'user');

  if (options.reset === true) {
    const { deletedCount } = await Product.deleteMany({});
    console.log(`[seed] removed ${deletedCount} existing product(s)`);
  }

  const productCount = await Product.countDocuments();

  if (productCount > 0) {
    console.log(`[seed] ${productCount} product(s) already present — skipping samples`);
    return;
  }

  await Product.insertMany(SAMPLE_PRODUCTS);
  console.log(`[seed] inserted ${SAMPLE_PRODUCTS.length} sample product(s)`);
}

/** CLI entry point: `npm run seed` (add `-- --reset` to replace the products). */
async function runFromCli(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const { uri, inMemory } = await connectDatabase();

  if (inMemory) {
    console.warn(
      '[seed] MONGODB_URI is not set, so this seeded an in-memory database that ' +
        'is discarded when the process exits. Set MONGODB_URI to seed a real one.',
    );
  } else {
    console.log(`[seed] connected to ${uri}`);
  }

  await seedDatabase({ reset });
  await disconnectDatabase();
  console.log('[seed] done');
}

if (require.main === module) {
  runFromCli().catch((error: unknown) => {
    console.error('[seed] failed', error);
    process.exit(1);
  });
}
