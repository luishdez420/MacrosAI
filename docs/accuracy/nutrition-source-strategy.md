# Nutrition Source Strategy

Last updated: 2026-07-09

Related documents: [[Current State]], [[Architecture]], [[Decisions]], [[Known Issues]].

Living Nutrition stores canonical nutrient values per 100 grams whenever the source supports it.

The calculation rule is:

```text
nutrientAmount = nutrientPer100g * consumedGrams / 100
```

The app does not calculate from rounded display values. It preserves source nutrients and logged meal snapshots so historical meals do not silently change when providers update records.

## Provider Priority

1. Exact barcode match with complete manufacturer nutrition data
2. USDA branded-food record
3. USDA Foundation Food or FNDDS record
4. Verified commercial-provider record
5. Open Food Facts record
6. User-created record
7. Unverified AI estimate requiring explicit confirmation

## Current implementation

- USDA FoodData Central is implemented for food search and food detail lookup.
- Open Food Facts is implemented for packaged-food barcode lookup.
- User-created custom food backend support exists.
- Commercial provider support is not implemented.
- User-created recipes are not implemented.
- Provider caching is implemented for successful search, detail, and barcode records. Fresh exact food-name search matches can be served from cached normalized records, and food detail attempts a safe refresh for stale provider records. USDA and Open Food Facts requests use configurable timeouts and bounded retries for transient failures. Background refresh and broader cache expiration are not implemented.

## Confidence

Confidence is shown as separate values:

- Food identity confidence
- Portion confidence
- Nutrition-record confidence

These are product guidance labels, not medical accuracy guarantees.

## Data Quality Checks

Records should be rejected or flagged when calories are inconsistent with macros, serving sizes are missing or zero, nutrients are negative, names are missing, or per-serving and per-100g data appear mixed.

Currently implemented checks include basic energy/macros consistency, missing name, zero serving size in USDA records, negative nutrients, incomplete Open Food Facts per-100g data, Open Food Facts serving-vs-per-100g conflict flags, stale cached source flags for older provider records, safe stale detail refresh, search-time duplicate nutrition-conflict flags, and possible kJ/kcal confusion. Persisted duplicate history, automatic search/barcode refresh, and richer completeness scoring remain planned.
