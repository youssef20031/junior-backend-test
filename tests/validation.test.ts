import request from 'supertest';
import { createApp } from '../src/app';
import { bearer, tokenFor } from './helpers/auth';
import { makeProduct } from './helpers/products';

const app = createApp();
const adminHeader = { Authorization: bearer(tokenFor('admin')) };

const post = (body: object) => request(app).post('/products').set(adminHeader).send(body);

interface Detail {
  field: string;
  message: string;
}

const detailsOf = (body: { error: { details?: Detail[] } }): Detail[] =>
  body.error.details ?? [];

/**
 * The four rules the brief specifies, one describe block each. Every case goes
 * through the real HTTP endpoint, so these also prove the validator chain is
 * actually wired onto the route.
 */
describe('name — required', () => {
  it.each([
    ['omitted', { price: 10, quantity: 1 }, 'name is required'],
    ['an empty string', { name: '', price: 10, quantity: 1 }, 'name is required'],
    ['whitespace only', { name: '   ', price: 10, quantity: 1 }, 'name cannot be empty'],
    ['a number', { name: 42, price: 10, quantity: 1 }, 'name must be a string'],
    ['null', { name: null, price: 10, quantity: 1 }, 'name is required'],
    [
      'longer than 200 characters',
      { name: 'x'.repeat(201), price: 10, quantity: 1 },
      'name must be at most 200 characters',
    ],
  ])('rejects a name that is %s', async (_label, body, message) => {
    const response = await post(body).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(detailsOf(response.body)).toEqual([{ field: 'name', message }]);
  });

  it('accepts a name at exactly the 200-character limit', async () => {
    await post({ name: 'x'.repeat(200), price: 10, quantity: 1 }).expect(201);
  });
});

describe('category — optional, but a string when present', () => {
  it('accepts the field being omitted', async () => {
    const response = await post({ name: 'No Category', price: 10, quantity: 1 }).expect(
      201,
    );
    expect(response.body.data.product.category).toBeNull();
  });

  it('accepts an explicit null', async () => {
    const response = await post({
      name: 'Null Category',
      category: null,
      price: 10,
      quantity: 1,
    }).expect(201);

    expect(response.body.data.product.category).toBeNull();
  });

  it('accepts a string', async () => {
    const response = await post(makeProduct({ category: 'Kitchen' })).expect(201);
    expect(response.body.data.product.category).toBe('Kitchen');
  });

  it.each([
    ['a number', 99],
    ['a boolean', true],
    ['an object', { nested: 'value' }],
  ])('rejects a category that is %s', async (_label, category) => {
    const response = await post({
      name: 'Bad Category',
      category,
      price: 10,
      quantity: 1,
    }).expect(400);

    expect(detailsOf(response.body)).toEqual([
      { field: 'category', message: 'category must be a string' },
    ]);
  });

  it('rejects a category longer than 100 characters', async () => {
    const response = await post(makeProduct({ category: 'c'.repeat(101) })).expect(400);

    expect(detailsOf(response.body)).toEqual([
      { field: 'category', message: 'category must be at most 100 characters' },
    ]);
  });
});

describe('price — a positive number', () => {
  it.each([
    ['omitted', { name: 'P', quantity: 1 }, 'price is required'],
    ['null', { name: 'P', price: null, quantity: 1 }, 'price is required'],
    ['zero', { name: 'P', price: 0, quantity: 1 }, 'price must be a positive number'],
    [
      'negative',
      { name: 'P', price: -1, quantity: 1 },
      'price must be a positive number',
    ],
    [
      'not a number',
      { name: 'P', price: 'expensive', quantity: 1 },
      'price must be a positive number',
    ],
    [
      'a boolean',
      { name: 'P', price: true, quantity: 1 },
      'price must be a positive number',
    ],
  ])('rejects a price that is %s', async (_label, body, message) => {
    const response = await post(body).expect(400);
    expect(detailsOf(response.body)).toEqual([{ field: 'price', message }]);
  });

  it('accepts a decimal price', async () => {
    const response = await post(makeProduct({ price: 19.99 })).expect(201);
    expect(response.body.data.product.price).toBe(19.99);
  });

  it('accepts the smallest positive value', async () => {
    const response = await post(makeProduct({ price: 0.01 })).expect(201);
    expect(response.body.data.product.price).toBe(0.01);
  });

  it('coerces a numeric string to a number', async () => {
    const response = await post({ name: 'P', price: '49.5', quantity: 1 }).expect(201);

    expect(response.body.data.product.price).toBe(49.5);
    expect(typeof response.body.data.product.price).toBe('number');
  });
});

describe('quantity — a non-negative integer', () => {
  it.each([
    ['omitted', { name: 'Q', price: 10 }, 'quantity is required'],
    ['null', { name: 'Q', price: 10, quantity: null }, 'quantity is required'],
    [
      'negative',
      { name: 'Q', price: 10, quantity: -1 },
      'quantity must be a non-negative integer',
    ],
    [
      'fractional',
      { name: 'Q', price: 10, quantity: 1.5 },
      'quantity must be a non-negative integer',
    ],
    [
      'not a number',
      { name: 'Q', price: 10, quantity: 'many' },
      'quantity must be a non-negative integer',
    ],
  ])('rejects a quantity that is %s', async (_label, body, message) => {
    const response = await post(body).expect(400);
    expect(detailsOf(response.body)).toEqual([{ field: 'quantity', message }]);
  });

  it('accepts zero — out of stock is valid', async () => {
    const response = await post(makeProduct({ quantity: 0 })).expect(201);
    expect(response.body.data.product.quantity).toBe(0);
  });

  it('coerces an integer string to a number', async () => {
    const response = await post({ name: 'Q', price: 10, quantity: '7' }).expect(201);

    expect(response.body.data.product.quantity).toBe(7);
    expect(typeof response.body.data.product.quantity).toBe('number');
  });
});

describe('the error envelope', () => {
  it('reports every offending field at once, not just the first', async () => {
    const response = await post({ price: -5, quantity: 2.5 }).expect(400);

    const fields = detailsOf(response.body).map((detail) => detail.field);
    expect(fields.sort()).toEqual(['name', 'price', 'quantity']);
  });

  it('has a consistent shape', async () => {
    const response = await post({}).expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Request validation failed');
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.error.details[0]).toEqual({
      field: expect.any(String),
      message: expect.any(String),
    });
  });

  it('reports only one message per field, thanks to bail()', async () => {
    const response = await post({ name: '', price: 'nope', quantity: -3 }).expect(400);

    const fields = detailsOf(response.body).map((detail) => detail.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe('the same rules apply to PUT', () => {
  it('rejects an invalid price on update', async () => {
    const created = await post(makeProduct()).expect(201);

    const response = await request(app)
      .put(`/products/${created.body.data.product.id}`)
      .set(adminHeader)
      .send(makeProduct({ price: -10 }))
      .expect(400);

    expect(detailsOf(response.body)).toEqual([
      { field: 'price', message: 'price must be a positive number' },
    ]);
  });

  it('rejects a fractional quantity on update', async () => {
    const created = await post(makeProduct()).expect(201);

    const response = await request(app)
      .put(`/products/${created.body.data.product.id}`)
      .set(adminHeader)
      .send(makeProduct({ quantity: 3.3 }))
      .expect(400);

    expect(detailsOf(response.body)).toEqual([
      { field: 'quantity', message: 'quantity must be a non-negative integer' },
    ]);
  });
});
