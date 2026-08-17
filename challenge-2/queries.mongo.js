/**
 * Challenge 2 — MongoDB
 *
 * "Retrieve products by category (e.g. "Electronics"), sorted by price in
 *  descending order. Limit the result to 5 products per page."
 *
 * Written for the mongosh shell:
 *
 *     mongosh "mongodb://127.0.0.1:27017/product-inventory" challenge-2/queries.mongo.js
 *
 * The same queries run in the API — see src/modules/products/product.service.ts,
 * where `listProducts` builds this exact find/sort/skip/limit chain.
 */

const PAGE_SIZE = 5;
const CATEGORY = 'Electronics';

// ===========================================================================
// 1. Indexes
// ===========================================================================

// Field order follows the ESR rule — Equality, Sort, Range:
//   category (equality)  ->  price (sort)
//
// With { category: 1, price: -1 } MongoDB seeks to the category's section of the
// index and walks it in already-descending price order. That means:
//   * no in-memory sort stage, so no 32 MB sort-memory limit to hit
//   * `skip` walks index entries rather than fetching and discarding documents
//
// The reverse, { price: -1, category: 1 }, cannot do this: it would scan the
// whole index filtering on category, then sort the survivors.
db.products.createIndex({ category: 1, price: -1 }, { name: 'category_price_desc' });

// Serves the price-range query (Challenge 2's SQL half) and `sortBy=price`.
db.products.createIndex({ price: 1 }, { name: 'price_asc' });

// ===========================================================================
// 2. The required query
// ===========================================================================

function productsByCategory(category, page = 1) {
  return db.products
    .find(
      { category },
      // A projection is not cosmetic: it cuts bytes off the wire and off every
      // cache layer, and it is what makes a covering index possible below.
      { name: 1, category: 1, price: 1, quantity: 1, createdAt: 1 },
    )
    .sort({ price: -1, _id: -1 }) // _id breaks price ties, so paging is stable
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE);
}

print(`\n-- ${CATEGORY}, price descending, page 1 --`);
printjson(productsByCategory(CATEGORY, 1).toArray());

// ===========================================================================
// 3. Aggregation equivalent
// ===========================================================================

// Same result set. An aggregation is the right tool once you need computed
// fields, grouping, or a single round-trip that also returns the total —
// otherwise `find` is leaner.
//
// $match must come first so the index is used; a $match after a $project or
// $unwind cannot use one.
function productsByCategoryAggregate(category, page = 1) {
  return db.products.aggregate([
    { $match: { category } },
    { $sort: { price: -1, _id: -1 } },
    { $skip: (page - 1) * PAGE_SIZE },
    { $limit: PAGE_SIZE },
    { $project: { name: 1, category: 1, price: 1, quantity: 1, createdAt: 1 } },
  ]);
}

print(`\n-- ${CATEGORY}, aggregation pipeline, page 1 --`);
printjson(productsByCategoryAggregate(CATEGORY, 1).toArray());

// ===========================================================================
// 4. Page and total in one round-trip ($facet)
// ===========================================================================

// A paginated endpoint needs both the page and the total. $facet gets both from
// one query — but note that the count branch still scans every match, so on a
// large collection prefer a cached or estimated total (see README.md).
function pageWithTotal(category, page = 1) {
  return db.products.aggregate([
    { $match: { category } },
    {
      $facet: {
        items: [
          { $sort: { price: -1, _id: -1 } },
          { $skip: (page - 1) * PAGE_SIZE },
          { $limit: PAGE_SIZE },
          { $project: { name: 1, price: 1, quantity: 1 } },
        ],
        total: [{ $count: 'count' }],
      },
    },
    {
      $project: {
        items: 1,
        total: { $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0] },
      },
    },
  ]);
}

print(`\n-- ${CATEGORY}, page + total via $facet --`);
printjson(pageWithTotal(CATEGORY, 1).toArray());

// ===========================================================================
// 5. Keyset pagination — for deep pages
// ===========================================================================

// `skip` is O(skip): page 10,000 walks 50,000 index entries before returning
// anything. Resuming after the last seen (price, _id) is O(page size) instead.
function productsByCategoryAfter(category, lastPrice, lastId) {
  return db.products
    .find({
      category,
      // Descending order, so "after" means "lower price", and for equal prices
      // "lower _id". Expressed as $or because MongoDB has no row-value
      // comparison; both branches are still served by the compound index.
      $or: [{ price: { $lt: lastPrice } }, { price: lastPrice, _id: { $lt: lastId } }],
    })
    .sort({ price: -1, _id: -1 })
    .limit(PAGE_SIZE);
}

const firstPage = productsByCategory(CATEGORY, 1).toArray();
if (firstPage.length === PAGE_SIZE) {
  const last = firstPage[firstPage.length - 1];
  print('\n-- next page, resumed by keyset --');
  printjson(productsByCategoryAfter(CATEGORY, last.price, last._id).toArray());
}

// ===========================================================================
// 6. Proving the index is used
// ===========================================================================

print('\n-- explain: executionStats --');
const explained = db.products
  .find({ category: CATEGORY }, { name: 1, price: 1, quantity: 1 })
  .sort({ price: -1, _id: -1 })
  .limit(PAGE_SIZE)
  .explain('executionStats');

printjson({
  stage: explained.queryPlanner.winningPlan.stage,
  indexUsed: explained.queryPlanner.winningPlan.inputStage?.indexName ?? 'NONE',
  docsExamined: explained.executionStats.totalDocsExamined,
  keysExamined: explained.executionStats.totalKeysExamined,
  returned: explained.executionStats.nReturned,
  millis: explained.executionStats.executionTimeMillis,
});

// How to read it:
//
//   nReturned == totalKeysExamined == totalDocsExamined
//       Ideal — the index found exactly the matching documents.
//
//   totalDocsExamined == 0
//       Better still: a covering index, answered from the index alone.
//       Requires the projection to name only indexed fields (and exclude _id).
//
//   totalDocsExamined >> nReturned
//       The index is not selective enough, or is missing. Examining 100,000
//       documents to return 5 is the signature of a slow endpoint.
//
//   winningPlan.stage === 'COLLSCAN'
//       No index used at all — the collection is being read end to end.
//
//   A 'SORT' stage present
//       The sort is happening in memory rather than coming from the index. It
//       fails outright past 32 MB unless allowDiskUse is set.
