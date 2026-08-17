import { type Request, type RequestHandler } from 'express';
import { matchedData } from 'express-validator';
import * as productService from './product.service';
import { type ListProductsQuery, type ProductInput } from './product.service';

/**
 * Every read below goes through `matchedData` rather than `req.body` / `req.query`
 * for two reasons: it returns the *sanitised* values (Express 5 makes `req.query`
 * read-only, so sanitisers cannot write back to it), and it returns only fields
 * that had a validator attached — so unexpected keys are dropped instead of
 * reaching Mongoose.
 */
function readProductInput(req: Request): ProductInput {
  return matchedData<ProductInput>(req, { locations: ['body'] });
}

function readId(req: Request): string {
  return matchedData<{ id: string }>(req, { locations: ['params'] }).id;
}

export const list: RequestHandler = async (req, res) => {
  const query = matchedData<ListProductsQuery>(req, { locations: ['query'] });
  const result = await productService.listProducts(query);
  res.status(200).json({ success: true, data: result });
};

export const getOne: RequestHandler = async (req, res) => {
  const product = await productService.getProductById(readId(req));
  res.status(200).json({ success: true, data: { product } });
};

export const create: RequestHandler = async (req, res) => {
  const product = await productService.createProduct(readProductInput(req));
  res.status(201).json({ success: true, data: { product } });
};

export const update: RequestHandler = async (req, res) => {
  const product = await productService.replaceProduct(readId(req), readProductInput(req));
  res.status(200).json({ success: true, data: { product } });
};

export const remove: RequestHandler = async (req, res) => {
  const id = await productService.deleteProduct(readId(req));
  res.status(200).json({
    success: true,
    data: { id, message: 'Product deleted' },
  });
};
