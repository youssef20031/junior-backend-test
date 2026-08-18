import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as productController from './product.controller';
import {
  createProductValidator,
  listProductsValidator,
  productIdValidator,
  updateProductValidator,
} from './product.validators';

export const productRouter = Router();

/** Every product route requires a valid access token. */
productRouter.use(authenticate);

/**
 * `authorize` runs before the body validators on the write routes on purpose: a
 * caller without permission gets a flat 403 and learns nothing about the
 * payload's shape.
 */
productRouter.get('/', listProductsValidator, validate, productController.list);

productRouter.post(
  '/',
  authorize('admin'),
  createProductValidator,
  validate,
  productController.create,
);

productRouter.get('/:id', productIdValidator, validate, productController.getOne);

productRouter.put(
  '/:id',
  authorize('admin'),
  updateProductValidator,
  validate,
  productController.update,
);

productRouter.delete(
  '/:id',
  authorize('admin'),
  productIdValidator,
  validate,
  productController.remove,
);
