# Roadmap

Last updated: 2026-07-21

This roadmap is prioritized by product risk and implementation dependencies. It does not include speculative deadlines. See [[Current State]], [[Architecture]], [[Decisions]], and [[Known Issues]].

## Phase 1: Documentation alignment and source-of-truth cleanup

Status: In progress

Goal: Keep project documentation aligned with the codebase.

Why it matters: This project spans mobile, backend, nutrition accuracy, and privacy. Drift makes it too easy to build the wrong next feature or overstate readiness.

Major tasks:

- Maintain [[Current State]] after meaningful changes.
- Maintain [[Architecture]] when data flow, services, auth, providers, or deployment changes.
- Record product and architecture decisions in [[Decisions]].
- Track defects and risks in [[Known Issues]].
- Keep API docs aligned with implemented endpoints.

Dependencies:

- Implementation audits.
- Developer discipline after feature work.

Definition of done:

- Core docs exist and reflect the implementation.
- Missing knowledge-base paths referenced by AGENTS are resolved.
- New meaningful features include matching documentation updates.

## Phase 2: Food detail and nutrition provenance flow

Status: Implemented, with follow-up improvements pending

Goal: Let users inspect the nutrition source, serving basis, quality flags, and per-100g values before trusting or saving a food.

Why it matters: The product promise depends on transparency. Users need to understand whether a value came from USDA, Open Food Facts, a custom food, or an estimate.

Major tasks:

- Add a mobile food detail/source provenance screen. Implemented.
- Link food detail from manual search, barcode result, meal confirmation, and meal detail. Implemented.
- Show provider, source ID, source URL, data type, brand, serving options, retrieved timestamp, confidence, quality flags, and per-100g nutrients. Implemented.
- Clarify confidence copy in user-facing language. Implemented for the detail screen.
- Add correction-report actions. Implemented for source-level reports, safe current-user report history, Clerk-allowlisted server-only triage/resolution, source-revision linking, and minimal transition audits. Moderation policy and user notification delivery remain pending.
- Add provider-cache/version history. Implemented as a bounded external provider-record timeline in the existing Food Detail response and screen; broader cache analytics remain pending.

Dependencies:

- Existing `GET /api/v1/foods/{id}` endpoint.
- Shared types for food detail.

Definition of done:

- A user can inspect source and confidence before logging or editing a meal item. Done.
- Provenance display matches stored meal snapshots. Done for saved-meal fallback.
- No AI-only nutrient value is presented as authoritative. Done for this flow.
- Users can report incorrect records or request correction. Done for source-level reports, safe current-user report history, and Clerk-restricted triage/resolution. Notification delivery, moderation policy, and broader provenance actions remain pending.

## Phase 3: Stronger camera confirmation and correction workflow

Status: In progress

Goal: Convert camera analysis from a partial grams-adjustment flow into a complete confirmation-first workflow.

Why it matters: Camera analysis is useful but uncertain. The app must not imply exact identity, weight, hidden ingredients, or preparation method from a single photo.

Major tasks:

- Show model-returned candidate foods. Implemented as candidate-label search suggestions.
- Add in-card food search replacement per detected item. Implemented.
- Ask cooking method and preparation questions. Implemented with preparation selection and structured skin/bone hidden-ingredient review chips.
- Add oil, sauce, dressing, cheese, sugar, and condiment fields. Implemented at a basic level with added oil/butter grams, structured hidden-ingredient chips, provider-backed add-ons with explicit grams, compact source-aware multi-add management, favorite/recent add-on reuse, accessible add-on ordering, common shortcuts that only prefill a provider search, and freeform sauce/topping notes; reusable add-on groups and batch-selection refinements are pending.
- Support remove, duplicate, split, and mark incorrect. Implemented.
- Show source and confidence explanation for each item. Implemented.
- Preserve bounded multi-view visible-food evidence and order only alternate scan-label suggestions by that support. Implemented. Corroboration is displayed as a review aid and never raises identity confidence; contradictory views lower identity confidence and require user choice.
- Prevent saving until required confirmation fields are reviewed. Implemented for identity, preparation, and grams.
- Process camera work as a durable private-image job and resume one pending review after an app restart without retaining photo bytes on the device. Implemented; job history and multi-job retry controls are pending.

Dependencies:

- Food detail/provenance flow.
- Provider-backed food search.
- Meal update/create snapshot behavior.

Definition of done:

- Camera-generated meals require explicit review before persistence. Partially done for identity, candidate-label search suggestions, provider replacement, preparation, and grams.
- Portion, identity, nutrition-record confidence, and conservative per-view evidence are visible.
- Saved camera meals preserve corrections and provenance.

## Phase 4: Production authentication

Status: Partially implemented

Goal: Replace development local tokens with production-grade authentication.

