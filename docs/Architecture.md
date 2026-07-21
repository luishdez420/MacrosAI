# Architecture

Last updated: 2026-07-21

This document describes the architecture that exists today and separates it from the planned production architecture. See also [[Current State]], [[Decisions]], [[Roadmap]], and [[Known Issues]].

## Current architecture

### Monorepo

The repository is organized as:

```text
apps/
  mobile/
  api/
packages/
  api-client/
  design-tokens/
  shared-types/
  validation/
infrastructure/
  docker/
docs/
```

The root `package.json` uses npm workspaces for the mobile app and shared TypeScript packages. The Python API is managed through `apps/api/pyproject.toml`.

### Mobile application

#### Implemented meal-image privacy lifecycle

Camera uploads are normalized and stored under private generated keys. Failed or cancelled analysis jobs delete their temporary inputs immediately. A successful job keeps them only through the configured review window so the user can explicitly choose whether to retain scans while saving the meal. Confirmation never retains by default: an explicit choice copies normalized bytes to a separate `MealImage` record, applies the current `image_retention_days` deadline, and removes the temporary job asset. `GET /api/v1/meals/{mealId}/images/{imageId}/access` checks meal ownership before producing a configured-storage URL that expires in at most 15 minutes; local preview storage intentionally cannot issue such a URL. `DELETE /api/v1/meals/{mealId}/images/{imageId}` performs user-initiated deletion without changing immutable meal nutrition snapshots. The retention worker keeps deletion attempts/error state for safe retries, and account deletion removes assets before deleting the account. This subsection supersedes older “future retention preference” wording in this document.

The mobile app lives in `apps/mobile`.

Current mobile stack:

- Expo SDK 54.
- React Native.
- TypeScript.
- Expo Router.
- TanStack Query for server state.
- Zustand for the camera-analysis draft store.
- Expo Camera for camera capture and barcode scanning.
- Expo Image Picker for importing meal photos.
- Expo Development Client for native development builds.
- Expo Blur for restrained navigation and content glass materials, with runtime opaque material fallbacks when the OS requests reduced transparency.
- SecureStore for the local auth token.
- ScrollView-based manual search and logging form with keyboard-dismiss-on-drag behavior and a sticky selected-food log action so save controls remain reachable above the floating navigation when the keyboard is hidden and above the keyboard while entering amounts.
- React Native SVG for macro-ring and progress-chart rendering.
- Shared design tokens for semantic light/dark material colors, macro/status colors, typography, elevation, spacing, radius, and motion presets. Expo is configured with `userInterfaceStyle: automatic`, and a mobile ThemeProvider resolves a persisted `system`/`light`/`dark` preference against the operating-system color scheme. It currently drives the root shell, shared material primitives, macro ring, floating navigation, Profile appearance control, Today dashboard, daily nutrient detail, Progress, Manual Search, Barcode, and the core Meal Confirmation review/replacement/add-on flow. Feature-local styles are being migrated incrementally.

Current routes:

- `/onboarding`: local first-run value, accuracy, selectable goal framing, optional reviewable daily-target setup, optional dietary-preference selection, logging-method choice, and permission-education flow. Completion is stored in SecureStore; selected framing, dietary preferences, and logging method synchronize best-effort through `/preferences`, while an explicitly accepted target synchronizes through `PUT /goals`. The target is never created when skipped and contains nutrition targets only, not raw measurements. A kitchen-scale preference defaults Manual Search to grams. Dietary preferences are non-filtering reference data and never verify ingredients, allergens, or medical suitability.
- `/`: home dashboard, today's logging actions, daily totals, and meal timeline grouped from persisted meal category with a compact local-time display.
- `/nutrients`: read-only daily nutrition detail using the existing diary and goal queries. It shows saved calories, macros, fiber, sugar, sodium, configured targets only where the user set them, and meal contributions linked to saved-meal detail. It does not infer medical targets or make a second nutrition calculation.
- `/calendar`: selectable 7-day, 30-day, 90-day, or valid custom-window (up to 366 days) calorie/protein progress graph against the current saved goal, accessible day detail, and month-by-month rhythm navigation. Range summaries use persisted meal-item snapshots and include average calories, protein, and fiber on logged days.
- `/camera`: meal photo capture and import.
- `/confirm-meal`: camera-analysis confirmation and logging.
- `/label-scan`: assistive nutrition-label extraction with manual-entry fallback before custom-food review.
- `/manual-search`: food search, favorites, recent foods, and manual logging.
- `/natural-entry`: conservative multi-food text entry that accepts only explicit grams or ounces, then requires selection of provider-backed records.
- `/saved-foods`: favorite/recent food management.
- `/custom-food`: user-created food entry, editing, saving, immediate meal logging, and explicit manual review confirmation when entered values come from a captured nutrition-label photo.
- `/barcode`: packaged-food barcode logging.
- `/food/[id]`: food detail, source provenance, serving basis, quality warnings, and per-100g nutrition.
- `/meal/[id]`: meal detail, portion editing, and deletion.
- `/meal-builder`: source-backed multi-food meal composition with gram entry, breakfast/lunch/dinner/snack/general-meal category selection, remove/duplicate and accessible move controls. Item order and category are persisted when saved through `POST /api/v1/meals` or as a reusable template through `POST /api/v1/recipes`.
- `/recipes`: saved-recipe library with source-backed snapshot totals, category, edit-through-Meal-Builder, log-to-today, and deletion. Logging creates a new meal with the recipe's saved category.
- `/profile`: local sign-in, nutrition goal setup, US/metric preferences, editable onboarding goal/logging/dietary preferences, persisted system/light/dark appearance preference, weight logging/editing/deletion, weight trend, and selected-goal-direction feedback.
- `/data-controls`: dedicated privacy control surface for a current-user JSON export summary and native share flow, a completed-meal-photo retention duration, owner-only recent security activity, and typed Living Nutrition profile-deletion confirmation. The mobile client writes the export only to its cache directory for the system share operation and removes it afterward. Camera confirmation never retains a photo automatically: a user must explicitly choose to keep its private scans, then the saved retention duration becomes an enforceable deletion deadline. Deleting the internal profile does not delete a Clerk identity.
- `GET /api/v1/export`: current-user JSON export for profile, preferences, goals, weight entries, hydration entries, meals, recipes, favorites, recents, and custom foods.
- `GET /api/v1/auth/activity`: owner-only recent security-activity labels, outcomes, and timestamps for the current local account. The route deliberately excludes request IDs, client fingerprints, credentials, tokens, food data, and free-form event metadata.

