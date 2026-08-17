import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { Product } from '../src/models/Product';
import { bearer, loginAs, tokenFor } from './helpers/auth';
import { makeProduct, seedOneProduct } from './helpers/products';

const app = createApp();
const adminToken = tokenFor('admin');
const userToken = tokenFor('user');

const asAdmin = () => ({ Authorization: bearer(adminToken) });
const asUser = () => ({ Authorization: bearer(userToken) });

describe('POST /products', () => {
  it('lets an admin create a product', async () => {
    const response = await request(app)
      .post('/products')
      .set(asAdmin())
      .send(makeProduct({ name: 'Standing Desk', price: 349.5, quantity: 7 }))
      .expect(201);

    expect(response.body.data.product).toMatchObject({
      name: 'Standing Desk',
      category: 'Electronics',
      price: 349.5,
      quantity: 7,
    });
    expect(response.body.data.product.id).toEqual(expect.any(String));

    const stored = await Product.findById(response.body.data.product.id).lean();
    expect(stored?.name).toBe('Standing Desk');
  });

  it('sets createdAt and updatedAt', async () => {
    const response = await request(app)
      .post('/products')
      .set(asAdmin())
      .send(makeProduct())
      .expect(201);

    const { createdAt, updatedAt } = response.body.data.product;
    expect(Date.parse(createdAt)).not.toBeNaN();
    expect(Date.parse(updatedAt)).not.toBeNaN();
  });

  it('trims the name and treats a missing category as null', async () => {
    const response = await request(app)
      .post('/products')
      .set(asAdmin())
      .send({ name: '  Padded Name  ', price: 10, quantity: 1 })
      .expect(201);

    expect(response.body.data.product.name).toBe('Padded Name');
    expect(response.body.data.product.category).toBeNull();
  });

  it('discards fields that have no validator', async () => {
    const forgedId = new Types.ObjectId().toString();

    const response = await request(app)
      .post('/products')
      .set(asAdmin())
      .send({
        ...makeProduct(),
        _id: forgedId,
        createdAt: '1999-01-01T00:00:00.000Z',
        isAdminOnly: true,
      })
      .expect(201);

    // Whitelisting happens in the controller via matchedData, so none of the
    // extra keys reach Mongoose.
    expect(response.body.data.product.id).not.toBe(forgedId);
    expect(new Date(response.body.data.product.createdAt).getFullYear()).toBeGreaterThan(2020);
    expect(response.body.data.product).not.toHaveProperty('isAdminOnly');
  });

  it('rejects a non-admin with 403', async () => {
    const response = await request(app)
      .post('/products')
      .set(asUser())
      .send(makeProduct())
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await Product.countDocuments()).toBe(0);
  });

  it('rejects an anonymous request with 401', async () => {
    const response = await request(app).post('/products').send(makeProduct()).expect(401);

    expect(response.body.error.code).toBe('TOKEN_MISSING');
  });

  it('checks the role before the body, so a non-admin learns nothing about the schema', async () => {
    const response = await request(app)
      .post('/products')
      .set(asUser())
      .send({ garbage: true })
      .expect(403);

    expect(response.body.error).not.toHaveProperty('details');
  });
});

