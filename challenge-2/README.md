# Challenge 2 — Database Query Optimization

| File | Contents |
|---|---|
| [`schema.sql`](./schema.sql) | PostgreSQL `products` table and its indexes |
| [`queries.sql`](./queries.sql) | The price-range query, a keyset variant, counting strategies, and how to read `EXPLAIN` |
| [`queries.mongo.js`](./queries.mongo.js) | The category query, aggregation and `$facet` variants, keyset paging, and how to read `explain()` |

Both queries are also live in the API — `listProducts` in
[`src/modules/products/product.service.ts`](../src/modules/products/product.service.ts)
builds exactly these filters and sorts, against exactly these indexes:

```bash
# The SQL query's shape:    price 50–200, ascending, 10 per page
GET /products?minPrice=50&maxPrice=200&sortBy=price&order=asc&limit=10

# The MongoDB query:        Electronics, price descending, 5 per page
GET /products?category=Electronics&sortBy=price&order=desc&limit=5
```

---

## 1. SQL — PostgreSQL

> Fetch products with a price between $50 and $200, ordered by price
> (ascending), with pagination (10 products per page).

```sql
SELECT id, name, category, price, quantity, created_at, updated_at
FROM   products
WHERE  price BETWEEN 50 AND 200
ORDER  BY price ASC,
          id ASC                     -- tiebreaker: makes the ordering total
LIMIT  10
OFFSET ($1 - 1) * 10;                -- $1 = page number, 1-based
```

Supporting index:

```sql
CREATE INDEX products_price_idx ON products (price);
```

Three things are load-bearing here:

**The index serves the filter and the sort together.** A B-tree stores its leaves
in key order, so `WHERE price BETWEEN 50 AND 200` is a scan of one contiguous
span, and `ORDER BY price ASC` comes out of that scan for free. There is no
`Sort` node in the plan at all — which matters because a sort that exceeds
`work_mem` spills to disk and collapses in performance exactly when traffic is
highest.

**`ORDER BY price` alone is a bug.** It is a partial order: two products priced
at `99.99` can be returned in either order, on either page. That lets one row
appear on both page 1 and page 2 while another appears on neither. Appending the
primary key makes the ordering total, so pagination is deterministic.

**`$1` is a bound parameter.** The page number never reaches the database as
string-concatenated SQL, so it cannot become an injection vector. `LIMIT 10` is a
literal because the page size is the API's contract, not the caller's input.

## 2. NoSQL — MongoDB

> Retrieve products by category (e.g. "Electronics"), sorted by price in
> descending order. Limit the result to 5 products per page.

```js
db.products
  .find(
    { category: 'Electronics' },
    { name: 1, category: 1, price: 1, quantity: 1, createdAt: 1 },
  )
  .sort({ price: -1, _id: -1 })   // _id breaks price ties, so paging is stable
  .skip((page - 1) * 5)
  .limit(5);
```

Supporting index:

```js
db.products.createIndex({ category: 1, price: -1 });
```

The field order is the whole point, and it follows the **ESR rule** — *Equality,
Sort, Range*:

| Index | Behaviour |
|---|---|
| `{ category: 1, price: -1 }` | Seek to the category's slice, walk it already in descending price order. No sort stage. |
| `{ price: -1, category: 1 }` | Scan the entire index, filter on category, then sort the survivors. |

The projection is not cosmetic either — it cuts bytes off the wire and out of
every cache layer, and restricting it to indexed fields is what makes a covering
index (`totalDocsExamined: 0`) possible.

---

## 3. Optimizing for high traffic

### 3.1 Index the query shape, not the column

An index is only useful if its leading fields match how the query filters and
sorts. The ESR rule above generalises: **equality predicates first, then the sort
fields, then range predicates last.** A range in the middle of an index stops the
subsequent fields from being used for sorting.

Both databases have a covering-index mode, where the index holds every column the
query needs and the table itself is never touched:

```sql
-- PostgreSQL: Index Only Scan
CREATE INDEX products_price_covering_idx ON products (price)
    INCLUDE (id, name, category, quantity);
```

```js
// MongoDB: a covered query — the projection names only indexed fields
db.products.createIndex({ category: 1, price: -1, name: 1, quantity: 1 });
```

This roughly halves the I/O for a hot listing endpoint. The cost is real, though:
every index must be updated on every write, and it consumes memory that would
otherwise cache data. **Indexes are a read/write trade, not free speed.** Audit
them rather than accumulating them:

```sql
-- PostgreSQL: indexes nothing has ever used
SELECT relname, indexrelname, idx_scan
FROM   pg_stat_user_indexes
WHERE  idx_scan = 0;
```

```js
// MongoDB: same idea
db.products.aggregate([{ $indexStats: {} }]);
```

### 3.2 Fix deep pagination

`OFFSET` and `skip` are O(offset): the database produces and discards every
preceding row. Page 1 reads 10 rows; page 10,000 reads 100,010 and throws away
100,000. The endpoint degrades the further a user scrolls, and this is invisible
in testing because test datasets are small.

Keyset (seek) pagination replaces *"skip N rows"* with *"resume after this row"*,
which the index can seek to directly — O(page size), so page 10,000 costs the
same as page 1:

```sql
WHERE price BETWEEN 50 AND 200
  AND (price, id) > ($1, $2)     -- row-value comparison, one index seek
ORDER BY price ASC, id ASC
LIMIT 10;
```

```js
{ category: 'Electronics',
  $or: [ { price: { $lt: lastPrice } },
         { price: lastPrice, _id: { $lt: lastId } } ] }
```

The trade-off: keyset paging cannot jump to an arbitrary page number. Use it for
infinite scroll and next/previous navigation; keep `OFFSET` where a user
genuinely needs to click "page 47".

### 3.3 Stop counting exactly

The `total` needed for `totalPages` is usually the expensive half of a paginated
response: it must visit every matching row, so `LIMIT` does not help it. Options,
cheapest first:

1. **Drop it.** `hasNextPage` only needs to know whether an *(N + 1)*th row
   exists — fetch `limit + 1` rows and return `limit`.
2. **Estimate it.** `reltuples` from `pg_class`, or `estimatedDocumentCount()` in
   MongoDB, read from stored metadata without touching the data. Accurate to a
   few percent, which is plenty for *"about 12,000 results"*.
3. **Cache it** per filter combination with a short TTL.
4. **Maintain it** in a counters table or collection, updated by a trigger or on
   the write path, when the number must be exact.

This API currently runs an exact `countDocuments` in parallel with the page
query, which is the right call at inventory scale (thousands of products) and the
first thing I would change at millions.

### 3.4 Cache the read path

Product listings are read-mostly, so a cache in front of the database absorbs the
majority of traffic. Layered, cheapest first:

| Layer | Mechanism | Typical TTL |
|---|---|---|
| Client / CDN | `Cache-Control`, `ETag` + `304 Not Modified` | 30–60 s |
| Application | Redis, keyed by the full query | 1–5 min |
| Database | Postgres shared buffers / MongoDB WiredTiger cache | — |

The Redis key must include every parameter that changes the result, or two
different requests will collide:

```
products:list:v1:category=Electronics:min=50:max=200:sort=price:desc:page=1:limit=10
```

Two details that matter more than the caching itself:

- **Invalidate on write.** `POST`, `PUT`, and `DELETE` must drop the affected
  keys. A version prefix (`v1`) or a per-category tag makes bulk invalidation one
  operation instead of a key scan. Without this, a stock level can be wrong for
  as long as the TTL.
- **Guard against stampedes.** When a hot key expires under load, every
  concurrent request misses at once and hits the database together. Recompute
  under a short lock, or serve the stale value while one worker refreshes it.

Cache *individual products* by id too — `GET /products/:id` is the highest-volume
endpoint in most catalogues, and a single-key lookup is trivially cacheable.

### 3.5 Reduce per-request work

- **Project only the fields the client needs.** Smaller rows mean more of them
  fit in cache and fewer bytes cross the network.
- **`.lean()` in Mongoose** (already used in `listProducts`) skips hydrating full
  Mongoose documents — measurably cheaper when the result is only going to be
  serialised to JSON.
- **Run the page query and the count in parallel** rather than sequentially —
  already done via `Promise.all`.
- **Cap the page size.** `limit` is capped at 100 by the validator, so no client
  can ask for a million rows and exhaust the connection pool.

### 3.6 Scale the connections, then the topology

- **Pool connections.** Postgres forks a backend process per connection, so it
  needs PgBouncer in front of it at scale; MongoDB's driver pools by default, and
  `maxPoolSize` should be tuned rather than left at its default.
- **Read replicas.** Send listing traffic to replicas and keep writes on the
  primary (`readPreference: 'secondaryPreferred'` in MongoDB). Note the
  consistency cost: a product created on the primary may not be visible on a
  replica for a few milliseconds, so a read-your-own-writes flow must be pinned
  to the primary.
- **Partition or shard only once a single node is genuinely the limit.** For
  time-series-shaped data, range-partitioning by `created_at` lets the planner
  skip whole partitions. A bad shard key is very hard to undo — this is the last
  lever to reach for, not the first.

### 3.7 Measure, don't guess

Every claim above should be verified on the real data distribution, because the
planner's choice depends on selectivity:

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;   -- PostgreSQL
```

```js
db.products.find(...).explain('executionStats');   // MongoDB
```

The numbers to watch:

| Signal | Meaning |
|---|---|
| `Seq Scan` / `COLLSCAN` | No index used — the whole table is being read |
| `Sort Method: external merge Disk` | The sort spilled to disk |
| `totalDocsExamined >> nReturned` | The index is not selective enough, or is missing |
| `totalDocsExamined: 0` | Covered query — answered from the index alone |
| estimated `rows` far from `actual rows` | Stale statistics; run `ANALYZE` |

A sequential scan is not automatically wrong: when a filter matches most of the
table, reading it sequentially genuinely beats random index lookups, and the
planner knows that. It is only a problem when the filter is selective and the
statistics are stale — the fix is `ANALYZE`, not forcing the index.

And measure at the percentile that reflects user experience: p95 and p99 latency
under realistic concurrency. A mean of 12 ms can easily hide a p99 of 4 seconds,
and it is the p99 that people notice.
