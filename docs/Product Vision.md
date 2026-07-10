# Product Vision

Last updated: 2026-07-08

Related documents: [[Current State]], [[Architecture]], [[Roadmap]], [[Decisions]], [[Known Issues]], [[nutrition-source-strategy]], [[camera-confirmation-principles]].

## Product problem

Nutrition tracking is often slow, repetitive, and easy to mistrust. Camera-only macro estimates can look convenient, but a photo cannot reliably reveal exact weight, hidden oils, sauces, cooking method, edible portion, or ingredient composition.

Living Nutrition exists to make meal logging faster while preserving transparency and user control.

## Target user

The initial target user is someone tracking calories and macronutrients for general wellness, fitness, or habit awareness who wants:

- Faster meal entry than typing everything from scratch.
- Clear protein, carbohydrate, fat, and calorie totals.
- The ability to correct portion sizes.
- Visibility into where nutrition values came from.
- A warm, modern mobile experience that avoids shame-based language.

The product is not positioned as medical nutrition therapy.

## Product promise

Living Nutrition helps users log meals with confidence by combining assisted entry, authoritative nutrition records, editable portions, and visible source information.

The promise is not perfect automatic accuracy. The promise is a faster path to a reviewable, source-backed meal log.

## Core workflows

Current MVP workflows:

1. Search for a food manually.
2. Enter grams, ounces, or servings only when the source verifies a gram basis.
3. Preview calculated calories and macros from per-100g data.
4. Save a meal snapshot.
5. View daily totals and meal timeline.
6. Scan a packaged-food barcode.
7. Confirm package serving or gram amount before saving.
8. Capture or import a meal photo.
9. Review camera-generated estimates and adjust grams before logging.
10. Edit or delete saved meals.
11. Save basic nutrition goals.
12. Inspect food provenance, serving basis, quality warnings, and per-100g nutrients before logging or editing.
13. Create and immediately log a user-entered custom food when provider records are missing.
14. Re-log recently used foods from Manual Search.
15. Favorite trusted foods from source provenance and re-log them from Manual Search.
16. Manage basic favorite and recent food lists from Saved Foods.
17. Edit and reuse user-created custom foods from Saved Foods.
18. Log today’s weight and view recent weight history from Profile.
19. Create a user custom packaged product when barcode lookup fails.
20. Enter up to six explicitly weighted foods in a short natural-language style list, confirm a provider record for each item, and save one meal.

Planned workflows:

- Richer camera confirmation beyond the current basic candidate replacement, preparation review, and add-on logging.
- Richer saved-food organization and filtering.
- Nutrition-label capture and verification.
- Richer weight trends and goal integration.
- Data export and deletion.
- Provider caching and offline-friendly drafts.

## Accuracy and transparency principles

- Nutrition values should come from authoritative providers or user-confirmed custom records.
- AI can assist food identification, but it must not invent final nutrient values.
- Camera-based food and portion analysis is an estimate that requires user review.
- Users should be able to see source provider, source identifier, confidence, serving basis, and gram amount when available.
- Calculations should use per-100g source nutrients and confirmed consumed grams.
- Display rounding should not replace precise internal values.
- Historical meal totals should use saved snapshots rather than silently changing with provider updates.

## What the product must never claim

Living Nutrition must never claim that:

- A single food photo can determine exact macros.
- Camera analysis can reliably detect hidden oils, sauces, or ingredients.
- Estimated portion weight is medically precise.
- AI-generated nutrition values are authoritative.
- The app is a substitute for professional medical or dietary advice.
- Foods are morally good or bad.

## MVP boundaries

The MVP should focus on:

- Reliable manual logging.
- Barcode logging with safe no-match recovery.
- Source-backed calculations.
- Daily diary totals.
- Basic meal editing and deletion.
- Basic goals.
- Camera-assisted estimates with clear review language.

The MVP should not attempt to complete the full production product in one pass. Privacy, production auth, full camera correction, offline sync, insights, recipes, and app-store hardening remain roadmap work.

## Longer-term direction

The longer-term product direction is a premium, transparent nutrition tracker that supports:

- Fast repeat logging.
- Strong source provenance.
- Packaged-food and label workflows.
- Camera-assisted meal entry with robust confirmation.
- Recipes and insights.
- Weight and goal tracking.
- Data export and deletion.
- Privacy-forward image handling.
- Production observability and reliability.
