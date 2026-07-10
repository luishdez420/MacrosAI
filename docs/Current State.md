# Current State

Last updated: 2026-07-09

This document describes the implementation that exists today. The repository implementation is the source of truth when this document conflicts with code. Related documents: [[Architecture]], [[Roadmap]], [[Decisions]], [[Known Issues]], [[Product Vision]].

## Current milestone

MVP vertical slice with reliable meal entry and confirmation hardening in progress.

Accurate manual logging, persisted meals, daily diary totals, barcode/custom-food logging, basic goals and insights, assistive label extraction, and camera confirmation are operational. Production identity, privacy/storage, and broader automated testing remain incomplete.

## Current priority

Move the working MVP toward safe production operation:

1. Production account operations: managed identity or OAuth, recovery, richer device/session management, and distributed rate limiting.
2. Privacy controls, image storage/retention, and audit-log review/retention.
3. Advanced camera candidate/add-on correction and correction-report administration.
4. Provider cache refresh policy and broader mobile/E2E coverage.

## Implemented

- Monorepo with `apps/mobile`, `apps/api`, shared packages, Docker Compose, and CI.
- Expo SDK 54 mobile app using TypeScript and Expo Router.
- Mobile routes for home/calendar, camera, barcode, nutrition-label capture and review, manual search, saved foods, custom food, meal confirmation, meal detail, and profile.
- Mobile natural-entry route for explicitly weighted multi-food text entry with source-record confirmation.
- Floating bottom navigation for Home, Progress, Scan, and Profile, with Home treated as the logging hub for manual search, barcode, saved foods, food source, and meal detail routes.
- Shared mobile design tokens and reusable UI components.
- FastAPI backend mounted under `/api/v1`.
- SQLAlchemy models and Alembic migration for users, goals, foods, meals, analysis jobs, favorites, recent foods, custom foods, and related entities.
- PostgreSQL-oriented database setup plus local SQLite support for phone preview.
- Request ID middleware and consistent API error envelopes.
- Configurable process-local rolling-window rate limiting for authentication and paid image-analysis routes, with `429` error envelopes, retry guidance, and request IDs.
- Database-backed minimal audit events for register, login, refresh, logout, data export, and account deletion. Events retain request IDs and one-way client fingerprints without credentials, tokens, food data, images, or free-form request payloads.
- USDA FoodData Central provider for food search and external food detail lookup, with successful search/detail results cached as normalized source records.
- Open Food Facts provider for packaged-food barcode lookup, with successful barcode records cached for repeat scans.
- Shared external-provider HTTP policy with configurable timeouts, bounded exponential retry, capped `Retry-After` handling, and retries limited to transport failures, rate limits, and transient server responses.
- Custom-food backend endpoint and mobile create/edit/save/log flow for user-entered per-100g records, with assistive nutrition-label extraction, raw-label and normalized per-100g review, explicit user confirmation, manual fallback, and saved notes indicating whether extraction was reviewed.
- Recent-food persistence when meals are created or edited, plus recent-food display in Manual Search.
- Favorite-food backend endpoints, a food-provenance favorite toggle, favorite-food display in Manual Search, and a saved-foods management screen with search/category filtering, visible bulk clearing, and client-side sorting.
- Food detail/provenance mobile route linked from manual search, barcode logging, meal confirmation, and saved meal detail.
- Food provenance screen showing provider, source reference, confidence, quality warnings including stale cached source and duplicate nutrition-conflict warnings, serving options, per-100g nutrients, original nutrient IDs, saved-meal snapshot fallback, and basic source correction-report submission.
- Profile source-report history showing recent current-user correction reports, open status, linked source metadata, and source review links when the source record still exists.
- Food search/detail caching seeds normalized source records, exact fresh cached food-name searches can be served without another external provider call, food detail safely attempts to refresh stale provider records before showing the cached snapshot, and search can fall back to cached matches when provider search fails after records have been cached.
- Manual food search with grams, ounces, or verified source-serving entry, per-100g nutrient calculation, keyboard-dismiss-on-drag behavior, and a sticky log action that stays above either the floating tabs or the keyboard after selecting a food. Ounces are converted to grams before nutrition calculation while the entered unit is retained on the meal snapshot. A serving option is disabled when its source lacks a verified gram weight; the app does not assume that a serving equals 100g.
- Conservative natural-language manual entry: parses up to six semicolon/newline-separated foods with explicit gram or ounce weights, searches provider records, requires a user selection for every item, and saves a combined meal snapshot. Cups, pieces, and unweighted descriptions are rejected rather than converted to grams.
- Barcode scanner with inline no-match/error states, typed barcode fallback, manual-search fallback, nutrition-label extraction/manual-entry fallback, grams/ounces/serving confirmation, user custom barcode-product fallback, cached Open Food Facts repeat lookup, and serving/per-100g quality warnings for conflicting packaged-food records.
- Persistent meal creation, listing, reading, editing, and deletion.
- Meal-item nutrition snapshots so historical totals do not silently change when external providers update.
- Diary endpoint and home dashboard totals from persisted backend snapshots.
- Home dashboard for today's logging actions, daily totals, and meal timeline.
- Basic progress/calendar screen with a seven-day calorie line graph powered by `GET /api/v1/insights/weekly` against the saved goal, plus a basic monthly rhythm card powered by `GET /api/v1/insights/monthly`.
- Local register, login, refresh, logout, and session endpoints using hashed local passwords, signed short-lived JWT access tokens, hashed opaque refresh-token sessions with rotation/revocation, and SecureStore-backed mobile refresh/retry behavior.
- Basic local session-management API and Profile controls: users can inspect active refresh sessions, identify the current device, and revoke another active session.
- Basic profile flow for local sign-in and saving nutrition goals.
- Basic current-user JSON data export endpoint and Profile export summary action.
- Basic user preferences endpoint and Profile persistence for US/metric unit-system selection.
- Basic goal recommendation from height, weight, body-fat estimate, and direction with US and metric input modes that convert current height/weight entries when switching systems.
- Basic weight tracking API and Profile workflow for logging today’s weight, editing and deleting entries, viewing recent entries, seeing a unit-aware weight trend graph, and comparing the trend with the selected goal direction.
- Camera capture and photo import.
- Shared meal/label image validation rejects invalid base64, unsupported image signatures, and decoded images larger than 12 MB before calling the vision provider.
- Camera analysis endpoint that identifies visible foods, matches provider records, and returns provider-backed nutrition estimates.
- Meal confirmation screen with photo preview, source badges, confidence notes, AI candidate-label search suggestions, source review links, identity confirmation, in-card provider search replacement, provider-backed sauce/topping add-ons with explicit grams, add-on source review links and quality warnings, inline source issue reporting, preparation selection, structured skin/bone/sauce/cheese/sugar review chips, editable gram amounts, added oil/butter adjustment, notes for sauces/toppings, remove, duplicate, split, and mark-incorrect controls before logging.
- Backend tests for calculations, meal persistence, camera analysis helpers, auth, goals, food detail, custom foods, favorites/recents, correction reports, and weight entries.
- Mobile TypeScript checking, initial mobile Jest component/unit tests for food provenance, saved-meal source fallback, camera confirmation save blocking, barcode recovery/cooldown, nutrition-label extraction recovery and custom-food review gating, Home logging-hub rendering, manual-search layout/logging, progress graph status, saved-food presentation, Profile US/metric switching, and floating-tab configuration, plus CI jobs for mobile typecheck, mobile tests, backend linting, Alembic heads, and backend tests.

