import { model, Schema, type HydratedDocument } from 'mongoose';

export interface IProduct {
  name: string;
  /** Optional, per the brief. Absent rather than empty when not supplied. */
  category?: string;
  price: number;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductDocument = HydratedDocument<IProduct>;

/**
 * Fields the `sortBy` query parameter accepts. An explicit allow-list, so a
 * client can never steer the sort onto an unindexed or internal field.
 */
export const SORTABLE_PRODUCT_FIELDS = [
  'name',
  'price',
  'quantity',
  'createdAt',
  'updatedAt',
] as const;

export type SortableProductField = (typeof SORTABLE_PRODUCT_FIELDS)[number];

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, 'name is required'],
      trim: true,
      maxlength: [200, 'name must be at most 200 characters'],
    },
    category: {
      type: String,
      trim: true,
      maxlength: [100, 'category must be at most 100 characters'],
    },
    price: {
      type: Number,
      required: [true, 'price is required'],
      validate: {
        validator: (value: number) => value > 0,
        message: 'price must be a positive number',
      },
    },
    quantity: {
      type: Number,
      required: [true, 'quantity is required'],
      min: [0, 'quantity must be a non-negative integer'],
      validate: {
        validator: Number.isInteger,
        message: 'quantity must be an integer',
      },
    },
  },
  // `timestamps` produces exactly the `createdAt` / `updatedAt` fields the brief
  // specifies. No `toJSON` transform: `serializeProduct` in product.service.ts is
  // the single path from document to response, and it also handles `.lean()`
  // results, which `toJSON` would silently miss.
  { timestamps: true },
);

// Every index below backs a query the API actually issues. See challenge-2/README.md
// for the reasoning, and product.service.ts for the queries themselves.

/** Price-range filters and `sortBy=price` (Challenge 2's PostgreSQL equivalent). */
productSchema.index({ price: 1 });

/**
 * Category filter with a descending price sort — Challenge 2's MongoDB query.
 * Field order follows the ESR rule: Equality (category) before Sort (price).
 */
productSchema.index({ category: 1, price: -1 });

/** The default listing order, newest first. */
productSchema.index({ createdAt: -1 });

/** `sortBy=name`. */
productSchema.index({ name: 1 });

export const Product = model<IProduct>('Product', productSchema);
