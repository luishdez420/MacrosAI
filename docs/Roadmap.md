# Roadmap

Last updated: 2026-07-09

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
- Add correction-report actions. Implemented for basic food-source reports and current-user report history.
- Add provider-cache/version history. Pending.

Dependencies:

- Existing `GET /api/v1/foods/{id}` endpoint.
- Shared types for food detail.

Definition of done:

- A user can inspect source and confidence before logging or editing a meal item. Done.
- Provenance display matches stored meal snapshots. Done for saved-meal fallback.
- No AI-only nutrient value is presented as authoritative. Done for this flow.
- Users can report incorrect records or request correction. Done for basic source-level reports and current-user report history; admin review/status management is pending.

## Phase 3: Stronger camera confirmation and correction workflow

Status: In progress

Goal: Convert camera analysis from a partial grams-adjustment flow into a complete confirmation-first workflow.

Why it matters: Camera analysis is useful but uncertain. The app must not imply exact identity, weight, hidden ingredients, or preparation method from a single photo.

Major tasks:

- Show model-returned candidate foods. Implemented as candidate-label search suggestions.
- Add in-card food search replacement per detected item. Implemented.
- Ask cooking method and preparation questions. Implemented with preparation selection and structured skin/bone hidden-ingredient review chips.
- Add oil, sauce, dressing, cheese, sugar, and condiment fields. Implemented at a basic level with added oil/butter grams, structured hidden-ingredient chips, provider-backed add-ons with grams, and freeform sauce/topping notes; richer add-on management UX is pending.
- Support remove, duplicate, split, and mark incorrect. Implemented.
- Show source and confidence explanation for each item. Implemented.
- Prevent saving until required confirmation fields are reviewed. Implemented for identity, preparation, and grams.

Dependencies:

- Food detail/provenance flow.
- Provider-backed food search.
- Meal update/create snapshot behavior.

Definition of done:

- Camera-generated meals require explicit review before persistence. Partially done for identity, candidate-label search suggestions, provider replacement, preparation, and grams.
- Portion, identity, and nutrition-record confidence are visible.
- Saved camera meals preserve corrections and provenance.

## Phase 4: Production authentication

Status: Partially implemented

Goal: Replace development local tokens with production-grade authentication.

Why it matters: Nutrition history, photos, and weight data are sensitive personal data.

Major tasks:

- Keep local password hashing and invalid-token rejection covered by tests. Implemented.
- Add signed JWT access-token verification. Implemented for local accounts.
- Add rotated opaque refresh-token lifecycle and logout revocation. Implemented for local accounts.
- Protect user-owned resources consistently.
- Add basic local session list/revocation controls. Implemented.
- Add auth tests for authorization boundaries.
- Add configurable process-local limits for credential and paid image-analysis endpoints. Implemented.

Dependencies:

- Auth provider decision.
- Secret management.
- Production environment configuration.

Definition of done:

- Production configuration rejects weak JWT secrets and enables neither dev nor legacy token compatibility. Implemented.
- User data is protected by verified local JWT sessions when authenticated.
- Session rotation, revocation, and refresh behavior are tested.
- OAuth/managed auth, recovery, session naming/device metadata, richer device/session management, distributed multi-replica rate limiting, and production operations remain pending.

## Phase 5: Favorites, recent foods, custom foods, and weight tracking

Status: Planned, with basic saved-food management, custom-food create/edit/reuse/barcode fallback, assistive nutrition-label extraction and confirmation, basic weight tracking, and weekly/monthly calorie insights implemented

Goal: Complete the user-owned nutrition support workflows already represented in the schema.

Why it matters: Fast repeat logging and personal foods are core nutrition-tracker behavior.

Major tasks:

- Expand recent-food management beyond the current automatic persistence and Manual Search display.
- Expand favorite/recent food organization beyond the current Saved Foods search/filter/sort/bulk-clear management screen.
- Expand nutrition-label capture beyond the implemented assistive visual extraction and explicit review flow into consented stored evidence and richer verification. Extraction and safe per-100g normalization are implemented; stored evidence is pending.
- Expand weight tracking beyond the current Profile logging/history/trend flow.
- Connect goals and weight trends where appropriate.
- Expand weekly/monthly insights beyond the current calorie summaries.

Dependencies:

- Production or stable local auth.
- Food provenance flow.

Definition of done:

- Recent and favorite foods work across app restarts, with dedicated favorites/recent controls. Basic search/filter/sort and visible bulk-clear management is implemented; richer organization is pending.
- Users can create, log, edit, and reuse custom foods from mobile. Done for user-entered per-100g custom foods.
- Users can enter, edit, view, and delete weight history. Done for basic Profile logging/history, editing, deletion, a unit-aware trend graph, and selected-goal-direction feedback; richer persisted goal-integrated insights are pending.
- The progress screen can load backend weekly and monthly calorie insights. Done for the basic seven-day calorie graph and monthly rhythm card; richer trend insights are pending.