The floating bottom navigation is configured as Today, Progress, Scan, Library, and Profile. Scan is visually elevated in the center and is intentionally tap-only. The four browse destinations support deliberate horizontal page switching only on their exact top-level routes, preserving vertical scrolling and feature-level gestures on forms and saved-meal controls. Today remains active for manual search, natural entry, barcode, custom food, meal detail, and daily nutrient detail; Library owns saved-food and food-provenance routes. Progress is a range-based saved-snapshot insight route rather than a calendar-style logging tab.

### Shared packages

- `packages/api-client`: typed API client used by the mobile app.
- `packages/design-tokens`: color, spacing, radius, and typography tokens.
- `packages/shared-types`: TypeScript schemas and shared API types.
- `packages/validation`: shared nutrition math helpers for per-100g calculations.

### Backend application

The backend lives in `apps/api` and uses FastAPI.

Current backend stack:

- FastAPI.
- Pydantic schemas.
- SQLAlchemy models.
- Alembic migrations.
- PostgreSQL-oriented production schema.
- Local SQLite support for phone preview and tests. The phone-preview bootstrap creates missing tables and includes explicit additive repairs for legacy `users.password_hash`, `auth_sessions.device_label`, `user_preferences.goal_direction`, `user_preferences.onboarding_goal`, `user_preferences.logging_preference`, `user_preferences.dietary_preferences`, `user_preferences.theme_preference`, meal/recipe item-order, and meal/recipe category columns that older `create_all` preview databases lack; it preserves existing local data. PostgreSQL remains the Alembic-migrated production-oriented path. The historical Alembic chain uses PostgreSQL-specific `JSONB` in its initial revision, so `alembic upgrade` is not a supported SQLite-preview command; use the bootstrap path instead.
- Structured logging with `structlog`.
- Request ID middleware.
- Consistent error envelopes.
- Configurable rolling-window rate limiting for authentication and paid image-analysis endpoints. Development uses an in-memory rolling window; production requires an atomic Redis sorted-set implementation shared across API replicas. Redis keys hash the safely resolved client key instead of storing its raw address, and protected routes fail closed with a request-correlated `503` if the shared limiter cannot decide.
- `GET /api/v1/health/ready` checks database/schema readiness and the configured shared Redis limiter after startup. It returns only dependency category/health and a request ID on `503`; it does not expose connection values or Redis errors.
- Rate-limit denials and shared-backend outages emit structured, request-correlated events without logging the resolved client address or limiter key. The platform-neutral [[deployment/edge-security-runbook|edge-security runbook]] documents required proxy, readiness, alert, incident, and release-validation steps; deployment-specific ownership and dashboard configuration remain pending.
- Product-owned AI entitlement and usage tables. Before camera-job creation or synchronous label vision begins, the API locks the current user's entitlement decision, reserves an operation/image allowance, records a minimal quota audit event, and commits. A completed job or label result settles the same record; a provider/system failure refunds it; expired reservations are reconciled during the next decision. Usage records retain user ID, operation, tier, units, status/timestamps, reason code, and a one-way idempotency-key hash only. They do not retain images, prompts, provider responses, or nutrition content. This is a pre-billing safety boundary, not a payment or subscription system.
- Analysis jobs are a durable owner-scoped state machine: queued/processing jobs have bounded worker leases, expired leases can be reclaimed, cancellation wins over a late result, and only a `needs_review` structured result can be completed. Camera creates a job from normalized private inputs, the worker executes it, mobile polls safe owner-scoped status and can resume one pending review from SecureStore after restart, and the retention worker expires abandoned jobs. Completed results remain review-only and cannot create a meal without the existing explicit confirmation step. Multi-job history and richer retry controls remain pending.

Production also requires `TRUSTED_PROXY_CIDRS`, an explicit allowlist for direct proxy peers. Only a trusted direct peer can supply `X-Forwarded-For`; the client resolver walks that trusted chain right-to-left and falls back to the direct peer for untrusted, missing, malformed, or wholly trusted chains. The policy intentionally ignores the RFC `Forwarded` header to keep the deployment contract narrow and testable.

The API is mounted under `/api/v1`.

### Database usage

The schema includes models for:

