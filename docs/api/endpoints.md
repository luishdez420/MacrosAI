# API Endpoints

Last updated: 2026-07-09

Versioned base path: `/api/v1`

Related documents: [[Architecture]], [[Current State]], [[Roadmap]].

## System

- `GET /health`

## Authentication

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/session`
- `GET /auth/sessions`
- `DELETE /auth/sessions/{sessionId}`

`POST /auth/register` creates or upgrades a local account using an email, display name, and password. `POST /auth/login` verifies the stored password hash. Both issue a short-lived JWT access token plus an opaque refresh token. `POST /auth/refresh` rotates a valid refresh token and returns a new access/refresh pair; the previous refresh session is revoked. `POST /auth/logout` revokes the supplied refresh session. `GET /auth/session` requires an active bearer token. Invalid, expired, or revoked JWT sessions return `401`.

`GET /auth/sessions` returns active local refresh sessions with created, last-used, expiry, and current-device fields. `DELETE /auth/sessions/{sessionId}` revokes another active session for the current user. Revoking the current session returns `400`; use `/auth/logout` so the mobile app also clears stored credentials.

Development preview may still use no-token or legacy local-token compatibility when `ALLOW_DEV_AUTH` or `ALLOW_LEGACY_LOCAL_TOKENS` are enabled. Production configuration requires a strong `JWT_SECRET` and rejects either compatibility mode. Auth routes use the configurable process-local limiter described below. OAuth, recovery, session naming/device metadata, and distributed rate limiting remain planned.

## Food

- `GET /foods/search?query=&locale=`
- `GET /foods/recent?limit=`
- `DELETE /foods/recent/{foodId}`
- `GET /foods/favorites?limit=`
- `PUT /foods/favorites/{foodId}`
- `DELETE /foods/favorites/{foodId}`
- `GET /foods/custom?limit=`
- `PATCH /foods/custom/{foodId}`
- `POST /foods/label-analysis`
- `POST /foods/{id}/correction-reports`
- `GET /foods/{id}`
- `GET /foods/barcode/{barcode}`
- `POST /foods/custom`

`GET /foods/{id}` is the canonical food detail/provenance endpoint. It accepts stored source-record IDs and provider IDs such as `usda:173944`. The response includes:

- Display name, provider, external ID, data type, brand owner, publication date, source reference, and retrieval date.
- Normalized `nutrientsPer100g`.
- `servingOptions`, including a 100g basis and source serving when available.
- `recordConfidence`.
- `qualityFlags`.
- `originalNutrientIds`.
- `provenanceSummary`.

Provider-backed detail lookups are cached as normalized source records. Repeating `GET /foods/{provider}:{externalId}` checks the stored source record before calling the external provider again.

`GET /foods/search` seeds normalized source-record cache entries for successful provider results. Fresh exact food-name cache matches can be returned without another external provider call. If provider search fails after matching records have already been cached, the endpoint can return cached matches for the query. Live USDA and Open Food Facts requests use configurable timeouts and bounded retries for transport failures, rate limits, and transient server responses. Broader query-level cache expiration and background refresh remain planned.

`POST /foods/custom`, `GET /foods/custom`, and `PATCH /foods/custom/{foodId}` power mobile custom-food creation, listing, editing, saving, reuse, and logging for user-entered per-100g records. `POST /foods/custom` can include `barcode` to create a user custom packaged product that is returned by future `GET /foods/barcode/{barcode}` calls before external providers. Successful Open Food Facts barcode lookups are also cached as normalized source records and reused before another external barcode lookup.

`POST /foods/label-analysis` accepts `imageBase64` and an optional barcode. Images must decode to 12 MB or less and use a JPEG, PNG, WebP, or GIF signature. The endpoint returns visible raw label nutrients, serving basis, serving gram weight when readable, optional normalized `nutrientsPer100g`, confidence, quality flags, warnings, and `requiresConfirmation: true`. It does not persist a food or label image. Per-serving values are normalized only when the label exposes a positive gram weight; volume-only or ambiguous servings return no per-100g result. The mobile client must present the result for editing and explicit confirmation before calling `POST /foods/custom`.

## Request limits

`POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/meal-analysis`, and `/foods/label-analysis` use configurable rolling-window request limits. Auth and analysis routes have separate budgets. When exceeded, the API returns `429` with `retry-after`, `x-ratelimit-limit`, `x-ratelimit-remaining`, and the standard error envelope using code `rate_limited`.

The current limiter is process-local and uses the direct client address. It is not distributed across workers or API replicas; a Redis-backed production policy remains planned.

`GET /foods/recent` returns source-backed foods recently logged by the current user. It is populated when meals are created or edited and is used by Manual Search before the user types. `DELETE /foods/recent/{foodId}` removes one recent-food entry without deleting the source food record.

`GET /foods/favorites`, `PUT /foods/favorites/{foodId}`, and `DELETE /foods/favorites/{foodId}` power basic favorite-food persistence. Favorites are added or removed from the food provenance screen and shown in Manual Search.

`POST /foods/{id}/correction-reports` creates a basic source-data correction report for a stored source record or provider-backed food ID. It stores the report as `open` and ties it to the current user when a local auth token is available.

## Meal Analysis

- `POST /meal-analysis`
- `GET /meal-analysis/{jobId}` planned for async Phase 4 jobs
- `POST /meal-analysis/{jobId}/confirm` planned for async Phase 4 jobs

## Meals

- `POST /meals`
- `GET /meals?date=YYYY-MM-DD`
- `GET /meals/{id}`
- `PATCH /meals/{id}`
- `DELETE /meals/{id}`

## Diary

- `GET /diary/{date}`

## Insights

- `GET /insights/weekly?startDate=YYYY-MM-DD`
- `GET /insights/monthly?month=YYYY-MM`

`GET /insights/weekly` returns seven daily rows starting at `startDate`, or the last seven days when `startDate` is omitted. The response includes the saved calorie target when available, goal-day count, average calories across logged days, daily meal counts, daily totals, and whether each logged day met the calorie target.

`GET /insights/monthly` returns one row per day for the requested month, or the current month when `month` is omitted. The response includes the saved calorie target when available, logged-day count, goal-day count, average calories across logged days, daily meal counts, daily totals, and whether each logged day met the calorie target.

## Goals

- `GET /goals`
- `PUT /goals`

Basic goal storage exists. A richer goal editor and production account lifecycle remain planned.

## Preferences

- `GET /preferences`
- `PUT /preferences`

Preferences persist the current user's locale, unit system, day-start time, timezone, and image-retention-days setting. The mobile Profile screen currently uses `unitSystem` to keep US or metric height/weight inputs across sessions and lets users edit `imageRetentionDays`. Retention enforcement and image deletion remain planned.

## User Data

- `GET /export`
- `GET /correction-reports?limit=`
- `DELETE /account`

`GET /export` returns a current-user JSON export containing profile/session metadata without a token, preferences, nutrition goals, weight entries, meals with item snapshots, favorite foods, recent foods, and custom foods. This is a basic portability endpoint for local-auth users.

`GET /correction-reports` returns the current local user's recent source correction reports with report status and linked food-source metadata when the source record still exists. It is used by Profile to show a lightweight report history. Admin review, status transitions, and resolution workflows remain planned.

`DELETE /account` deletes the current local user's profile, preferences, goals, weight entries, meals, meal images, analysis jobs, favorites, recents, custom foods, and user-owned custom source records. Source correction reports and audit events are anonymized by clearing their user reference. Production account lifecycle, stored image deletion from object storage, retention enforcement, audit-log review, and immutable audit delivery remain planned.

Sensitive account operations create internal minimal audit events: register, login, refresh, logout, export, and account deletion. Audit events store event type, outcome, timestamp, request ID, an optional user link, and a one-way client fingerprint. They do not store credentials, tokens, email addresses, food data, images, or free-form request payloads. Account deletion clears the user link from its audit records. Audit-log review, retention, and immutable external delivery remain planned.

## Weight

- `GET /weight?limit=`
- `POST /weight`
- `DELETE /weight/{loggedOn}`

Basic weight entry storage exists. `POST /weight` upserts one entry per user/date and is used for both creation and editing, `GET /weight` returns recent entries for the current user, and `DELETE /weight/{loggedOn}` deletes the current user's entry for that ISO date when it exists.

Error responses use a consistent envelope:

```json
{
  "error": {
    "message": "Meal not found.",
    "code": "http_error",
    "requestId": "generated-or-forwarded-request-id"
  }
}
```

Every response includes the `x-request-id` header.