## Phase 6: Provider caching and resilience

Status: Partially implemented

Goal: Avoid calling external providers on every lookup and handle provider failures gracefully.

Why it matters: External APIs add latency, cost, rate limits, and outage risk.

Major tasks:

- Expand normalized food-record caching. Implemented for successful barcode, search, and detail lookups.
- Expand barcode lookup cache beyond the current user-created and cached Open Food Facts barcode records. Basic barcode cache is implemented.
- Add search cache with expiration.
- Add duplicate-record detection. Basic search-time duplicate nutrition-conflict flagging is implemented; persisted duplicate history is pending.
- Add provider-failure fallback behavior. Implemented for search when cached matches already exist.
- Add bounded timeout and retry behavior. Implemented for USDA and Open Food Facts transport failures, rate limits, and transient server responses.
- Add provider quality validation. Basic Open Food Facts serving conflict, negative nutrient, stale cached source, stale detail refresh, and duplicate nutrition-conflict tests are implemented.
- Add tests for cache and fallback behavior. Basic barcode/detail/search cache tests and provider timeout/retry policy tests are implemented.

Dependencies:

- Provider normalization strategy.
- Database/cache design.

Definition of done:

- Repeated barcode/detail lookups avoid unnecessary provider calls; search lookups seed cached records and can recover from provider failure when cached matches exist.
- Provider outages use bounded retries and produce clear user-facing recovery paths after retries are exhausted.
- Cached records preserve provenance, retrieval timestamps, parsed serving basis when available, quality flags for provider inconsistencies, stale-source warnings for older cached provider records, safe stale detail refresh, and search-time duplicate-conflict warnings.

## Phase 7: Privacy, export, account deletion, and retention

Status: Partially implemented, with basic current-user JSON export, local account deletion, Profile retention preference editing, and minimal sensitive-operation audit events implemented

Goal: Add user-data controls required for a trustworthy nutrition app.

Why it matters: Food photos, meal history, and weight history are sensitive.

Major tasks:

- Add data export. Implemented as a basic current-user JSON endpoint and Profile summary action.
- Add account deletion. Basic local account deletion is implemented; production account lifecycle is pending.
- Add minimal audit events for local account/session and export/delete operations. Implemented.
- Add image deletion and retention settings. Preference editing is implemented; enforcement is pending.
- Add private object storage for meal images.
- Add audit-log review, retention, and immutable external delivery for sensitive operations.
- Add clear privacy copy in mobile settings.

Dependencies:

- Production authentication.
- Object storage architecture.

Definition of done:

- Users can export and delete their data. Basic JSON export, local account deletion, and minimal audit events are implemented; production lifecycle, image deletion, retention enforcement, audit-log review, and immutable delivery remain pending.
- Image retention behavior is explicit and enforceable.
- Sensitive account/export/delete operations create minimal internal audit events. Done for the current local API.
- Audit-log review, retention, and immutable production delivery remain pending.

## Phase 8: Mobile testing and end-to-end testing

Status: Planned

Goal: Add automated coverage for critical mobile and cross-stack flows.

Why it matters: Barcode, camera, keyboard, and logging flows are easy to regress in phone testing.

Major tasks:

- Add mobile component test runner. Initial Jest/React Native Testing Library setup exists for food provenance and presentation/helper coverage.
- Test manual amount forms and keyboard dismissal.
- Test barcode no-match recovery. Component coverage and helper/cooldown coverage exist; E2E coverage is pending.
- Test meal confirmation cards.
- Add navigation tests.
- Add end-to-end tests for manual log, barcode log, camera confirmation, edit meal, and delete meal.

Dependencies:

- Stable active flows.
- Test framework selection.

Definition of done:

- Critical mobile flows have automated tests.
- CI runs mobile tests.
- E2E tests use fixtures or mocked providers.

## Phase 9: Production deployment and observability

Status: Planned

Goal: Prepare API and mobile builds for production operation.

Why it matters: A nutrition app needs reliability, monitoring, and safe release practices.

Major tasks:

- Configure deployment environments.
- Add Sentry-compatible error reporting.
- Add production logging and metrics.
- Add EAS development, preview, and production build validation.
- Add distributed rate limiting beyond the implemented process-local endpoint limiter.
- Add performance checks.

Dependencies:

- Production auth.
- Secret management.
- Deployment target selection.

Definition of done:

- Preview and production environments are documented and reproducible.
- Critical errors are observable.
- App-store build path is validated.
