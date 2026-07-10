# Living Nutrition Feature Status

Last updated: 2026-07-09

This project is intentionally being built in phases. Camera-assisted macro tracking is a high-risk product area because a photo cannot reliably reveal exact weight, cooking oil, sauces, hidden ingredients, or edible portion. The app should treat vision as assisted entry, not final nutrition authority.

## Current State

For the canonical implementation snapshot, see [[Current State]]. For risks, see [[Known Issues]]. For planned phases, see [[Roadmap]].

### Implemented

- Monorepo with `apps/mobile`, `apps/api`, and shared packages.
- Expo SDK 54 mobile app with TypeScript strict mode and Expo Router.
- FastAPI backend with SQLAlchemy models, Alembic migration for PostgreSQL, and SQLite bootstrap for phone preview.
- Design tokens package and polished dashboard skeleton.
- USDA provider for food search and per-100g nutrient normalization.
- Open Food Facts provider for packaged-food barcode lookup.
- Provider search/detail lookups seed normalized cached food records; stale food detail records can safely refresh from the provider, cached search matches can be returned when provider search fails, and USDA/Open Food Facts requests use bounded retries for transient failures.
- Manual food search with grams, ounces, or verified source-serving entry, keyboard-dismiss-on-drag behavior, and a sticky log action that stays above either the floating tabs or the keyboard after selecting a food. Unverified household/volume servings are disabled instead of being assumed to equal 100g.
- Conservative natural entry supports up to six semicolon/newline-separated foods with explicit grams or ounces, source-backed match selection for every item, and combined meal logging. It rejects cups, pieces, and vague portions instead of inferring mass.
- Barcode scanner route with barcode lookup, source/confidence display, grams/ounces/serving confirmation, persisted meal logging, nutrition-label extraction/manual-entry fallback, user custom barcode-product fallback, cached Open Food Facts repeat lookup, and serving/per-100g conflict warnings for packaged-food records.
- Persistent meals, meal-item nutrition snapshots, daily diary endpoint, and home totals loaded from backend.
- Recent foods are automatically persisted from logged meal items and shown in Manual Search.
- Favorite foods can be added/removed from food provenance, shown in Manual Search, searched/filtered/sorted in Saved Foods, removed individually, and bulk cleared for visible results.
- Recent foods can be searched/filtered/sorted, removed individually, and bulk cleared for visible results in Saved Foods.
- Basic meal detail, portion editing, and meal deletion.
- Basic user nutrition goals and profile goal setup.
- Basic current-user JSON data export endpoint and Profile export summary action.
- Profile goal setup supports US and metric height/weight input modes, converts current height/weight entries when switching systems, and persists the selected unit system through user preferences.
- Basic weight tracking API and Profile logging/history workflow with entry editing/deletion, a unit-aware trend graph, and selected-goal-direction feedback.
- Floating navigation separates Home from Progress, Scan, and Profile, with Home as the logging hub and Progress as the seven-day graph route.
- Basic progress/calendar screen shows a seven-day calorie line graph from the backend weekly insights endpoint and a monthly rhythm card from the backend monthly insights endpoint.
- Local register, login, refresh, logout, and session endpoints with hashed local passwords, signed short-lived JWT access tokens, rotated opaque refresh sessions, and SecureStore-backed mobile refresh/retry behavior.
- Basic Profile session management for listing active local refresh sessions, distinguishing the current device, and revoking another session.
- Custom-food backend endpoint and mobile create/edit/save/log flow for user-entered per-100g records, including assistive nutrition-label extraction, safe per-100g normalization, local photo/raw-value comparison, and explicit review confirmation.
- Food detail backend endpoint with serving options and provenance summary.
- Mobile food detail/provenance route linked from manual search, barcode logging, camera meal confirmation, and saved meal detail.
- Food provenance UI showing provider/source reference, confidence, quality warnings including stale cached source and duplicate nutrition-conflict warnings, serving options, per-100g nutrients, original nutrient IDs, saved-meal snapshot fallback when live lookup fails, and basic source correction-report submission.
- Profile source-report history showing recent current-user correction reports, open status, linked source metadata, and source review links when available.
- Camera capture and image import.
- Camera analysis route that returns provider-backed nutrition estimates.
- Camera confirmation screen with source links, explicit food confirmation, AI candidate-label search suggestions, in-card provider search replacement, provider-backed sauce/topping add-ons with explicit grams, add-on source review links and quality-warning copy, inline source issue reporting, preparation selection, structured skin/bone/sauce/cheese/sugar review chips, editable grams, added oil/butter adjustment, notes, remove, duplicate, split, and mark-incorrect controls before logging.
- Request ID middleware, consistent error envelopes, structured logging, Docker Compose, CI skeleton, backend tests, and mobile typecheck.
- Configurable process-local rolling-window limits for authentication and paid image-analysis routes, including `429` retry guidance and request IDs.
- Minimal database-backed audit events for local account/session lifecycle, export, and account deletion without credentials, tokens, meal data, images, or raw IP addresses.

### Partially Implemented