- Users and user preferences.
- Nutrition goals.
- Weight entries.
- Hydration entries.
- Food source records.
- Food source revisions for meaningful external provider-record changes.
- Food servings.
- Nutrient definitions.
- Food nutrients.
- Custom foods.
- Meals.
- Meal items.
- Meal images.
- Recipes and recipe items.
- Favorite foods.
- Recent foods.
- Analysis jobs and analysis job items.
- Data correction reports.
- Audit logs for sensitive account operations.
- AI entitlements and AI usage records for pre-billing quota decisions.

Not every modeled entity has a complete API and mobile workflow yet. Data correction reports have mobile source submission, current-user safe history, and a server-only Clerk-admin triage/resolution API; a dedicated staff UI, notification delivery, and moderation policy remain pending. Meal images support private temporary camera-job inputs plus opt-in confirmed-meal retention, deletion metadata, owner-only expiring access, and user-initiated deletion; configured cloud storage validation and a mobile image viewer remain pending. Weight entries have basic API and Profile logging/history support; the user's maintain/cut/gain direction is persisted in user preferences, but richer goal-integrated insights are pending. Hydration entries are a separate, optional per-user/per-day total exposed on Today through `GET`, `PUT`, and `DELETE /api/v1/hydration/{date}`; the implementation deliberately has no default daily target, history, or insight model. Favorite foods can be added/removed from food provenance, displayed in Manual Search, and removed from Saved Foods. Recent foods are persisted automatically from logged meal items, displayed in Manual Search, and removable from Saved Foods. Richer organization controls are still pending.

### Nutrition providers

The backend has a provider abstraction in `apps/api/app/nutrition/provider.py`.

Current providers:

- USDA FoodData Central for food search, food lookup, and generic/branded nutrition records.
- Open Food Facts for barcode-based packaged-food lookup.
- User-created barcode custom products are checked before external barcode providers for the current user.
- Successful Open Food Facts barcode lookups are stored as normalized source records and reused before calling external barcode providers again.
- Open Food Facts normalization parses a gram serving basis when available and flags serving-vs-per-100g conflicts, an unverified serving basis, negative raw nutrient values, incomplete or non-numeric core per-100g data, energy/macros mismatches, and possible kJ/kcal confusion.
- Every current `FoodSearchResult` and `FoodDetail` derives a deterministic `qualityAssessment` from normalized flags rather than treating a provider name as a quality score. It reports `complete`, `needs_review`, `insufficient_data`, or `user_entered`, along with concrete provider/user, stale, conflict, incomplete, serving-basis, and validation signals. Essential per-100g data failures are `isBlocking`; Manual Search, Barcode, and Camera Confirmation do not save those records. This classification is a transparent data-completeness aid, not medical accuracy or a guarantee.
- Stored non-user provider records older than 180 days are marked with a `stale_source_record` quality flag when returned through food search/detail helpers. Food detail and exact barcode lookup claim a database-backed refresh lease for stale records; another replica returns the flagged snapshot while that lease is active. Provider failure or no match records a deterministic-jittered exponential backoff in the source record, and a successful refresh clears it. The separate `app.workers.food_source_refresh` process periodically selects a bounded oldest-first batch of eligible stale non-user records and calls the same refresh path. It never refreshes user-created foods, arbitrary query-cache entries, or meal snapshots; a provider failure leaves the stale snapshot visible and backs off the next attempt.
- Food search flags same-named non-user records with `duplicate_nutrition_conflict` when their per-100g calories or macros differ substantially. The normalized source-record pair, conflict type, provider-data evidence, and first/last detection timestamps are retained in `food_source_conflicts`. Food Detail returns the bounded related history and recomputes whether the disagreement is still current against the latest cached source values; historical conflict evidence remains visible without leaving a current warning after the records align. This provenance state never changes immutable meal snapshots.
- Successful provider search and detail lookups are stored as normalized source records. For non-user providers, the initial normalized record and each later meaningful source-data change create a `FoodSourceRevision`; unchanged retrievals refresh freshness without adding noise. Authenticated `GET /foods/{id}` returns the latest five revisions as source provenance only, while meal-item snapshots remain immutable. Global provider records are shared; `provider=user` custom records require the owning account and are excluded from the public search/cache path. Food detail requests check accessible stored records before external providers. Provider searches also write a short-lived query-to-source-record index, so a complete fresh result set, including a cached no-result response, can be returned without re-calling the provider. The index stores source-record IDs only, expires after `FOOD_SEARCH_CACHE_TTL_SECONDS` (900 seconds by default), and is bypassed if a referenced provider record is stale or missing. Exact fresh food-name search matches and cached provider-failure fallback remain available.
- USDA and Open Food Facts share a configurable HTTP policy that applies request timeouts and bounded exponential retries for transport failures, `408`, `429`, and selected `5xx` responses. Permanent client errors such as `404` are not retried, and `Retry-After` delays are capped. A circuit breaker records only transient failures per static provider name, opens after `NUTRITION_PROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD`, blocks repeat calls during its recovery window, and permits one leased half-open probe before closing on success or reopening on another transient failure. Preview uses in-memory state; production requires the Redis-backed breaker so all replicas share outage state. The registry continues to the next provider after a provider HTTP failure or an open circuit. If no live provider completes a lookup and no route-level cached fallback is available, `NutritionProviderUnavailableError` is converted to a safe `503` error envelope with a request ID.

