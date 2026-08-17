-- Challenge 2 — PostgreSQL
--
-- "Fetch products with a price between $50 and $200, ordered by price
--  (ascending), with pagination (10 products per page)."
--
-- Run schema.sql first. $1 is the page number (1-based).

-- ===========================================================================
-- 1. The required query — OFFSET pagination
-- ===========================================================================

SELECT id,
       name,
       category,
       price,
       quantity,
       created_at,
       updated_at
FROM   products
WHERE  price BETWEEN 50 AND 200      -- inclusive on both ends
ORDER  BY price ASC,
          id ASC                     -- tiebreaker: makes the ordering total
LIMIT  10
OFFSET ($1 - 1) * 10;

-- Why `id ASC` is not decorative: `ORDER BY price` alone is a partial order, so
-- two products priced at 99.99 may come back in either order on either page.
-- That lets a row appear on both page 1 and page 2, or on neither. Any column
-- combination used for pagination must be unique in aggregate.

-- Parameterised, never interpolated — `$1` is bound by the driver, so a page
-- number cannot become SQL injection. `LIMIT 10` is a literal because the page
-- size is the API's contract, not the caller's choice.


-- ===========================================================================
-- 2. Deep pagination — the problem with OFFSET
-- ===========================================================================

-- OFFSET is O(offset): Postgres must produce and discard every preceding row.
-- Page 1 reads 10 rows; page 10,000 reads 100,010 and throws away 100,000. The
-- query gets steadily slower the further a user scrolls, and this is invisible
-- in testing because test datasets are small.

-- Keyset (a.k.a. seek or cursor) pagination replaces "skip N rows" with "resume
-- after this row". The client sends back the last row it saw; the index seeks
-- straight to that point. Cost is O(page size) — page 10,000 is as fast as
-- page 1.
--
--   $1 = last_price, $2 = last_id from the previous page

SELECT id, name, category, price, quantity, created_at, updated_at
FROM   products
WHERE  price BETWEEN 50 AND 200
  AND  (price, id) > ($1, $2)        -- row-value comparison, index-friendly
ORDER  BY price ASC, id ASC
LIMIT  10;

-- The `(price, id) > ($1, $2)` row constructor is what makes this work: Postgres
-- can turn it into a single index seek on (price, id). Writing it out as
-- `price > $1 OR (price = $1 AND id > $2)` is logically identical but the
-- planner handles it far less well.
--
-- Trade-off: keyset pagination cannot jump to an arbitrary page number, so it
-- suits infinite scroll and "next/previous" navigation rather than numbered
-- page links. Use OFFSET where a user genuinely needs page 47, and keyset
-- wherever the traversal is sequential.


-- ===========================================================================
-- 3. Total counts
-- ===========================================================================

-- The exact count needed for `totalPages` is the expensive half of a paginated
-- endpoint: it must visit every matching row, so it does not benefit from LIMIT.
SELECT count(*) FROM products WHERE price BETWEEN 50 AND 200;

-- A cheap estimate, accurate to a few percent, straight from the planner's
-- statistics — no table access at all. Good enough for "about 12,000 results".
SELECT (SELECT reltuples::bigint FROM pg_class WHERE relname = 'products') AS estimated_rows;

-- For a filtered estimate, ask the planner what it expects without executing:
EXPLAIN (FORMAT JSON)
SELECT 1 FROM products WHERE price BETWEEN 50 AND 200;
-- ... then read "Plan" -> "Plan Rows".


-- ===========================================================================
-- 4. Verifying the index is actually used
-- ===========================================================================

-- Always measure. `EXPLAIN` shows the plan; `ANALYZE` runs the query and reports
-- real timings; `BUFFERS` shows how many pages were read, which is the number
-- that actually correlates with load.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, name, category, price, quantity
FROM   products
WHERE  price BETWEEN 50 AND 200
ORDER  BY price ASC, id ASC
LIMIT  10 OFFSET 0;

-- What to look for:
--
--   GOOD  Index Scan using products_price_idx    <- range + order from the index
--   BEST  Index Only Scan using products_price_covering_idx
--                                                <- heap never touched
--   BAD   Seq Scan on products                   <- reading the whole table
--   BAD   Sort  (Sort Method: external merge Disk: NNNkB)
--                                                <- sorting, and spilling to disk
--
-- A `Seq Scan` is not automatically wrong: if the range matches most of the
-- table, reading it sequentially beats random index lookups, and the planner
-- knows this. It is only a problem when the filter is selective and the planner
-- has stale statistics — fix that with ANALYZE, not by forcing the index.
--
-- Compare `rows=` (estimated) against `actual rows=` in the output. A large gap
-- means the planner is guessing badly, which is the root cause of most
-- mysteriously slow queries.
