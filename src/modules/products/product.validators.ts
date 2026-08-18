import { body, param, query } from 'express-validator';
import { SORTABLE_PRODUCT_FIELDS } from '../../models/Product';
import { MAX_PAGE_SIZE } from '../../utils/pagination';

const idParam = param('id')
  .isMongoId()
  .withMessage('id must be a valid MongoDB ObjectId');

/**
 * The four rules the brief specifies. `isString()` deliberately precedes
 * `trim()`: sanitisers coerce, so trimming first would let `42` masquerade as a
 * valid name.
 */
const productBodyRules = [
  body('name')
    .exists({ values: 'falsy' })
    .withMessage('name is required')
    .bail()
    .isString()
    .withMessage('name must be a string')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('name cannot be empty')
    .bail()
    .isLength({ max: 200 })
    .withMessage('name must be at most 200 characters'),

  // Optional, but must be a string when supplied. `null` is accepted as "absent".
  body('category')
    .optional({ values: 'null' })
    .isString()
    .withMessage('category must be a string')
    .bail()
    .trim()
    .isLength({ max: 100 })
    .withMessage('category must be at most 100 characters'),

  body('price')
    .exists({ values: 'null' })
    .withMessage('price is required')
    .bail()
    .isFloat({ gt: 0 })
    .withMessage('price must be a positive number')
    .bail()
    .toFloat(),

  body('quantity')
    .exists({ values: 'null' })
    .withMessage('quantity is required')
    .bail()
    .isInt({ min: 0 })
    .withMessage('quantity must be a non-negative integer')
    .bail()
    .toInt(),
];

export const createProductValidator = productBodyRules;

/** PUT is a full replacement, so it reuses the create rules verbatim. */
export const updateProductValidator = [idParam, ...productBodyRules];

export const productIdValidator = [idParam];

export const listProductsValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be an integer of 1 or more')
    .bail()
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: MAX_PAGE_SIZE })
    .withMessage(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`)
    .bail()
    .toInt(),

  query('category')
    .optional()
    .isString()
    .withMessage('category must be a string')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('category cannot be empty'),

  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('minPrice must be a number of 0 or more')
    .bail()
    .toFloat(),

  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('maxPrice must be a number of 0 or more')
    .bail()
    .toFloat()
    .custom((value: number, { req }) => {
      const rawMin = (req.query as Record<string, unknown> | undefined)?.minPrice;
      if (rawMin === undefined) {
        return true;
      }
      const min = Number(rawMin);
      if (!Number.isNaN(min) && value < min) {
        throw new Error('maxPrice must be greater than or equal to minPrice');
      }
      return true;
    }),

  query('sortBy')
    .optional()
    .isIn(SORTABLE_PRODUCT_FIELDS)
    .withMessage(`sortBy must be one of: ${SORTABLE_PRODUCT_FIELDS.join(', ')}`),

  query('order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage("order must be either 'asc' or 'desc'"),
];