Why it matters: Nutrition history, photos, and weight data are sensitive personal data.

Major tasks:

- Keep local password hashing and invalid-token rejection covered by tests. Implemented.
- Select Clerk as the managed identity provider. Implemented.
- Add Clerk Expo sign-up, sign-in, email verification, recovery, and Google OAuth. Implemented; hosted configuration and development-build validation remain.
- Verify Clerk JWTs through JWKS and map subjects to internal users. Implemented.
- Provide a bounded legacy local-account migration flow that revokes old refresh sessions. Implemented; migration communication and live validation remain.
- Protect user-owned resources consistently.
- Add basic local session list/revocation controls. Implemented.
- Add backend authorization and migration tests. Implemented; mobile integration/E2E coverage remains.
- Add configurable rolling-window limits for credential and paid image-analysis endpoints. Implemented for local memory preview and production-required Redis shared limits.

Dependencies:

- Clerk tenant configuration.
- Secret management.
- Production environment configuration.

Definition of done:

- Production configuration rejects weak JWT secrets and enables neither dev nor legacy token compatibility. Implemented.
- User data is protected by verified Clerk JWT sessions in Clerk mode; local JWT sessions remain development compatibility only.
- Clerk provisioning/migration and invalid-credential authorization boundaries are tested. Mobile integration/E2E coverage remains.
- Hosted Clerk configuration, account-linking UX beyond Clerk's managed account, trusted-proxy policy, Redis deployment validation/monitoring, and production operations remain pending. Production configuration now requires Clerk verification and Redis-backed shared limits rather than the local preview limiter.

## Phase 5: Recipes, favorites, recent foods, custom foods, weight tracking, and hydration

Status: Partially implemented, with recipe save/log/delete, basic saved-food management, custom-food create/edit/reuse/barcode fallback, assistive nutrition-label extraction and confirmation, basic weight tracking, optional daily hydration totals plus a local opt-in reminder, and range/monthly saved-snapshot insights implemented

Goal: Complete the user-owned nutrition support workflows already represented in the schema.

Why it matters: Fast repeat logging and personal foods are core nutrition-tracker behavior.

Major tasks:

- Expand recent-food management beyond the current automatic persistence and Manual Search display.
- Expand recipe organization, categories, and future-log adjustment beyond the current source-backed save, edit, log-to-today, usage count, and deletion workflow.
- Refine the current live drag-handle reordering and persisted item order in Meal Builder with richer physics-based list layout animation if user testing shows it materially improves the accessible move controls.
- Expand favorite/recent food organization beyond the current Saved Foods search/filter/sort/bulk-clear management screen.
- Expand nutrition-label capture beyond the implemented assistive visual extraction and explicit review flow into consented stored evidence and richer verification. Extraction and safe per-100g normalization are implemented; stored evidence is pending.
- Expand weight tracking beyond the current Profile logging/history/trend flow.
- Expand hydration beyond the implemented optional one-total-per-day Today module and one local opt-in daily reminder into intentionally designed history and insights only after deciding whether those features add useful, non-medical value. Validate native reminder delivery before expanding it.
- Connect the implemented effective-date goal schedule and weight trends with careful comparative guidance where appropriate.
- The daily nutrient-detail route is implemented for saved calories, macros, fiber, sugar, sodium, configured targets, and meal contributions. Expand range/monthly insights beyond the current saved-snapshot calorie/protein/fiber summaries, including weight integration and comparison periods.

Dependencies:

- Production or stable local auth.
- Food provenance flow.

Definition of done:

- Recent and favorite foods work across app restarts, with dedicated favorites/recent controls. Basic search/filter/sort and visible bulk-clear management is implemented; richer organization is pending.
- Users can create, log, edit, and reuse custom foods from mobile. Done for user-entered per-100g custom foods.
- Users can enter, edit, view, and delete weight history. Done for basic Profile logging/history, editing, deletion, a unit-aware trend graph, and selected-goal-direction feedback; richer persisted goal-integrated insights are pending.
- Users can record, adjust, and clear an optional daily hydration total. Done for Today, export, and account deletion. A single daily local reminder is also implemented, with permission requested only on enable, an editable time, and cancellation; physical-device validation is pending. History, trends, insights, and offline support remain pending.
- The progress screen can load backend range and monthly insights. Done for 7-day, 30-day, 90-day, and valid custom windows up to 366 days, with calorie/protein/fiber summaries, historical effective-date calorie targets, and a monthly rhythm card; weight integration and richer comparisons are pending.
- Users can save a source-backed meal as a reusable recipe and log it later without re-querying providers. Done for save, library, edit, log-to-today, delete, export, and account deletion; richer recipe organization remains pending.

## Phase 6: Provider caching and resilience

Status: Partially implemented

Goal: Avoid calling external providers on every lookup and handle provider failures gracefully.