## Partially implemented

- Authentication: local accounts now receive signed short-lived JWT access tokens and rotated opaque refresh-token sessions; revoked sessions invalidate access tokens immediately and mobile refreshes once after a `401`. Users can review active local refresh sessions in Profile and revoke another device. A process-local rate limiter protects credential and analysis endpoints, but OAuth, password reset/recovery, richer device/session management, distributed rate limiting, and a production identity provider are still pending. Development no-token and legacy local-token compatibility remain explicitly configurable and must be disabled in production.
- Nutrition provenance: a dedicated food detail screen, basic source correction-report submission, and current-user report history now exist, but admin review/status management and richer provider-cache provenance are still pending.
- Camera confirmation: users can review identity, search model-returned candidate labels, replace a detected food through provider search, add provider-backed sauces/toppings with explicit grams, review add-on sources and quality warnings, report source issues inline, review preparation, structured hidden-ingredient details, grams, added oil/butter, notes, source details, and item inclusion before saving. Advanced add-on organization, candidate ranking beyond search suggestions, and admin report-management workflows are still pending.
- Custom foods: users can create, edit, save, reuse, and log user-entered per-100g custom foods from mobile. Barcode no-match can create a user custom packaged product that future barcode scans can find. Nutrition-label capture can extract only visible values, normalize per-serving values when a verified gram weight is available, show the local photo and raw values beside editable per-100g fields, and require explicit user comparison before saving. Stored label evidence and richer verification remain pending.
- Favorites: users can add/remove favorites from food provenance, see favorites in Manual Search, search/filter/sort them in Saved Foods, remove individual favorites, and bulk clear visible favorites from Saved Foods.
- Recent foods: automatic persistence, Manual Search display, Saved Foods search/filter/sorting, individual removal, and bulk clearing of visible recents exist; richer saved-food organization controls are pending.
- Weight tracking: basic API and Profile workflow exist for daily entries, recent history, entry editing/deletion, a unit-aware trend graph, and basic selected-goal-direction feedback; richer goal integration is pending.
- Privacy controls: current-user JSON export, basic local account deletion, Profile image-retention preference editing, and minimal internal audit events for sensitive account operations exist. Image deletion, retention enforcement, object storage, audit-log review/retention controls, and production account lifecycle remain pending.
- Insights: the mobile calendar/progress screen shows a basic seven-day graph from the backend weekly insights endpoint and a basic monthly rhythm card from the backend monthly insights endpoint. Richer trend analysis remains pending.
- Open Food Facts validation: required per-100g checks, serving-vs-per-100g conflict detection, negative nutrient flagging, parsed gram serving basis, and basic confidence flags exist, but richer completeness scoring remains incomplete.
- Data-quality checks: basic energy/macro consistency, negative nutrient checks, missing name checks, stale cached source flags, exact fresh cached search reuse, safe stale detail refresh, search-time duplicate nutrition-conflict flags, and possible kJ confusion checks exist; broader cache refresh policy and richer stale-record/duplicate handling are pending.
- Accessibility: some large touch targets and reduced-motion behavior exist, but a full VoiceOver, dynamic text, and contrast audit is pending.
- Documentation: core docs now exist, but deployment, testing, contribution, and detailed operations guides still need expansion.

