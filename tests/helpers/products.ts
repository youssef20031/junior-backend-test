import { Product } from '../../src/models/Product';

export interface ProductSeed {
  name: string;
  category?: string;
  price: number;
  quantity: number;
}

export function makeProduct(overrides: Partial<ProductSeed> = {}): ProductSeed {
  return {
    name: 'Wireless Mouse',
    category: 'Electronics',
    price: 29.99,
    quantity: 42,
    ...overrides,
  };
}

/**
 * Inserts `count` products with predictable, distinct values:
 * "Product 01".."Product NN", prices 10, 20, 30… and alternating categories.
 * Distinct prices and names make sort assertions unambiguous.
 */
export async function seedProducts(count: number): Promise<ProductSeed[]> {
  const seeds: ProductSeed[] = Array.from({ length: count }, (_unused, index) => ({
    name: `Product ${String(index + 1).padStart(2, '0')}`,
    category: index % 2 === 0 ? 'Electronics' : 'Furniture',
    price: (index + 1) * 10,
    quantity: index,
  }));

  await Product.insertMany(seeds);
  return seeds;
}

/** Inserts one product and returns its id. */
export async function seedOneProduct(overrides: Partial<ProductSeed> = {}): Promise<string> {
  const product = await Product.create(makeProduct(overrides));
  return product._id.toString();
}