Why it matters: External APIs add latency, cost, rate limits, and outage risk.

Major tasks:

- Expand normalized food-record caching. Implemented for successful barcode, search, and detail lookups.
- Expand barcode lookup cache beyond the current user-created and cached Open Food Facts barcode records. Basic barcode cache is implemented.
- Add search cache with expiration. Implemented as a short-lived query-to-source-record index. Stale Food Detail and exact barcode records use a database-backed refresh lease with jittered backoff, and a separate bounded worker refreshes eligible stale provider records without prefetching arbitrary queries.
- Add duplicate-record detection. Basic search-time conflict flagging plus durable same-name cross-provider conflict evidence, timestamps, and current-versus-historical Food Detail presentation are implemented; a deterministic record-quality assessment now distinguishes complete, review-needed, insufficient-data, and user-entered records. Provider-specific quality tiers and richer duplicate ranking remain pending.
- Add provider-failure fallback behavior. Implemented for cached search matches and for configured provider fallbacks after transient provider HTTP failures; a total live-provider outage now returns a safe `503` instead of an unexpected server error.
- Add bounded timeout and retry behavior. Implemented for USDA and Open Food Facts transport failures, rate limits, and transient server responses.
- Add provider quality validation. USDA and Open Food Facts core per-100g completeness checks, serving conflict/unverified-basis, negative nutrient, stale cached source, bounded stale detail/barcode refresh, duplicate nutrition-conflict tests, and a shared mobile/API quality assessment with hard blocking only for incomplete or invalid essential per-100g data are implemented.
- Add tests for cache and fallback behavior. Basic barcode/detail/search cache tests and provider timeout/retry policy tests are implemented.
- Add cache and provider observability. Implemented as bounded protected metrics for provider operation outcomes/latency and cache hit, refresh, and fallback events; dashboard and alert operation remain pending.
- Add distributed circuit-breaker policy. Implemented with static provider keys, transient-failure threshold, open/half-open recovery, Redis-required production state, fallback sequencing, readiness reporting, and focused tests; deployed outage validation and dashboard/alert operation remain pending.

Dependencies:

- Provider normalization strategy.
- Database/cache design.

Definition of done:

- Repeated barcode/detail lookups avoid unnecessary provider calls; search lookups seed cached records and can recover from provider failure when cached matches exist.
- Provider outages use bounded retries, try configured fallback providers after transient HTTP failures, and produce clear user-facing recovery paths after every live option is exhausted.
- Cached records preserve provenance, retrieval timestamps, parsed serving basis when available, quality flags and a traceable completeness assessment, stale-source warnings for older cached provider records, database-backed request-safe and scheduled refresh with backoff, and durable duplicate-conflict evidence with current-versus-historical warnings. Dashboard/alert operation, deployed outage validation, query-cache prefetching, provider-specific quality tiers, and richer duplicate ranking remain pending.

## Phase 7: Privacy, export, account deletion, and retention

Status: Partially implemented, with a versioned current-user JSON export/native-share flow that requires recipient acknowledgement, typed Living Nutrition profile deletion, private temporary-analysis-input cleanup, explicit completed-meal-photo retention and deletion controls, owner-only recent security activity, a restricted Clerk-admin audit-review endpoint, and minimal sensitive-operation audit events implemented

Goal: Add user-data controls required for a trustworthy nutrition app.

Why it matters: Food photos, meal history, and weight history are sensitive.

Major tasks:

- Add data export. Implemented as a versioned current-user JSON endpoint plus dedicated Data Controls review/native sharing through a temporary cache file that is removed after the share flow. The user acknowledges recipient guidance before sharing; richer export delivery controls remain pending.
- Add account deletion. Basic Living Nutrition profile deletion with typed confirmation is implemented; it does not delete the managed Clerk identity, and production account lifecycle is pending.
- Add minimal audit events for local account/session and export/delete operations. Implemented.
- Add owner-only recent security-activity visibility. Implemented as a bounded safe-field list in Data Controls.
- Add image deletion and retention settings. Implemented: Data Controls records the preference, confirmation requires explicit photo retention, and the retention worker enforces owner-scoped deletion deadlines. Production object-storage validation remains pending.
- Add private object storage for meal images. Implemented as a private local-preview/S3-compatible abstraction; deployment configuration and validation remain pending.
- Finalize the approved audit-retention duration and validate immutable external delivery for sensitive operations. The retention worker performs bounded database cleanup only after delivery. A durable signed-webhook outbox is implemented and production configuration requires its HTTPS endpoint and HMAC secret; the deployment still must select and validate an append-only/WORM receiver. A restricted server-side review endpoint for configured Clerk subjects is implemented; broader administrator operations remain pending.
- Add clear privacy copy in mobile settings.

Dependencies:

- Production authentication.
- Object storage architecture.

Definition of done:

- Users can export and delete their data. A versioned JSON export/native-share flow with recipient acknowledgement, Living Nutrition profile deletion, private temporary-image cleanup, explicit retained-image access/deletion and retention enforcement, owner-only security activity, restricted Clerk-admin audit review, minimal audit events, and bounded database audit cleanup are implemented; managed-identity deletion coordination, deployed object-storage validation, an approved audit-retention schedule, and immutable delivery remain pending.
- Image retention behavior is explicit and enforceable.
- Sensitive account/export/delete operations create minimal internal audit events. Done for the current local API.
- An approved audit-retention schedule and immutable production delivery remain pending. The implemented audit-review endpoint and bounded database-retention worker are deliberately server-only, Clerk-allowlisted where applicable, and privacy-minimized.

## Phase 8: Mobile testing and end-to-end testing

Status: Partially implemented

Goal: Add automated coverage for critical mobile and cross-stack flows.

Why it matters: Barcode, camera, keyboard, and logging flows are easy to regress in phone testing.

Major tasks:

- Add mobile component test runner. Initial Jest/React Native Testing Library setup exists for food provenance and presentation/helper coverage.
- Test manual amount forms and keyboard dismissal.
- Test barcode no-match recovery. Component coverage and helper/cooldown coverage exist; a fixture-only Maestro smoke flow covers typed no-match recovery and a subsequent successful lookup. The Android workflow is manual-only while its hosted emulator remains unproven, so it does not block preview deployment. Manual Search now also has component/API/fixture coverage for a provider `503` and retryable recovery instead of an empty-results misrepresentation.
- Test meal confirmation cards.
- Add navigation tests.
- Choose and validate a stable Android device-test environment, record repeated successful hosted runs, then restore path-scoped Android fixture execution and make it a required branch-protection check if it remains stable.
- Extend device coverage from the current manual log, barcode recovery/log, camera confirmation, Meal Builder, custom-food logging, meal edit/delete, fixture queue-replay, and local-profile-deletion flows to true offline/reconnect, Clerk authentication/recovery/deletion, and custom-food editing.
- Keep the existing CI release gates green: high-severity Node audit, Python third-party audit, PostgreSQL migration application, API container build/scan, CodeQL, mobile typecheck, Jest, Ruff, and backend tests.

Dependencies:

- Stable active flows.
- Test framework selection.

Definition of done:

- Critical mobile flows have automated tests.
- CI runs mobile tests.
- E2E tests use production-contract fixture providers and a fixture-only camera input; production configuration rejects the fixture mode.

## Phase 9: Production deployment and observability

Status: Planned

Goal: Prepare API and mobile builds for production operation.

Why it matters: A nutrition app needs reliability, monitoring, and safe release practices.

Major tasks:

- Configure deployment environments.
- Use [[deployment/release-runbook|the release and beta runbook]] to select managed providers, record environment ownership, validate migrations/workers, and capture physical-device release evidence.
- Validate the no-cost Render personal preview from [[deployment/render-free-preview-setup|its operator guide]] against a Clerk development tenant and physical device. Treat sleeping services, temporary data, and disabled AI/image-retention flows as acceptance constraints, not production readiness.
- Apply the selected paid Render + Cloudflare R2 path from [[deployment/render-r2-setup|the concrete operator guide]] only after managed accounts, trusted ingress ranges, secrets, and an explicit budget decision are available.
- Provision the implemented privacy-minimized Sentry reporting hooks with separate managed API/mobile DSNs, an alert policy, and a release-symbol/source-map upload path.
- Maintain the implemented CI container, migration, dependency-audit, and CodeQL gates; preview and production deployments still require real cloud validation.
- Maintain the repository-hygiene CI guard that rejects tracked Python cache artifacts and the pull-request documentation checklist.
- Operate the implemented protected Prometheus-compatible API metrics through a production collector, dashboards, alerts, and uptime checks; validate Sentry events contain only approved correlation metadata.
- Maintain the configured EAS development, preview, and production profiles. Development-client dependency and physical-device profile are configured; account linkage, signing, and first cloud-build validation remain pending.
- Validate Redis-backed shared rate limiting in production, including trusted-proxy policy and operational monitoring. The implementation now uses an atomic shared Redis window when production configuration selects it.
- Run the fixture-safe k6 baseline, idempotent-mutation, malformed-image, provider-outage, Redis-outage, and multi-replica performance checks against a disposable preview environment; the repository harness and initial budgets are implemented, but execution evidence is pending.

Dependencies:

- Production auth.
- Secret management.
- Deployment target selection.

Definition of done:

- Preview and production environments are documented and reproducible.
- Critical errors are observable with request-ID correlation and without user, request-body, or device context.
- App-store build path is validated.