## Planned but not implemented

- OAuth or managed identity, password reset/recovery, session naming/device metadata, broader device/session management, and production account lifecycle beyond the implemented local-password JWT/refresh-token foundation.
- Distributed rate limiting, audit-log review/retention controls, and broader production security controls.
- Provider cache expiration policy, background refresh, persisted duplicate-record history, and richer provider outage fallback beyond the current bounded request retries, stale detail refresh, stale cached source flag, and search-time duplicate-conflict flags.
- Object storage for meal images, signed URLs, metadata stripping pipeline, image retention, and deletion controls.
- Full privacy flows beyond basic JSON export, local account deletion, retention preference editing, and minimal audit events: image deletion, retention enforcement, object storage, production account lifecycle, audit-log review, and immutable audit delivery.
- Richer natural-language parsing beyond the current explicit grams/ounces syntax, including commercial-provider coverage, recipes, restaurant language, and household-measure handling backed by verified mappings.
- Stored nutrition-label evidence and richer verification beyond the current assistive extraction and explicit review flow.
- Recipe builder.
- Richer persisted goal-integrated weight insights beyond the current selected-direction feedback.
- Richer weekly/monthly trend analysis beyond the current calorie summaries.
- Offline drafts and sync queue.
- Broader mobile component tests, navigation tests, accessibility tests, and end-to-end tests.
- Production observability, Sentry-compatible error reporting, and app-store build hardening.

## Known technical constraints

- Camera-based nutrition remains an estimate because a photo cannot reliably reveal exact weight, cooking oil, sauces, hidden ingredients, edible portion, or cooking method.
- Local passwords are hashed and JWT/refresh-session rotation is implemented, and Profile can review/revoke active local sessions. The default development configuration still permits no-token preview access and legacy local tokens. Credential and image-analysis endpoints have configurable process-local request limits. Production startup requires a strong `JWT_SECRET` and disables both compatibility modes; OAuth, recovery, session naming/device metadata, and distributed rate limiting remain incomplete.
- External nutrition provider search is still attempted for broad or stale active search flows. Barcode lookup checks user-created barcode products and cached Open Food Facts source records before external providers; search/detail lookups seed normalized cached records, exact fresh cached food-name searches can avoid another provider call, stale food detail can safely refresh from the provider, and search can fall back to cached matches after a provider failure. USDA and Open Food Facts requests now use configurable timeouts and bounded retries for transient failures. Broader cache expiration, automatic refresh policy, and distributed outage handling are still pending.
- Expo Go phone testing depends on LAN reachability between the phone and Mac.
- The current mobile app has an initial Jest component/unit test runner for the food provenance screen, saved-meal source fallback, camera confirmation save blocking, barcode no-match recovery, barcode cooldown helpers, Home logging-hub rendering, custom-food manual label-review gating, manual-search selected-food logging controls, progress graph goal-status rendering, Profile unit switching, and selected presentation/layout helpers, but most mobile flows still lack automated component, navigation, accessibility, and end-to-end coverage.
- The project is not yet production-ready for sensitive user data because production account lifecycle, image deletion, retention enforcement, object storage, distributed rate limiting, and audit-log review/retention controls remain incomplete. The current in-memory limiter does not coordinate across API processes or replicas.
