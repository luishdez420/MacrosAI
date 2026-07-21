# Nutrition App

Last updated: 2026-07-08

## Project

- [[Product Vision]]
- [[Architecture]]
- [[Current State]]
- [[Roadmap]]
- [[Decisions]]
- [[Known Issues]]
- [[camera-confirmation-principles]]
- [[nutrition-source-strategy]]

## Research

- USDA FoodData Central integration is documented in [[nutrition-source-strategy]] and implemented through the backend provider abstraction.
- Camera analysis principles are documented in [[camera-confirmation-principles]].

## Current priority

Build a reliable, transparent meal-entry flow:

1. Add managed identity or OAuth, account recovery, richer session management, trusted-proxy policy, and Redis deployment validation beyond the JWT/refresh foundation, basic local session controls, and production-required Redis shared limits.
2. Add enforceable privacy, image storage/retention, and audit controls.
3. Strengthen advanced camera candidate/add-on correction and correction-report administration.
4. Expand provider cache refresh, saved-food organization, richer weight insights, and automated mobile/E2E coverage.
5. Preserve manual search, barcode logging, food provenance, label review, progress graph, profile goals, meal editing, and diary totals as stable core flows.
6. Keep documentation aligned with implementation.

## Current milestone

MVP foundation with Phase 2 manual-logging completion in progress. See [[Current State]] for the implementation snapshot and [[Roadmap]] for the next phases.
