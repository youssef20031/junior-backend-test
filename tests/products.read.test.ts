import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { bearer, expiredTokenFor, foreignlySignedToken, tokenFor } from './helpers/auth';
import { seedOneProduct, seedProducts } from './helpers/products';

const app = createApp();
const userToken = tokenFor('user');

/** Convenience: an authenticated GET as a plain (non-admin) user. */
const get = (path: string) =>
  request(app).get(path).set('Authorization', bearer(userToken));

describe('authentication on read routes', () => {
  it.each([['/products'], ['/products/000000000000000000000000']])(
    'rejects %s without a token',
    async (path) => {
      const response = await request(app).get(path).expect(401);
      expect(response.body.error.code).toBe('TOKEN_MISSING');
    },
  );

  it('rejects a non-Bearer Authorization header', async () => {
    const response = await request(app)
      .get('/products')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_MISSING');
  });

  it('rejects a token that is not a JWT at all', async () => {
    const response = await request(app)
      .get('/products')
      .set('Authorization', bearer('utter-nonsense'))
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a token signed with a different secret', async () => {
    const response = await request(app)
      .get('/products')
      .set('Authorization', bearer(foreignlySignedToken('admin')))
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_INVALID');
  });

  it('distinguishes an expired token from an invalid one', async () => {
    const response = await request(app)
      .get('/products')
      .set('Authorization', bearer(expiredTokenFor('user')))
      .expect(401);

    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('lets any authenticated role read', async () => {
    await get('/products').expect(200);
    await request(app)
      .get('/products')
      .set('Authorization', bearer(tokenFor('admin')))
      .expect(200);
  });
});

describe('GET /products — pagination', () => {
  beforeEach(async () => {
    await seedProducts(25);
  });

  it('returns 10 products per page by default', async () => {
    const response = await get('/products').expect(200);

    expect(response.body.data.items).toHaveLength(10);
    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });

  it('reports the middle page correctly', async () => {
    const response = await get('/products?page=2').expect(200);

    expect(response.body.data.items).toHaveLength(10);
    expect(response.body.data.pagination).toMatchObject({
      page: 2,
      hasNextPage: true,
      hasPrevPage: true,
    });
  });

  it('returns the remainder on the last page', async () => {
    const response = await get('/products?page=3').expect(200);

    expect(response.body.data.items).toHaveLength(5);
    expect(response.body.data.pagination).toMatchObject({
      page: 3,
      hasNextPage: false,
      hasPrevPage: true,
    });
  });

  it('paginates without repeating or dropping a product', async () => {
    const pages = await Promise.all([
      get('/products?page=1').expect(200),
      get('/products?page=2').expect(200),
      get('/products?page=3').expect(200),
    ]);

    const ids = pages.flatMap((page) =>
      (page.body.data.items as { id: string }[]).map((item) => item.id),
    );

    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('returns an empty page past the end rather than an error', async () => {
    const response = await get('/products?page=99').expect(200);

    expect(response.body.data.items).toEqual([]);
    expect(response.body.data.pagination).toMatchObject({
      page: 99,
      total: 25,
      hasNextPage: false,
    });
  });

  it('honours an explicit limit and coerces it to a number', async () => {
    const response = await get('/products?limit=5&page=2').expect(200);

    expect(response.body.data.items).toHaveLength(5);
    expect(response.body.data.pagination).toMatchObject({
      page: 2,
      limit: 5,
      totalPages: 5,
    });
  });

  it('reports zeroed metadata when nothing matches', async () => {
    const response = await get('/products?category=Nonexistent').expect(200);

    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });

  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=notanumber', 'limit'],
  ])('rejects ?%s', async (queryString, field) => {
    const response = await get(`/products?${queryString}`).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });
});

describe('GET /products — filtering and sorting', () => {
  beforeEach(async () => {
    await seedProducts(25);
  });

  it('filters by category', async () => {
    const response = await get('/products?category=Furniture&limit=100').expect(200);

    const items = response.body.data.items as { category: string }[];
    expect(items).toHaveLength(12);
    expect(items.every((item) => item.category === 'Furniture')).toBe(true);
  });

  it('filters by a price range', async () => {
    // Seeded prices are 10, 20 … 250, so 50–200 covers exactly 16 of them.
    const response = await get('/products?minPrice=50&maxPrice=200&limit=100').expect(
      200,
    );

    const prices = (response.body.data.items as { price: number }[]).map((i) => i.price);
    expect(prices).toHaveLength(16);
    expect(Math.min(...prices)).toBe(50);
    expect(Math.max(...prices)).toBe(200);
  });

  it('sorts by price descending by default', async () => {
    const response = await get('/products?sortBy=price&limit=5').expect(200);

    const prices = (response.body.data.items as { price: number }[]).map((i) => i.price);
    expect(prices).toEqual([250, 240, 230, 220, 210]);
  });

  it('sorts ascending when asked', async () => {
    const response = await get('/products?sortBy=price&order=asc&limit=5').expect(200);

    const prices = (response.body.data.items as { price: number }[]).map((i) => i.price);
    expect(prices).toEqual([10, 20, 30, 40, 50]);
  });

  it('sorts by name', async () => {
    const response = await get('/products?sortBy=name&order=asc&limit=3').expect(200);

    const names = (response.body.data.items as { name: string }[]).map((i) => i.name);
    expect(names).toEqual(['Product 01', 'Product 02', 'Product 03']);
  });

  it('combines a category filter with a descending price sort', async () => {
    // This is Challenge 2's MongoDB query, served through the API.
    const response = await get(
      '/products?category=Electronics&sortBy=price&order=desc&limit=5',
    ).expect(200);

    const items = response.body.data.items as { category: string; price: number }[];
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.category === 'Electronics')).toBe(true);
    expect(items.map((item) => item.price)).toEqual([250, 230, 210, 190, 170]);
  });

  it.each([
    ['sortBy=hacker', 'sortBy'],
    ['order=sideways', 'order'],
    ['minPrice=-5', 'minPrice'],
    ['minPrice=abc', 'minPrice'],
    ['minPrice=100&maxPrice=50', 'maxPrice'],
  ])('rejects ?%s', async (queryString, field) => {
    const response = await get(`/products?${queryString}`).expect(400);

    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });
});

