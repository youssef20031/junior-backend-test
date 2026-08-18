-- Challenge 2 — PostgreSQL schema for the products table.
--
-- Mirrors the MongoDB schema in the brief, with the constraints the API's
-- Express Validator rules enforce pushed down into the database as well, so the
-- data cannot be corrupted by a second writer that bypasses the API.

CREATE TABLE IF NOT EXISTS products (
    id          bigserial     PRIMARY KEY,
    name        varchar(200)  NOT NULL CHECK (btrim(name) <> ''),
    category    varchar(100),                                    -- optional, per the brief
    price       numeric(12, 2) NOT NULL CHECK (price > 0),        -- positive
    quantity    integer        NOT NULL CHECK (quantity >= 0),    -- non-negative integer
    created_at  timestamptz    NOT NULL DEFAULT now(),
    updated_at  timestamptz    NOT NULL DEFAULT now()
);

-- `numeric`, not `float8`: money must not accumulate binary rounding error.
-- `timestamptz`, not `timestamp`: stores an absolute instant, so the values stay
-- correct across deployments in different time zones.

-- ---------------------------------------------------------------------------
-- Indexes
--
-- One per query shape the application actually issues. Each index costs write
-- throughput and storage, so an index that no query uses is pure overhead —
-- find them with `pg_stat_user_indexes.idx_scan = 0`.
-- ---------------------------------------------------------------------------

-- Query 1: price BETWEEN 50 AND 200 ORDER BY price ASC.
-- A B-tree on price serves both halves at once: the range becomes an index scan
-- over a contiguous leaf-page span, and because B-tree leaves are already in key
-- order, the ORDER BY is free — no Sort node, so no work_mem sort and no risk of
-- spilling to disk.
CREATE INDEX IF NOT EXISTS products_price_idx
    ON products (price);

-- The covering variant. INCLUDE stores the payload columns in the leaf pages
-- without adding them to the key, which allows an Index Only Scan: Postgres
-- answers the query from the index alone and never touches the heap. Worth it
-- for a hot listing endpoint; skip it if writes dominate reads.
CREATE INDEX IF NOT EXISTS products_price_covering_idx
    ON products (price)
    INCLUDE (id, name, category, quantity);

-- Query 2's relational equivalent: WHERE category = ? ORDER BY price DESC.
-- Column order follows the ESR rule — Equality first, then Sort. With
-- (category, price DESC) a single index scan finds the category's slice and
-- walks it already sorted. The reverse order, (price, category), would force a
-- full scan of the price range followed by a filter and a sort.
CREATE INDEX IF NOT EXISTS products_category_price_idx
    ON products (category, price DESC);

-- Supports the default "newest first" listing, and the keyset pagination in
-- queries.sql. `id` breaks ties so the ordering is total, not just partial.
CREATE INDEX IF NOT EXISTS products_created_at_id_idx
    ON products (created_at DESC, id DESC);

-- Keep the planner's row-count and histogram estimates fresh. Without accurate
-- statistics it will happily choose a sequential scan over a perfect index.
ANALYZE products;
