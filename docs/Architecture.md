# Architecture

Last updated: 2026-07-09

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
- SecureStore for the local auth token.
- ScrollView-based manual search and logging form with keyboard-dismiss-on-drag behavior and a sticky selected-food log action so save controls remain reachable above the floating navigation when the keyboard is hidden and above the keyboard while entering amounts.
- React Native SVG for macro ring rendering.

Current routes:

- `/`: home dashboard, today's logging actions, daily totals, and meal timeline.
- `/calendar`: seven-day calorie progress graph against the saved goal.
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
- `/profile`: local sign-in, nutrition goal setup, US/metric preferences, image-retention preference, weight logging/editing/deletion, weight trend, selected-goal-direction feedback, and data export summary action.
- `GET /api/v1/export`: current-user JSON export for profile, preferences, goals, weight entries, meals, favorites, recents, and custom foods.

The floating bottom navigation is configured as Home, Progress, Scan, and Profile. Home remains active for logging-adjacent routes such as manual search, barcode, saved foods, food source detail, and meal detail. Progress points to the seven-day graph route rather than a calendar-style logging tab.

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
- Local SQLite support for phone preview and tests.
- Structured logging with `structlog`.
- Request ID middleware.
- Consistent error envelopes.
- Configurable process-local rolling-window rate limiting for authentication and paid image-analysis endpoints.

The API is mounted under `/api/v1`.

### Database usage

The schema includes models for:

- Users and user preferences.
- Nutrition goals.
- Weight entries.
- Food source records.
- Food servings.
- Nutrient definitions.
- Food nutrients.
- Custom foods.
- Meals.
- Meal items.
- Meal images.
- Favorite foods.
- Recent foods.
- Analysis jobs and analysis job items.
- Data correction reports.
- Audit logs for sensitive account operations.

Not every modeled entity has a complete API and mobile workflow yet. Data correction reports have a basic food-source submission workflow from the mobile provenance screen and a current-user report history in Profile, while admin review and status management are pending. Meal images are primarily schema foundations today. Weight entries have basic API and Profile logging/history support, but richer goal-integrated insights are pending. Favorite foods can be added/removed from food provenance, displayed in Manual Search, and removed from Saved Foods. Recent foods are persisted automatically from logged meal items, displayed in Manual Search, and removable from Saved Foods. Richer organization controls are still pending.

### Nutrition providers

The backend has a provider abstraction in `apps/api/app/nutrition/provider.py`.

Current providers:

- USDA FoodData Central for food search, food lookup, and generic/branded nutrition records.
- Open Food Facts for barcode-based packaged-food lookup.
- User-created barcode custom products are checked before external barcode providers for the current user.
- Successful Open Food Facts barcode lookups are stored as normalized source records and reused before calling external barcode providers again.
- Open Food Facts normalization parses a gram serving basis when available and flags serving-vs-per-100g conflicts, negative raw nutrient values, incomplete core per-100g data, energy/macros mismatches, and possible kJ/kcal confusion.
- Stored non-user provider records older than 180 days are marked with a `stale_source_record` quality flag when returned through food search/detail helpers. Food detail also attempts a safe provider refresh for stale records and falls back to the cached snapshot when refresh fails. Broader automatic refresh is still planned.
- Food search flags same-named non-user records with `duplicate_nutrition_conflict` when their per-100g calories or macros differ substantially. This is search-time transparency rather than persisted duplicate history.
- Successful provider search and detail lookups are stored as normalized source records. Food detail requests check stored records before external providers, exact fresh food-name searches can be served from normalized cached records, and food search can return cached matches when provider search fails after records have been cached.
- USDA and Open Food Facts share a configurable HTTP policy that applies request timeouts and bounded exponential retries for transport failures, `408`, `429`, and selected `5xx` responses. Permanent client errors such as `404` are not retried, and `Retry-After` delays are capped.

Provider request behavior can be tuned with `NUTRITION_PROVIDER_TIMEOUT_SECONDS`, `NUTRITION_PROVIDER_MAX_ATTEMPTS`, `NUTRITION_PROVIDER_RETRY_BACKOFF_SECONDS`, and `NUTRITION_PROVIDER_MAX_RETRY_DELAY_SECONDS`.

The app calculates consumed nutrition using:

```text
nutrientAmount = nutrientPer100g * consumedGrams / 100
```

### Nutrition-label analysis flow

Current label flow:

1. Mobile captures or imports a nutrition facts image with base64 available only for the analysis request.
2. The backend validates base64, supported JPEG/PNG/WebP/GIF signatures, and a 12 MB decoded-size limit before `POST /api/v1/foods/label-analysis` sends the image to the configured OpenAI vision model using a strict structured-output schema.
3. The analyzer extracts only visibly printed values and returns `null` for unreadable fields.
4. Per-serving values are normalized to per 100g only when a positive serving gram weight is visible. Volume servings without a verified mass are not converted.
5. Mobile keeps the photo and extraction in a temporary Zustand draft, shows raw label values separately from normalized values, and pre-fills the editable custom-food form only when per-100g normalization is valid.
6. The user must compare and confirm the values before a user-created food can be persisted.

The application does not currently persist the label image or extraction as evidence. The final record is marked as user-created rather than authoritative provider data.

### Authentication approach

Current authentication has a local-password JWT/refresh-session foundation with explicit development compatibility modes.

Implemented:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/session`
- `GET /api/v1/preferences`
- `PUT /api/v1/preferences`
- SecureStore persistence for access and refresh tokens on mobile.
- Local password hashing for register/login using a backend PBKDF2-SHA256 password hash column.
- Signed HS256 JWT access tokens with issuer, audience, expiry, user ID, and session ID claims.
- Hashed opaque refresh tokens stored in `auth_sessions`; refresh rotates the session and logout revokes it. Revocation also invalidates access tokens immediately through the session check.
- Mobile retries a failed protected request once after refresh, then clears invalid local credentials.
- `GET /api/v1/auth/sessions` returns active refresh sessions for the current local user. `DELETE /api/v1/auth/sessions/{sessionId}` revokes another active session; the current session uses the existing logout flow so mobile clears its stored credentials.
- Invalid bearer tokens, malformed legacy tokens, revoked sessions, and missing users return `401`.
- `ALLOW_DEV_AUTH` and `ALLOW_LEGACY_LOCAL_TOKENS` preserve phone-preview compatibility only outside production. Production config validates a 32+ character `JWT_SECRET` and requires both flags to be false.

User preferences currently persist locale, unit system, day-start time, timezone, and image-retention-days fields. The mobile Profile screen uses the unit-system preference so users can keep US or metric height/weight inputs across sessions, and it converts current height/weight entries when the user switches between US and metric modes.

Pending:

- OAuth or managed auth.
- Password reset, account recovery, and stronger production credential lifecycle.
- OAuth, password recovery, session naming/device metadata, richer device/session management, distributed rate limiting, and production account lifecycle beyond the current local JSON export and account deletion flows.

### Meal and diary flow

Manual, barcode, and custom-food logging follow this flow:

1. Mobile searches or scans a food.
2. For barcode scans, the backend checks user-created barcode products, then cached Open Food Facts barcode source records, then external barcode providers.
3. Backend returns provider-backed per-100g nutrients and source metadata.
4. User can open `/food/[id]` to inspect provider provenance, serving basis, quality flags, original nutrient IDs, and per-100g values.
5. User confirms grams, ounces, or source servings with a verified gram basis. Ounces are converted to grams before nutrient calculation while the selected unit is preserved in the meal snapshot. A household or volume serving without verified grams is not converted and remains unavailable for logging until the user enters a weight.
6. Mobile calculates a preview using per-100g nutrients.
7. Mobile posts a meal to `POST /api/v1/meals`.
8. Backend persists meal items with nutrition snapshots and confidence fields.
9. Home reads `GET /api/v1/diary/{date}` for totals and timeline data.

Natural entry follows the same persistence flow after parsing. It accepts up to six foods separated by semicolons or new lines when each has an explicit gram or ounce weight. The mobile client searches provider records for every parsed food and blocks meal creation until the user selects a result for each item. It does not convert cups, pieces, or vague household measures into mass.

Meal editing currently replaces meal items through `PATCH /api/v1/meals/{mealId}`.
Saved meal items can open the same food detail route. If live source lookup fails, the mobile screen shows the nutrition provenance snapshot saved with the meal item.

### Goal storage

The profile screen can save basic nutrition goals through:

- `GET /api/v1/goals`
- `PUT /api/v1/goals`

The home dashboard uses the saved calorie goal when available and falls back to a static default otherwise.
The progress/calendar screen uses `GET /api/v1/insights/weekly` to render a seven-day calorie line graph, goal-day count, average logged calories, and daily check-in statuses. It also uses `GET /api/v1/insights/monthly` to render a basic monthly rhythm card with logged days, goal days, average calories, and daily status dots. Richer trend analysis is still planned.

### Camera-analysis flow

Current camera flow:

1. Mobile captures or imports an image.
2. Mobile stores a draft image locally in Zustand.
3. Meal confirmation calls `POST /api/v1/meal-analysis`.
4. Backend uses OpenAI vision to identify visible foods.
5. Backend searches nutrition providers for matched food records.
6. Backend returns provider-backed estimates and confidence notes.
7. Mobile lets the user adjust grams before saving.
8. Mobile saves a meal through `POST /api/v1/meals`.

Current limitation: the confirmation screen supports explicit food confirmation, model-returned candidate labels as search suggestions, in-card provider search replacement, provider-backed sauce/topping add-ons with grams, source review, inline source issue reporting, preparation selection, structured skin/bone/sauce/cheese/sugar review chips, added oil/butter grams, freeform sauce/topping notes, remove, duplicate, split, and mark-incorrect controls. Source-level correction reports can also be submitted from food provenance and viewed in Profile history. The camera confirmation screen does not yet support advanced candidate ranking, richer add-on management UX, or admin report-management workflows.

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

### Audit events

The API records minimal database-backed events for local account registration, login,
refresh, logout, user-data export, and account deletion. Each event records event type,
outcome, request ID, creation time, an optional user link, and a one-way direct-client
fingerprint. Credentials, bearer tokens, refresh tokens, email addresses, meal contents,
image data, and free-form request bodies are not written to the audit table.

Account deletion anonymizes related audit records by clearing their user link while
retaining the operational event. There is not yet an admin audit-log API, audit-log
retention policy, export surface, or external immutable log sink.

### Request limits

The API currently applies an in-memory rolling-window limiter to `POST /auth/register`,
`/auth/login`, `/auth/refresh`, `/auth/logout`, `/meal-analysis`, and
`/foods/label-analysis`. Auth and image-analysis routes have independent configurable
limits. A blocked request returns `429`, `retry-after`, `x-ratelimit-limit`,
`x-ratelimit-remaining`, and the standard error envelope with the request ID.

The limiter keys on the direct client address and is scoped to one API process. It is a
useful preview/single-worker safeguard, not a distributed production control: reverse
proxy trust, Redis-backed coordination, and cross-replica policies remain planned.

### Current deployment and infrastructure state

Implemented:

- Docker Compose for PostgreSQL and Redis dependencies.
- API Dockerfile.
- Alembic migrations.
- GitHub Actions CI for mobile typecheck, mobile Jest tests, Alembic heads, Ruff, and pytest.
- Phone development script for Expo Go and local API preview.

Not currently operational as production services:

- Redis-backed application behavior.
- Object storage for meal images.
- Production OAuth/JWT lifecycle.
- Redis-backed or equivalent distributed API rate limiting.
- Audit-log review, retention policy, and immutable/external audit-log delivery.
- Sentry-compatible monitoring.
- Production account deletion infrastructure beyond the current local-account deletion endpoint.
- Production-grade export delivery beyond the current JSON endpoint.

## Planned production architecture

Planned production architecture adds:

- Production authentication with secure token lifecycle or managed OAuth.
- Distributed rate limiting plus audit-log review, retention, and immutable external delivery.
- Cache expiration, richer outage fallback beyond bounded request retries and cached-search fallback, persisted duplicate history, search/barcode refresh policy, and background refresh beyond the current stale-detail refresh.
- Object storage with private buckets and signed URLs for meal images.
- Image retention enforcement and deletion controls beyond the current stored preference.
- Richer data export/download and production account lifecycle flows beyond the current local-account deletion endpoint.
- Offline draft queue and sync conflict handling.
- Monitoring and Sentry-compatible error reporting.
- Broader mobile component, accessibility, and end-to-end test coverage.
