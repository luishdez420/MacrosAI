# Nutrition Source Strategy

Last updated: 2026-07-21

Related documents: [[Current State]], [[Architecture]], [[Decisions]], [[Known Issues]].

Living Nutrition stores canonical nutrient values per 100 grams whenever the source supports it.

The calculation rule is:

```text
nutrientAmount = nutrientPer100g * consumedGrams / 100
```

The app does not calculate from rounded display values. It preserves source nutrients, the quality assessment shown at logging time, and logged meal snapshots so historical meals do not silently change when providers update records.

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
- User-created recipes preserve the confirmed source-backed nutrition snapshots and grams selected in Meal Builder. Logging a recipe creates a new editable meal snapshot; it does not re-query providers or imply live nutrition updates. Recipe editing and richer organization remain planned.
- Camera analysis can receive one to three photos of the same meal. Additional views can corroborate visible food identity, but cannot establish exact weight, hidden ingredients, oils, sauces, or cooking method. Users must still confirm identity, preparation, add-ons, and grams before a meal is persisted.
- Provider caching is implemented for successful search, detail, and barcode records. Fresh exact food-name search matches can be served from cached normalized records, and stale Food Detail/exact barcode records claim a database-backed refresh lease before contacting a provider. A failed or no-match refresh leaves the flagged cached snapshot available and records jittered exponential backoff; a successful refresh clears that state. An independently runnable worker periodically considers an oldest-first, configured-size batch of eligible stale non-user source records and uses the same lease/backoff path; it never prefetches arbitrary queries, refreshes custom foods, or changes immutable meal snapshots. The initial external normalized snapshot and later meaningful provider-record changes are retained as a bounded Food Detail history; unchanged retrievals update freshness without creating another revision. USDA and Open Food Facts requests use configurable timeouts and bounded retries for transient failures. Query-cache prefetching and broader cache expiration policy are not implemented.

## Confidence

Confidence is shown as separate values:

- Food identity confidence
- Portion confidence
- Nutrition-record confidence

These are product guidance labels, not medical accuracy guarantees.

## Data Quality Checks

Records should be rejected or flagged when calories are inconsistent with macros, serving sizes are missing or zero, nutrients are negative, names are missing, or per-serving and per-100g data appear mixed.

Currently implemented checks include basic energy/macros consistency, missing name, zero serving size in USDA records, required USDA core nutrient identifiers, negative nutrients, incomplete or non-numeric Open Food Facts core per-100g data, Open Food Facts serving-vs-per-100g conflict and unverified-serving-basis flags, stale cached source flags for older provider records, bounded request-safe and scheduled stale-provider refresh, and persisted same-name cross-provider nutrition-conflict evidence. A deterministic `qualityAssessment` classifies every current food record as `complete`, `needs_review`, `insufficient_data`, or `user_entered` and lists concrete source signals such as stale, conflicting, incomplete, serving-basis, or validation data. `insufficient_data` blocks meal logging; review states remain visible and require the user to confirm the source and portion. New manual, barcode, natural-entry, custom-food, Meal Builder, and camera-confirmed meal snapshots retain the assessment shown when the food was logged. A Food Detail record distinguishes a current disagreement from historical evidence after source records align. A descriptive Open Food Facts serving without a verified gram or milliliter basis does not prevent direct gram logging, but is shown as a warning and does not justify automatic serving conversion. Provider-specific quality tiers, duplicate-ranking policy, and broader community-data validation remain planned.
