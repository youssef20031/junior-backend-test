import { type QueryFilter, type SortOrder, type UpdateQuery } from 'mongoose';
import { Product, type IProduct, type SortableProductField } from '../../models/Product';
import { HttpError } from '../../utils/HttpError';
import {
  buildPaginationMeta,
  DEFAULT_PAGE_SIZE,
  toSkip,
  type PaginationMeta,
} from '../../utils/pagination';

export interface ProductResponse {
  id: string;
  name: string;
  /** `null` rather than absent, so the response shape is the same either way. */
  category: string | null;
  price: number;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductInput {
  name: string;
  category?: string;
  price: number;
  quantity: number;
}

export interface ListProductsQuery {
  page?: number;
  limit?: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: SortableProductField;
  order?: 'asc' | 'desc';
}

export interface ListProductsResult {
  items: ProductResponse[];
  pagination: PaginationMeta;
}

/** Accepts either a hydrated document or a `.lean()` result. */
interface ProductLike {
  _id: unknown;
  name: string;
  category?: string | null;
  price: number;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

function serializeProduct(product: ProductLike): ProductResponse {
  return {
    id: String(product._id),
    name: product.name,
    category: product.category ?? null,
    price: product.price,
    quantity: product.quantity,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function buildFilter(query: ListProductsQuery): QueryFilter<IProduct> {
  const filter: QueryFilter<IProduct> = {};

  if (query.category !== undefined) {
    filter.category = query.category;
  }

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.price = {
      ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
    };
  }

  return filter;
}

export async function createProduct(input: ProductInput): Promise<ProductResponse> {
  const product = await Product.create(input);
  return serializeProduct(product);
}

/**
 * Paginated listing. Defaults to 10 per page, newest first, as the brief asks.
 *
 * `_id` is appended to the sort so that documents sharing a sort value (bulk
 * inserts share a `createdAt` to the millisecond) keep a stable order across
 * pages — otherwise page 2 could repeat or skip rows.
 */
export async function listProducts(
  query: ListProductsQuery,
): Promise<ListProductsResult> {
  const page = query.page ?? 1;
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  const filter = buildFilter(query);

  const sortField = query.sortBy ?? 'createdAt';
  const direction: SortOrder = query.order === 'asc' ? 1 : -1;
  const sort: Record<string, SortOrder> = { [sortField]: direction, _id: direction };

  // One round-trip for the page and one for the count, in parallel. `.lean()`
  // skips hydrating Mongoose documents we are only going to serialise anyway.
  const [documents, total] = await Promise.all([
    Product.find(filter).sort(sort).skip(toSkip(page, limit)).limit(limit).lean().exec(),
    Product.countDocuments(filter).exec(),
  ]);

  return {
    items: documents.map(serializeProduct),
    pagination: buildPaginationMeta(page, limit, total),
  };
}

export async function getProductById(id: string): Promise<ProductResponse> {
  const product = await Product.findById(id).lean().exec();

  if (product === null) {
    throw HttpError.notFound(`No product found with id ${id}`);
  }

  return serializeProduct(product);
}

/**
 * PUT semantics: a full replacement. Omitting `category` removes it rather than
 * leaving the previous value behind, which is why the `$unset` branch exists.
 */
export async function replaceProduct(
  id: string,
  input: ProductInput,
): Promise<ProductResponse> {
  const update: UpdateQuery<IProduct> = {
    $set: {
      name: input.name,
      price: input.price,
      quantity: input.quantity,
      ...(input.category !== undefined ? { category: input.category } : {}),
    },
    ...(input.category === undefined ? { $unset: { category: '' } } : {}),
  };

  const product = await Product.findByIdAndUpdate(id, update, {
    returnDocument: 'after',
    runValidators: true,
  })
    .lean()
    .exec();

  if (product === null) {
    throw HttpError.notFound(`No product found with id ${id}`);
  }

  return serializeProduct(product);
}

export async function deleteProduct(id: string): Promise<string> {
  const product = await Product.findByIdAndDelete(id).lean().exec();

  if (product === null) {
    throw HttpError.notFound(`No product found with id ${id}`);
  }

  return String(product._id);
}