Provider request behavior can be tuned with `NUTRITION_PROVIDER_TIMEOUT_SECONDS`, `NUTRITION_PROVIDER_MAX_ATTEMPTS`, `NUTRITION_PROVIDER_RETRY_BACKOFF_SECONDS`, and `NUTRITION_PROVIDER_MAX_RETRY_DELAY_SECONDS`. Circuit behavior is controlled with the `NUTRITION_PROVIDER_CIRCUIT_BREAKER_*` settings. Query-cache freshness is controlled with `FOOD_SEARCH_CACHE_TTL_SECONDS`; stale-record lease/backoff is controlled with `FOOD_SOURCE_REFRESH_LEASE_SECONDS`, `FOOD_SOURCE_REFRESH_RETRY_BASE_SECONDS`, `FOOD_SOURCE_REFRESH_RETRY_MAX_SECONDS`, and `FOOD_SOURCE_REFRESH_RETRY_JITTER_RATIO`; scheduled stale-record work is bounded by `FOOD_SOURCE_REFRESH_WORKER_POLL_SECONDS` and `FOOD_SOURCE_REFRESH_WORKER_BATCH_SIZE`.

The app calculates consumed nutrition using:

```text
nutrientAmount = nutrientPer100g * consumedGrams / 100
```

### Nutrition-label analysis flow

Current label flow:

1. Mobile captures or imports a nutrition facts image with base64 available only for the analysis request.
2. The backend bounds encoded request fields before decoding, validates base64 and supported JPEG/PNG/WebP/GIF signatures, rejects malformed or animated images, enforces a 12 MB decoded-size and 36-megapixel limit before pixel loading, then orientation-normalizes and re-encodes a still image as JPEG without EXIF/container metadata before `POST /api/v1/foods/label-analysis` sends it to the configured OpenAI vision model using a strict structured-output schema. Every validation error contains only field location/type/message metadata and omits the rejected image input.
3. The analyzer extracts only visibly printed values and returns `null` for unreadable fields.
4. Per-serving values are normalized to per 100g only when a positive serving gram weight is visible. Volume servings without a verified mass are not converted.
5. Mobile keeps the photo and extraction in a temporary Zustand draft, shows raw label values separately from normalized values, and pre-fills the editable custom-food form only when per-100g normalization is valid.
6. The user must compare and confirm the values before a user-created food can be persisted.

The application does not currently persist the label image or extraction as evidence. The final record is marked as user-created rather than authoritative provider data.

### Authentication approach

Current production authentication is Clerk-managed. The previous local-password JWT/refresh-session model remains behind explicit development compatibility modes and supports only the bounded legacy-account migration path.

Implemented:

- Clerk is the selected managed identity provider for mobile sign-up, sign-in, email verification, recovery, Google OAuth, and session storage. `@clerk/clerk-expo` uses its SecureStore token cache; only the publishable key is bundled into mobile.
- FastAPI receives Clerk bearer tokens, verifies their signature against `CLERK_JWKS_URL`, validates `CLERK_ISSUER` and an optional audience, then maps the verified Clerk `sub` to an internal `users` record. Nutrition data remains in this application's database rather than Clerk.
- `POST /api/v1/auth/provision` creates an internal profile for a signed-in Clerk identity after the user explicitly chooses a new profile. `POST /api/v1/auth/migrate-local-account` verifies a legacy local password, links the authenticated Clerk subject, clears the old password hash, and revokes local refresh sessions. It is disabled by default and bounded by `LOCAL_ACCOUNT_MIGRATION_DEADLINE` when enabled.
- The previous local `register`, `login`, `refresh`, `logout`, and password endpoints are retained only for local development compatibility. They return `410` when Clerk identity mode is enabled.
- `GET /api/v1/auth/session`
- `GET /api/v1/preferences`
- `PUT /api/v1/preferences`
- SecureStore persistence for access and refresh tokens on mobile.
- Local password hashing for register/login using a backend PBKDF2-SHA256 password hash column.
- Signed HS256 JWT access tokens with issuer, audience, expiry, user ID, and session ID claims.
- Hashed opaque refresh tokens stored in `auth_sessions`; refresh rotates the session and logout revokes it. Revocation also invalidates access tokens immediately through the session check.
- A signed-in local account can change its password only after current-password verification. The backend rejects password reuse, revokes every existing refresh session, then creates one fresh replacement session for the requesting device.
- Mobile retries a failed protected request once after refresh, then clears invalid local credentials.
- New and rotated refresh sessions retain an optional generic app label, such as `Living Nutrition on iOS`. The mobile API client sends this app-owned label through `X-Living-Nutrition-Client`; the backend normalizes and accepts only its fixed iOS, Android, and web labels, never a raw user agent, IP address, or device identifier.
- `GET /api/v1/auth/sessions` returns active refresh sessions and their generic label for the current local user. `DELETE /api/v1/auth/sessions/{sessionId}` revokes another active session; the current session uses the existing logout flow so mobile clears its stored credentials.
- Invalid bearer tokens, malformed legacy tokens, revoked sessions, and missing users return `401`.
- `ALLOW_DEV_AUTH` and `ALLOW_LEGACY_LOCAL_TOKENS` preserve phone-preview compatibility only outside production. Production config requires Clerk identity mode and Clerk JWKS/issuer settings, validates a 32+ character `JWT_SECRET`, requires both compatibility flags to be false, and requires Redis-backed rate limiting.

Production configuration also requires the trusted-proxy allowlist described above; otherwise the API will not start with Redis request limits enabled. Proxy-platform CIDRs, multi-replica validation, dashboards, and incident runbooks remain deployment work.

