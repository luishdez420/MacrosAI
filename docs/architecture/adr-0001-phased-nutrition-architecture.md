# ADR 0001: Phased Nutrition Architecture

Last updated: 2026-07-08

## Status

Accepted.

## Context

Camera-only nutrition estimates are not reliable enough to save directly. Photos cannot reveal exact weight, hidden oils, sauces, edible portion, cooking method, or complete ingredients.

## Decision

Build the product in phases:

1. Foundation: monorepo, TypeScript Expo app, FastAPI backend, design tokens, provider interfaces, docs, and CI.
2. Accurate manual logging: USDA search, food details, gram and serving entry, meal diary, daily totals, favorites, and recents.
3. Packaged foods: barcode scanning, Open Food Facts integration, validation, custom products, and nutrition-label capture.
4. Camera-assisted logging: image upload, structured vision detection, confidence display, and confirmation workflow.
5. Insights and recipes.

## Consequences

Manual logging becomes the first accuracy anchor. Camera analysis remains an assisted-entry workflow and cannot save a meal until the user confirms food identity and portion.

## Current implementation note

As of 2026-07-08, manual logging, barcode logging, persisted meals, diary totals, basic goals, food provenance, custom foods, basic favorites/recents, weight logging, and basic meal edit/delete exist. Camera confirmation supports explicit identity confirmation, model-returned candidate-label search suggestions, in-card provider search replacement, source review, inline source issue reporting, preparation selection, structured hidden-ingredient review, added oil/butter grams, provider-backed sauce/topping add-ons with grams, freeform notes, remove, duplicate, split, and mark-incorrect controls before saving. The ADR remains accepted, and the current camera workflow should still be treated as incomplete until it has richer candidate ranking, richer add-on management UX, report-management workflows, and production-grade privacy/storage controls.