describe('GET /products/:id', () => {
  it('returns a single product in the public shape', async () => {
    const id = await seedOneProduct({ name: 'Desk Lamp', price: 34.75, quantity: 8 });

    const response = await get(`/products/${id}`).expect(200);

    expect(response.body.data.product).toMatchObject({
      id,
      name: 'Desk Lamp',
      category: 'Electronics',
      price: 34.75,
      quantity: 8,
    });
    expect(Object.keys(response.body.data.product).sort()).toEqual([
      'category',
      'createdAt',
      'id',
      'name',
      'price',
      'quantity',
      'updatedAt',
    ]);
  });

  it('exposes neither _id nor __v', async () => {
    const id = await seedOneProduct();
    const response = await get(`/products/${id}`).expect(200);

    expect(response.body.data.product).not.toHaveProperty('_id');
    expect(response.body.data.product).not.toHaveProperty('__v');
  });

  it('returns null for a product stored without a category', async () => {
    const id = await seedOneProduct({ category: undefined });
    const response = await get(`/products/${id}`).expect(200);

    expect(response.body.data.product.category).toBeNull();
  });

  it('returns 404 for a well-formed id that matches nothing', async () => {
    const unusedId = new Types.ObjectId().toString();

    const response = await get(`/products/${unusedId}`).expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toContain(unusedId);
  });

  it('returns 400 — not 500 — for a malformed id', async () => {
    const response = await get('/products/not-an-object-id').expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { field: 'id', message: 'id must be a valid MongoDB ObjectId' },
    ]);
  });
});