User preferences currently persist locale, unit system, day-start time, timezone, goal direction, onboarding goal framing, preferred logging method, optional dietary preferences, image-retention days, and a `system`/`light`/`dark` theme preference. Dietary preferences are stored as non-filtering reference data: they do not verify ingredients/allergens or medical suitability. The mobile Profile screen uses the unit-system preference so users can keep US or metric height/weight inputs across sessions, converts current height/weight entries when the user switches units, lets users revise their local-first onboarding choices, and immediately applies a saved appearance setting through the ThemeProvider. Data Controls describes the actual lifecycle: temporary normalized analysis inputs are private and expire after the review window; a meal confirmation can explicitly copy them into a retained meal image with the selected user retention deadline, otherwise confirmation deletes them.

Offline logging uses a device-local Expo SQLite queue. An authenticated user's fully confirmed Manual Search, Barcode, Natural Entry, Meal Builder, Camera Confirmation, or already-saved Custom Food meal is persisted after an ambiguous network or server failure; the source-backed nutrition snapshot and original idempotency key are retained. Camera queue entries contain only the reviewed meal snapshot, never the captured images or a new analysis request. Custom Food enters the queue only after its source record has saved successfully; an uncreated food record is never queued. Today exposes explicit sync rather than showing the meal in the diary prematurely. The queue is scoped by non-secret user ID and is cleared during local account deletion. Camera images, custom-food creation, meal edits, automatic/background sync, and conflict resolution are not yet queued.

Pending:

- Clerk tenant setup and EAS development/production build validation, including email templates and the `livingnutrition://` OAuth redirect.
- App-managed account-linking/unlinking UX beyond Clerk's own identity controls, richer session/device policy, trusted-proxy policy, production Redis deployment validation, and production account lifecycle beyond the current local JSON export and account deletion flows.

### Meal and diary flow

Manual, barcode, and custom-food logging follow this flow:

1. Mobile searches or scans a food.
2. For barcode scans, the backend checks user-created barcode products, then cached Open Food Facts barcode source records, then external barcode providers.
3. Backend returns provider-backed per-100g nutrients and source metadata.
4. User can open `/food/[id]` to inspect provider provenance, serving basis, raw quality flags, the plain-language quality assessment, original nutrient IDs, bounded external source-history snapshots, and per-100g values.
5. User confirms grams, ounces, or source servings with a verified gram basis. Ounces are converted to grams before nutrient calculation while the selected unit is preserved in the meal snapshot. A household or volume serving without verified grams is not converted and remains unavailable for logging until the user enters a weight.
6. Mobile calculates a preview using per-100g nutrients.
7. Mobile posts a meal to `POST /api/v1/meals`. The API accepts an optional caller-owned `Idempotency-Key`; a user-scoped ledger compares a canonical request fingerprint and replays only an exact completed request. Reusing a key with changed content returns `409`, and meals retain a user/key uniqueness constraint as a second persistence boundary. The same ledger now protects paid camera/label analysis, custom-food creation, source-correction-report creation, recipe creation, and recipe logging. Correction-report replay stores only the created owned-resource link and rebuilds the reporter-safe response, avoiding duplicate ledger storage of free-form report text. Camera Confirmation, Manual Search, Barcode, Natural Entry, Custom Food, Meal Builder, and recipe-library actions derive screen-scoped keys from confirmed content for safe retries.
8. Meal Builder validates local `YYYY-MM-DD` and `HH:MM` values, sends them as `loggedAt`, and Meal Detail can correct the saved local date/time.
9. Backend persists meal category, logged time, meal items with nutrition snapshots, the food-quality assessment shown at logging time when available, confidence fields, and the optional idempotency key.
10. Home reads `GET /api/v1/diary/{date}` for totals and timeline data. The daily nutrient-detail route reuses that exact saved snapshot plus `GET /api/v1/goals`; it shows configured targets only and derives meal contribution rows from persisted meal-item nutrition snapshots.

Natural entry follows the same persistence flow after parsing. It accepts up to six foods separated by semicolons or new lines when each has an explicit gram or ounce weight. The mobile client searches provider records for every parsed food and blocks meal creation until the user selects a result for each item. It does not convert cups, pieces, or vague household measures into mass.

Meal editing currently replaces meal items through `PATCH /api/v1/meals/{mealId}`.
Saved meal items can open the same food detail route. If live source lookup fails, the mobile screen shows the nutrition provenance snapshot saved with the meal item. Meal Builder suggests breakfast, lunch, dinner, or snack from a valid local time until the user explicitly selects a category; the selected category is persisted. Meal Builder and Meal Detail support validated local date/time entry.

### Goal storage

The profile screen can save basic nutrition goals through:

- `GET /api/v1/goals`
- `PUT /api/v1/goals`

`PUT /api/v1/goals` saves a revision effective on `startsOn`; saving again for the same date updates that revision. `GET /api/v1/goals` returns the goal effective today. The home dashboard uses that current calorie goal when available and falls back to a static default otherwise.
The progress/calendar screen uses `GET /api/v1/insights/range` for 7-day, 30-day, 90-day, and valid custom windows up to 366 days. Each returned day includes the calorie target effective on that date, so the chart and goal-day status preserve historical goal changes while using saved meal-item snapshots for nutrition totals. `GET /api/v1/insights/monthly` renders a navigable month-by-month rhythm card with logged days, goal days, average calories, and daily status dots. The older weekly endpoint remains available for API compatibility. Weight integration and comparison periods are still planned.

### Camera-analysis flow

Current camera flow:

1. Mobile captures or imports one image, or optionally captures up to three complementary views (angled, top-down, and side).
2. Mobile stores a bounded local draft-image set in Zustand; the first image remains the review preview.
3. Meal confirmation creates authenticated `POST /api/v1/meal-analysis/jobs` with legacy `imageBase64` compatibility and `imagesBase64` for one to three views. It polls the safe owner-only job state and sends server-side cancellation when the user retakes a photo. Shared validation caps encoded input before decoding, rejects invalid, malformed, animated, oversized, or over-pixel-limit images, and applies the 18 MB aggregate encoded-size limit before per-image decoding, including worker/internal helper callers. It preserves only normalized JPEG bytes. The client sends a bounded screen-scoped `Idempotency-Key`; the backend accepts the legacy body key only for compatibility, rejects disagreement between the two, and uses keyed non-reversible image digests rather than serializing or persisting image bytes in the replay ledger. Before queueing, the API reserves the authenticated user's configured entitlement allowance and returns safe remaining-use headers; exact idempotency replays do not consume a second reservation. Nutrition-label capture applies the same keyed-digest, synchronous header-based replay pattern to `POST /foods/label-analysis` and retains a single local action key until the user retakes or imports a different label.
4. The bounded analysis worker claims a lease, reads only normalized private job images, uses OpenAI vision to identify visible foods, and searches nutrition providers for matched records.
5. The worker stores a review-only result and settles quota. Its normalized private inputs remain only through the review window so the user can explicitly retain them with a confirmed meal; confirmation, user discard/retake, failure, cancellation, and expiry remove them. The retention worker retries failed input cleanup and expires abandoned jobs.
6. Mobile receives provider-backed estimates, confidence notes, `imageCount`, and bounded per-view scan evidence. Alternatives can be ordered by the submitted views that visibly supported their labels; the UI calls this a review aid, never a verified identity. Multiple views never prove hidden ingredients, exact weight, or preparation, and conflicting views lower identity confidence.
7. Mobile lets the user confirm identity, preparation, add-ons, and grams before saving.
8. Mobile saves a meal through `POST /api/v1/meals`. Camera confirmation derives an idempotency key from the reviewed analysis payload, so an unchanged retry cannot duplicate a saved meal while a changed review becomes a new action.

Current limitation: the confirmation screen supports explicit food confirmation, model-returned candidate labels as search suggestions, up to three provider-backed alternatives ordered by sanitized per-view visible-label support for uncertain scans, conservative visible-portion ranges, visible-preparation cues, possible hidden-ingredient prompts, in-card provider search replacement, and source-backed sauce/topping multi-adds. The scan evidence is limited to `single_view`, `corroborated`, `conflicting`, or `unavailable`: it does not raise confidence, while a conflict lowers identity confidence and requires review. Add-ons default to a compact calorie and source-quality summary, then expand for search, favorite/recent reuse, source review, portion changes, removal, and accessible up/down ordering. Selecting an add-on leaves grams blank, so it cannot count toward the meal until the user enters an amount. Common dressing, cheese, avocado, and butter shortcuts prefill a provider search but do not add a food or infer its portion. Source review, inline source issue reporting, preparation selection, structured skin/bone/sauce/cheese/sugar review chips, added oil/butter grams, freeform sauce/topping notes, remove, duplicate, split, and mark-incorrect controls are also available. Alternative ordering is not a probability claim and selection is always explicit. Scan cues remain review-only and are preserved in the confirmed meal snapshot. Source-level correction reports can be submitted from food provenance, reviewed in Profile history, and resolved through a separate restricted staff API. Reusable add-on groups and batch-selection refinements remain pending.

### Error envelopes and request IDs

The API uses request ID middleware and wraps errors in this shape:

```json
{
  "error": {
    "message": "Meal not found.",
    "code": "http_error",
    "requestId": "generated-or-forwarded-request-id"
  }
}
```

Every response includes an `x-request-id` header.

The typed mobile API client converts non-successful responses into `ApiClientError` values that preserve HTTP status, API error code, and request ID. Feature-local presentation maps network, rate-limit, and server failures to non-technical recovery copy; a request ID is retained as an optional support reference rather than exposing raw provider or server details.

### Audit events

The API records minimal database-backed events for local account registration, login,
refresh, logout, password change, user-data export, and account deletion. Each event records event type,
outcome, request ID, creation time, an optional user link, and a one-way direct-client
fingerprint. Credentials, bearer tokens, refresh tokens, email addresses, meal contents,
image data, and free-form request bodies are not written to the audit table.

Account deletion anonymizes related audit records by clearing their user link while
retaining the operational event. While an account exists, `GET /api/v1/auth/activity`
can expose up to 25 safe event labels, outcomes, and timestamps to that account only.
Owner-scoped meal, recipe, durable-analysis-job, custom-food, and local-session lookups
use a shared non-enumerating `404` helper. It writes an
`authorization.owner_access_denied` event only with the requesting account link,
request ID, one-way client fingerprint, and `not_found_or_not_owned` outcome; it never
stores a requested resource ID, route parameter, request body, or ownership distinction.
`POST /api/v1/meals` performs the same owner-scoped validation when a client
references an `analysisJobId`, before idempotency or a new meal can be written;
the current route inventory and review checklist live in
[[architecture/authorization-boundaries|Authorization Boundaries]].
`GET /api/v1/admin/audit-events` provides a restricted, server-side review surface for verified Clerk subjects listed in the managed `ADMIN_CLERK_SUBJECTS` allowlist. It returns only event ID, event type, outcome, request ID, creation time, and a linked/anonymized account state. It intentionally excludes user IDs, Clerk subjects, emails, client fingerprints, credentials, tokens, food or image data, request bodies, and review filters; each successful review records its own minimal `admin.audit_review` event. This endpoint is not surfaced in the mobile app. Every internal audit event also creates one `audit_deliveries` outbox row. The retention worker leases due rows, sends a canonical HMAC-signed webhook envelope with only event ID/type, outcome, request ID, and time, then records delivered or retry-scheduled state without retaining receiver errors. Production requires an HTTPS receiver and a managed HMAC secret; audit retention considers only successfully delivered rows. The receiver must be deployment-selected and append-only/WORM-capable because the API cannot independently prove an external service's immutability. Audit-export delivery, an approved operational retention schedule, receiver validation, and immutable-storage evidence remain pending.