- Authentication: local JWT access tokens, refresh-token rotation, logout revocation, mobile refresh/retry, basic Profile session management, and process-local limits for credential/analysis endpoints are implemented. OAuth, password reset/recovery, session naming/device metadata, distributed rate limiting, and managed production identity remain pending. Development no-token/legacy-token compatibility must be disabled in production.
- Privacy controls: basic current-user JSON export, local account deletion, Profile image-retention preference editing, and minimal internal audit events exist; image deletion, retention enforcement, object storage, production account lifecycle, audit-log review/retention, and immutable audit delivery are still pending.
- Nutrition provenance: dedicated mobile source review, basic source correction reporting, and current-user report history exist; admin review/status management, provider cache history, and richer provenance actions are pending.
- Data-quality checks: basic energy/macros checks, required per-100g checks, negative nutrient flags, Open Food Facts serving-vs-per-100g conflict flags, stale cached source warnings, safe stale detail refresh, and search-time duplicate nutrition-conflict warnings exist; persisted duplicate history, automatic search/barcode refresh, richer completeness scoring, and broader provider-cache quality history are pending.
- Camera workflow: capture, analysis, source review, identity confirmation, model-returned candidate-label search suggestions, provider search replacement, provider-backed sauce/topping add-ons with explicit grams, add-on source review links and quality-warning copy, inline source issue reporting, gram adjustment, preparation selection, structured hidden-ingredient checks, oil adjustment, notes, split/duplicate/remove, and mark-incorrect controls exist. Advanced candidate ranking, richer add-on organization UX, and admin report-management workflows are pending.
- Favorites: basic add/remove, Manual Search display, and Saved Foods search/filter/sort/bulk-clear management exist; richer organization is pending.
- Recent foods: automatic persistence, Manual Search display, and Saved Foods search/filter/sort/removal/bulk-clear exist; richer organization is pending.
- Weight tracking: basic API and Profile logging/history workflow plus entry editing/deletion, a unit-aware trend graph, and selected-goal-direction feedback exist; richer persisted goal integration is pending.
- Insights: backend weekly and monthly insights endpoints exist; the weekly endpoint powers the seven-day graph, and the monthly endpoint powers a basic monthly rhythm card. Richer trend analysis is pending.
- Custom foods: mobile create, edit, save, reuse, and log exists for user-entered per-100g records. Barcode no-match can create a user custom packaged product for future barcode lookup. Assistive label extraction and explicit user review are implemented; stored evidence and richer verification are pending.
- Accessibility: reduced motion exists in camera animation and main controls use reasonable touch targets, but full VoiceOver/dynamic-type audit is pending.
- Testing/documentation: initial mobile Jest coverage exists for the food provenance screen, saved-meal source fallback, food provenance presentation, camera confirmation save blocking, barcode no-match screen recovery, barcode cooldown helpers, Home logging-hub rendering, custom-food manual label-review gating, manual-search sticky layout, manual grams/ounces/servings logging controls, progress graph goal-status rendering, saved-food presentation, profile presentation, Profile US/metric unit switching, and floating-tab configuration; broader mobile flow tests plus deployment/testing/contribution guides need expansion.

## Missing By Phase

### Phase 1 Hardening

- OAuth or managed identity, account recovery, and richer device/session management beyond the implemented JWT/refresh/logout lifecycle and basic local session controls.
- Distributed rate limiting and broader production authorization/security review.
- Distributed rate limiting plus audit-log review, retention, and immutable delivery for sensitive operations.
- EAS development, preview, and production profile validation.
- Environment-specific validation and clearer failure messaging for missing secrets.

### Phase 2 Accurate Manual Logging

- Admin correction-report management and richer food-source actions beyond the current basic source report form and Profile history.
- Richer favorite/recent organization beyond the current Saved Foods search/filter/sort/bulk-clear management screen.
- Daily diary screen separate from the home preview.
- More complete meal editing beyond gram replacement.
- Goal editor refinements beyond the current basic profile goal setup.
- More complete serving options and unit conversions.
- Richer natural-language parsing beyond the implemented explicit grams/ounces syntax, including commercial-provider coverage and verified household-measure mappings.

### Phase 3 Packaged Foods

- Broader cache expiration, automatic search/barcode refresh policy, persisted duplicate history, and provider outage fallback beyond the current bounded retries, barcode/detail cache, stale-detail refresh, stale-source warning, duplicate-conflict warning, and cached-search fallback.
- Richer Open Food Facts validation beyond the current serving-vs-per-100g conflict checks.
- Label-evidence support beyond the current user-entered barcode custom-food and assistive extraction/review flow.
- Consented nutrition-label evidence storage, retention/deletion controls, and richer verification beyond the current temporary local photo and confirmation workflow.
- Product correction report review and status management beyond the current source report submission and Profile history.

### Phase 4 Camera-Assisted Logging

- Async analysis jobs with polling and cancellation.
- Structured vision response with candidate labels, confidence scores, warnings, and portion ranges.
- Strict schema validation and safe retry for malformed model responses.
- Advanced candidate ranking and easier candidate selection beyond the current candidate-label search suggestions.
- Richer add-on management UX beyond the current provider-backed sauce/topping add-ons with gram entry.
- Multi-angle capture and known-reference-object support.
- Object storage abstraction and image-retention controls.

### Phase 5 Insights And Recipes

- Recipe builder and recipe ingredients.
- Richer persisted goal-integrated weight insights beyond the current selected-direction feedback.
- Richer weekly/monthly trend analysis beyond the current calorie summaries.
- Goal editor.
- Hydration and consistency modules.
- Production account lifecycle, image deletion, retention enforcement, and richer data export/download screens beyond the current Profile export/delete summary and retention preference.

### Phase 6 Production Hardening

- Security review.
- Performance and accessibility audits.
- Offline drafts and sync queue.
- Provider cost controls and monitoring.
- Sentry-compatible reporting.
- App-store build and beta-test checklist.

## Next Recommended Slice

The next best implementation target is Phase 2 completion:

1. Replace partial camera gram confirmation with full confirmation cards that must be reviewed before saving.
2. Expand nutrition-label verification beyond the current assistive extraction and confirmation flow into consented stored evidence and richer verification.
3. Expand provider caching/resilience and admin correction-report management.

This keeps accuracy anchored in user-confirmed portions and provider nutrition records before we expand the more uncertain camera workflow.