describe('PUT /products/:id', () => {
  it('lets an admin replace a product', async () => {
    const id = await seedOneProduct({ name: 'Old Name', price: 10, quantity: 1 });

    const response = await request(app)
      .put(`/products/${id}`)
      .set(asAdmin())
      .send({ name: 'New Name', category: 'Furniture', price: 99.99, quantity: 25 })
      .expect(200);

    expect(response.body.data.product).toMatchObject({
      id,
      name: 'New Name',
      category: 'Furniture',
      price: 99.99,
      quantity: 25,
    });
  });

  it('removes the category when it is omitted, because PUT replaces', async () => {
    const id = await seedOneProduct({ category: 'Electronics' });

    const response = await request(app)
      .put(`/products/${id}`)
      .set(asAdmin())
      .send({ name: 'Now Uncategorised', price: 5, quantity: 0 })
      .expect(200);

    expect(response.body.data.product.category).toBeNull();

    const stored = await Product.findById(id).lean();
    expect(stored).not.toHaveProperty('category');
  });

  it('requires the full payload, matching the create rules', async () => {
    const id = await seedOneProduct();

    const response = await request(app)
      .put(`/products/${id}`)
      .set(asAdmin())
      .send({ price: 12 })
      .expect(400);

    const fields = (response.body.error.details as { field: string }[]).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'quantity']));
  });

  it('returns 404 for an id that matches nothing', async () => {
    const unusedId = new Types.ObjectId().toString();

    const response = await request(app)
      .put(`/products/${unusedId}`)
      .set(asAdmin())
      .send(makeProduct())
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed id', async () => {
    await request(app)
      .put('/products/nope')
      .set(asAdmin())
      .send(makeProduct())
      .expect(400);
  });

  it('rejects a non-admin with 403 and leaves the product untouched', async () => {
    const id = await seedOneProduct({ name: 'Untouched' });

    await request(app)
      .put(`/products/${id}`)
      .set(asUser())
      .send(makeProduct({ name: 'Hijacked' }))
      .expect(403);

    const stored = await Product.findById(id).lean();
    expect(stored?.name).toBe('Untouched');
  });

  it('rejects an anonymous request with 401', async () => {
    const id = await seedOneProduct();
    await request(app).put(`/products/${id}`).send(makeProduct()).expect(401);
  });
});

describe('DELETE /products/:id', () => {
  it('lets an admin delete a product', async () => {
    const id = await seedOneProduct();

    const response = await request(app)
      .delete(`/products/${id}`)
      .set(asAdmin())
      .expect(200);

    expect(response.body.data).toMatchObject({ id, message: 'Product deleted' });
    expect(await Product.countDocuments()).toBe(0);
  });

  it('makes the product unreachable afterwards', async () => {
    const id = await seedOneProduct();

    await request(app).delete(`/products/${id}`).set(asAdmin()).expect(200);

    await request(app).get(`/products/${id}`).set(asAdmin()).expect(404);
  });

  it('returns 404 when deleting twice', async () => {
    const id = await seedOneProduct();

    await request(app).delete(`/products/${id}`).set(asAdmin()).expect(200);

    const response = await request(app)
      .delete(`/products/${id}`)
      .set(asAdmin())
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed id', async () => {
    await request(app).delete('/products/nope').set(asAdmin()).expect(400);
  });

  it('rejects a non-admin with 403 and keeps the product', async () => {
    const id = await seedOneProduct();

    const response = await request(app)
      .delete(`/products/${id}`)
      .set(asUser())
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await Product.countDocuments()).toBe(1);
  });

  it('rejects an anonymous request with 401', async () => {
    const id = await seedOneProduct();
    await request(app).delete(`/products/${id}`).expect(401);
  });
});

describe('end-to-end: log in, then use the returned token', () => {
  it('completes a full admin lifecycle with a real login token', async () => {
    const token = await loginAs(app, 'admin');

    const created = await request(app)
      .post('/products')
      .set('Authorization', bearer(token))
      .send(makeProduct({ name: 'Lifecycle Widget' }))
      .expect(201);

    const { id } = created.body.data.product;

    await request(app)
      .get(`/products/${id}`)
      .set('Authorization', bearer(token))
      .expect(200);

    await request(app)
      .put(`/products/${id}`)
      .set('Authorization', bearer(token))
      .send(makeProduct({ name: 'Lifecycle Widget v2', quantity: 0 }))
      .expect(200);

    await request(app)
      .delete(`/products/${id}`)
      .set('Authorization', bearer(token))
      .expect(200);

    await request(app)
      .get(`/products/${id}`)
      .set('Authorization', bearer(token))
      .expect(404);
  });

  it('denies the same lifecycle to a token from a non-admin account', async () => {
    const token = await loginAs(app, 'user');

    await request(app)
      .post('/products')
      .set('Authorization', bearer(token))
      .send(makeProduct())
      .expect(403);
  });
});