Correction reports use the same Clerk allowlist on server-only `/api/v1/admin/correction-reports` routes. The persisted lifecycle is one-way: `open` to `triaged`, then `resolved` or `dismissed`. Each transition retains a reporter-safe summary, optional staff-only note, optional revision link that must belong to the reported source record, and an internal actor link. Owner-facing history returns only status, safe summary, and timestamp; the staff API intentionally omits reporter identifiers. Reviews and transitions create minimal `admin.correction_report_review` or `admin.correction_report_status_change` audit events without report text or resource IDs. This workflow never mutates historical meal-item snapshots.

### Request limits

The API applies rolling-window limits to public `GET /foods/search`,
`POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`,
`/auth/password`, `/meal-analysis`, and `/foods/label-analysis`. Catalog search,
auth, and image-analysis routes have independent configurable limits. Catalog search
uses an IP-only `RATE_LIMIT_FOOD_SEARCH_*` policy because it is currently public;
paid analysis uses both an IP and verified-user policy. A blocked request returns
`429`, `retry-after`, `x-ratelimit-limit`,
`x-ratelimit-remaining`, and the standard error envelope with the request ID.
The backend keeps these method/path groups in a single `RATE_LIMIT_ROUTE_REGISTRY`
with policy builders, rather than spreading path checks across middleware; new
protected operations must be reviewed and added to that registry with their
endpoint-specific budget.

Phone preview uses the in-memory limiter. Production configuration requires the atomic
Redis sorted-set limiter, which shares limits across API processes and hashes limiter
keys before storage. Credential endpoints use an IP scope. Paid analysis operations use
both an IP scope and, once a credential has been verified, a separate user scope in one
all-or-nothing Redis Lua decision; a denied user scope does not consume another IP
scope. A Redis decision failure returns a request-correlated `503` for protected routes
rather than failing open. Reverse-proxy trust, production Redis monitoring, and
deployment validation remain planned.

### Metrics and request correlation

The API has dependency-free, Prometheus-compatible process metrics at `GET /metrics`.
They are disabled by default; production startup requires both `METRICS_ENABLED=true`
and a non-empty `METRICS_BEARER_TOKEN`. A missing or invalid bearer token receives the
same `404` response as a disabled endpoint. Operators should also keep the route on a
private scrape network.

The metrics have only bounded operational labels: HTTP method, normalized route template,
response status, rate-limit policy/outcome, dependency category, provider name, provider
operation/outcome, and cache operation/outcome. They include request counts, duration buckets,
rate-limit decisions, provider outcome/latency/circuit state, food-cache hit/refresh/fallback
events, and the most recent readiness health for the database, rate limiter, and shared provider
circuit. They never include raw URLs,
request IDs, user identifiers, client addresses, bearer tokens, food queries, barcodes, image
data, or exception messages. Metrics are process-local by design; a Prometheus-compatible
collector must scrape each replica and aggregate the result. The provider circuit breaker is
implemented. Dashboards, alerts, uptime checks, and production scrape infrastructure are not
configured yet.

Optional Sentry-compatible runtime reporting is implemented in the API and mobile client. The API
initializes only with `SENTRY_DSN` and production startup requires an HTTPS value. The mobile
client initializes only when an installed build supplies `EXPO_PUBLIC_SENTRY_DSN`. Unexpected API
failures retain only a request-ID correlation tag; request, user, device, breadcrumb, context, and
extra payload fields are removed before delivery. Tracing, profiling, replay, session tracking,
screenshots, and view hierarchies are disabled. A Sentry project, DSNs in managed deployment
configuration, alert routing, source-map/debug-symbol upload, and release artifact validation are
not yet provisioned.

`infrastructure/load/k6/` provides a fixture-safe k6 harness for repeatable baseline read traffic,
idempotent meal-write retries, malformed-image rejection, and deterministic provider-outage checks.
It requires a disposable local or preview environment and a test-only bearer token; it is not run by
normal CI and must never target production. The accompanying runbook defines initial p95/error-rate
guardrails and the deployment evidence required before they can be treated as capacity claims.

### Current deployment and infrastructure state

Implemented:

- Docker Compose for PostgreSQL and Redis dependencies.
- API Dockerfile.
- Alembic migrations.
- GitHub Actions CI for production Node dependency auditing, mobile typecheck and Jest tests, Python third-party dependency auditing, Alembic-head checks, Ruff, pytest through a supported HTTPX ASGI test harness, fresh PostgreSQL migration application, API Docker-image construction and high/critical vulnerability scanning. A path-scoped Android Maestro workflow builds a fixture-only development app, starts a local fixture API/analysis worker, verifies API and Metro readiness, and runs manual-log, barcode-recovery, deterministic provider-outage recovery, camera-confirmation, Meal Builder, custom-food, saved-meal edit/delete, SQLite queue-replay, and local-profile-deletion smoke flows on relevant pull requests and `main` changes; it can also be dispatched manually. `E2E_FIXTURE_MODE` is rejected by production backend configuration, while `EXPO_PUBLIC_E2E_FIXTURE_MODE` is set only during that dedicated build. The provider-outage query causes the fixture provider to raise a normal transport error, exercising the registry and correlated `503` error envelope without live network access. The queue fixture is compiled only in that test build and reuses the ordinary queue schema and API replay path; it does not simulate a transport outage. Local profile deletion verifies only Living Nutrition's API profile; managed Clerk identity deletion needs a dedicated Clerk test tenant. The workflow uploads API, worker, Metro, and Android diagnostics on failure. Its first successful hosted-emulator run must be recorded before branch protection marks it as required. A separate CodeQL workflow analyzes Python and TypeScript/JavaScript on pull requests, pushes to `main`, and a weekly schedule. Dependabot proposes weekly npm, pip, and GitHub Actions updates. Deployed release validation remains pending.
- Phone development script for Expo Go (`npm run dev:phone`) and installed development clients (`npm run dev:device`), each with local API preview and schema-aware startup.
- Independently runnable maintenance-worker commands: `npm run api:analysis-worker` for durable camera review processing and `npm run api:food-source-refresh-worker` for bounded stale provider-record refresh. Docker Compose starts both plus the image-retention worker; `dev:phone` starts only the analysis worker to avoid background provider calls during ordinary phone preview.
- EAS profiles for physical-device development, internal preview, and production builds. The application is not linked to an EAS project in source control; the owner must run `eas init` under the intended Expo account before the first cloud build.
- Platform-neutral [[deployment/release-runbook|release and beta]] and [[deployment/edge-security-runbook|edge-security]] runbooks. They define environment separation, managed configuration, migration/worker rollout, rollback, and physical-device evidence without pretending that a deployment platform, Expo account, signing, or monitoring service is already configured.
- A Render Blueprint at `render.yaml` for the selected Render API/PostgreSQL/Key Value topology and its three workers, plus [[deployment/render-r2-setup|a Cloudflare R2 setup guide]]. The Blueprint retains `sync: false` secrets and an explicit trusted-proxy value rather than hardcoding credentials or unsafe CIDRs. It has not been applied to a Render account yet.
- A repository-owned k6 load/abuse harness under `infrastructure/load/k6/`. It is intentionally opt-in because it creates disposable meals and needs a dedicated fixture environment. It has not yet produced multi-replica preview or production capacity evidence.

Not currently operational as production services:

- S3-compatible production object storage for meal images. The API supports a configured S3-compatible backend with server-side encryption, private generated keys, and read URLs presigned for at most 15 minutes. The local private-filesystem backend remains preview/test only and exposes no URL method. `meal_images` and `analysis_job_images` retain a retention deadline, deletion timestamp, bounded error code, and retry count; the lifecycle service can expire due records from both tables and account deletion refuses to remove the account if any private object cleanup fails. Failed/cancelled analysis inputs are deleted immediately. A successful review keeps normalized inputs only until confirmation or expiry; confirmation copies them into `meal_images` only when the user opts in, and the saved-meal UI can delete a retained photo. `GET /meals/{mealId}/images/{imageId}/access` validates ownership before requesting a storage URL. Docker Compose starts `app.workers.image_retention`, `app.workers.meal_analysis`, and `app.workers.food_source_refresh`, separate bounded workers, after applying Alembic migrations. The mobile app keeps a single account-scoped pending-job pointer in SecureStore so it can resume a review after restart without retaining image bytes. Cloud-worker deployment validation and a complete job history remain pending.
- Production OAuth/JWT lifecycle.
- Validate Redis-backed shared API limiting in the production deployment, including trusted-proxy policy and operational monitoring.
- Administrative audit export, approved retention policy, and immutable/external audit-log delivery beyond the current owner-only activity list and bounded database-retention worker.
- Prometheus-compatible metrics collection, dashboard/alert provisioning, uptime checks, and Sentry project/DSN, source-map, and release-artifact provisioning beyond the protected process-local metrics endpoint and privacy-minimized runtime reporting hooks.
- Production account deletion infrastructure beyond the current local-account deletion endpoint.
- Production-grade export delivery beyond the current JSON endpoint.

## Planned production architecture

Planned production architecture adds:

- Production authentication with secure token lifecycle or managed OAuth.
- Trusted-proxy deployment validation, Redis operational monitoring, audit-retention policy approval, and immutable external delivery.
- Query-cache prefetching, provider-specific quality tiers and duplicate-ranking policy, dashboard/alert operation, and deployed outage validation beyond the current bounded retries, cross-provider HTTP fallback, cached-search fallback, database-backed request-safe and scheduled stale-record refresh, bounded query-cache expiry, deterministic record-quality assessment, and persisted duplicate-conflict evidence.
- Object storage with private buckets and signed URLs for meal images.
- Image retention enforcement and deletion controls beyond the current stored preference.
- Richer export delivery controls and production account lifecycle flows beyond the current acknowledged temporary-cache native share operation and local-account deletion endpoint.
- Offline draft queue and sync conflict handling.
- Monitoring operations, Sentry project/DSN provisioning, source-map/debug-symbol release uploads, and alert routing.
- Broader mobile component, accessibility, and end-to-end test coverage.
