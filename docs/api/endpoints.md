# API Endpoints

Last updated: 2026-07-21

Versioned base path: `/api/v1`

Related documents: [[Architecture]], [[Current State]], [[Roadmap]].

## System

- `GET /health`
- `GET /health/ready`
- `GET /metrics` (root path, not versioned)

`GET /health/ready` is the readiness probe for deployments. It verifies the database connection/schema and, when configured for Redis, checks both the shared rate limiter and provider circuit breaker. It returns `200` with dependency categories only when ready, or a request-correlated `503` without connection details when a required dependency is unavailable. Local preview uses in-memory limiter/circuit state and reports them as such; it is not proof of shared-production operation.

`GET /metrics` returns Prometheus text only when `METRICS_ENABLED=true`. In production the configuration requires `METRICS_BEARER_TOKEN`; callers must provide it as `Authorization: Bearer <token>`, otherwise the endpoint returns `404`. The response contains normalized HTTP request counts/duration buckets, rate-limit policy decisions, provider operation outcomes/latency/circuit state, food-cache events, and latest readiness dependency gauges. It intentionally omits request IDs, user IDs, IP addresses, tokens, raw paths, food queries, barcodes, image data, and exception messages. Each API replica owns its own in-memory series, so a deployment collector must scrape and aggregate each replica. Local preview does not enable metrics by default.

## Authentication

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/password`
- `POST /auth/provision`
- `POST /auth/migrate-local-account`
- `GET /auth/session`
- `GET /auth/sessions`
- `DELETE /auth/sessions/{sessionId}`
- `GET /auth/activity?limit=1..25`

Clerk is the production identity provider. The mobile app performs sign-up, sign-in, email verification, password recovery, and configured OAuth through Clerk, then sends a Clerk session token as the bearer token. The API verifies the token against the configured JWKS and issuer before mapping its subject to a Living Nutrition user. `POST /auth/provision` creates that internal profile after an explicit user choice, accepting optional `email` and `displayName` metadata. `POST /auth/migrate-local-account` requires an authenticated Clerk token plus the previous local email/password, then attaches that verified local account's data to the Clerk subject, clears its old password hash, and revokes its refresh sessions. It returns `410` unless the bounded migration setting is enabled.

`POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, and `/auth/password` are legacy local-development compatibility endpoints. They issue and manage the older short-lived JWT/opaque-refresh model only while local identity mode is enabled, and return `410` in Clerk mode. `GET /auth/session` returns the mapped internal profile for either authorized implementation; a Clerk identity without a provisioned/migrated profile receives `401` with setup guidance.

`GET /auth/sessions` returns active local refresh sessions with `deviceLabel`, created, last-used, expiry, and current-device fields. New, refreshed, and password-replacement sessions can receive a generic app label through the optional `X-Living-Nutrition-Client` request header; the backend accepts only its fixed iOS, Android, and web product labels and ignores any other value. This prevents raw user agents, IP addresses, and device identifiers from being stored in `deviceLabel`. `DELETE /auth/sessions/{sessionId}` revokes another active session for the current user. Revoking the current session returns `400`; use `/auth/logout` so the mobile app also clears stored credentials.

`GET /auth/activity` returns up to 25 recent audit events owned by the authenticated account. Each item includes only a safe event type, outcome, and timestamp; request IDs, client fingerprints, tokens, credentials, and food data remain internal. It is an account transparency surface, not an administrative audit API. Account deletion clears the historical user link, so activity is not available after the account is removed.

`GET /admin/audit-events` is a server-side operational review endpoint, not a mobile product route. It requires a verified Clerk session whose subject appears in the managed `ADMIN_CLERK_SUBJECTS` allowlist. It returns up to 100 events before an optional timestamp cursor, exposing only event ID, type, outcome, request ID, creation time, and whether the source account link is still present or anonymized. It never returns user IDs, Clerk subjects, emails, device/client fingerprints, credentials, tokens, food data, image data, request bodies, or filter history. Each successful review creates a separate minimal `admin.audit_review` event for the reviewing account.

`GET /admin/correction-reports`, `GET /admin/correction-reports/{reportId}`, and `PATCH /admin/correction-reports/{reportId}` are also server-side Clerk-admin routes. Staff can list reports by safe status, inspect report content and internal-review history, and move a report from `open` to `triaged`, then `resolved` or `dismissed`. Terminal states cannot be reopened. Terminal changes require a user-visible summary; staff-only notes and reviewer identities never appear in the reporting user's API response. A linked provider-source revision must belong to the reported food record. Each list/detail review and status transition emits a minimal administrative audit event without storing report content or IDs in the audit record.

Development preview may still use no-token or legacy local-token compatibility when `IDENTITY_PROVIDER=local`, `ALLOW_DEV_AUTH`, or `ALLOW_LEGACY_LOCAL_TOKENS` are explicitly enabled. Production configuration requires `IDENTITY_PROVIDER=clerk`, `CLERK_JWKS_URL`, `CLERK_ISSUER`, a strong `JWT_SECRET`, disabled compatibility modes, `RATE_LIMIT_ENABLED=true` with `RATE_LIMIT_BACKEND=redis`, and `NUTRITION_PROVIDER_CIRCUIT_BREAKER_BACKEND=redis`. Auth routes use an IP rolling-window limiter. Paid image-analysis routes use an IP budget and an independent verified-user budget in one atomic decision; both derived keys are hashed before Redis storage, and a denied user budget does not consume the IP budget. Local preview uses the same all-or-nothing behavior in memory. If the configured shared limiter is unavailable, protected routes fail closed with `503` and `error.code` `rate_limit_unavailable`. Hosted Clerk tenant validation, account-linking UX beyond Clerk's managed account, and real deployment validation remain planned.

**Current trusted-proxy policy:** Production startup now requires an explicit `TRUSTED_PROXY_CIDRS` allowlist for the selected load balancer or reverse proxy. The API accepts only `X-Forwarded-For`, and only when the direct socket peer is in that allowlist; untrusted, absent, malformed, or wholly trusted chains safely fall back to the direct peer. This implementation supersedes the earlier planned-policy note above. Hosted Clerk tenant validation and account-linking UX beyond Clerk's managed account remain planned.

## Food

- `GET /foods/search?query=&locale=`
- `GET /foods/recent?limit=`
- `DELETE /foods/recent/{foodId}`
- `GET /foods/favorites?limit=`
- `PUT /foods/favorites/{foodId}`
- `DELETE /foods/favorites/{foodId}`
- `GET /foods/custom?limit=`
- `PATCH /foods/custom/{foodId}`
- `DELETE /foods/custom/{foodId}`
- `POST /foods/label-analysis`
- `POST /foods/{id}/correction-reports`
- `GET /foods/{id}`
- `GET /foods/barcode/{barcode}`
- `POST /foods/custom`

`GET /foods/{id}` is the canonical authenticated food detail/provenance endpoint. It accepts stored source-record IDs and provider IDs such as `usda:173944`. Global USDA/Open Food Facts records are available to signed-in users; `provider=user` custom records are visible only to their owning account and return a non-enumerating `404` for every other account. Protected meal, recipe, durable-analysis-job, custom-food, and local-session lookups follow the same missing-or-not-owned response policy. A denied owner lookup creates only the internal `authorization.owner_access_denied` event with the authenticated account link, request ID, one-way client fingerprint, and `not_found_or_not_owned` outcome; it never stores or returns the requested resource ID or payload. The response includes:

- Display name, provider, external ID, data type, brand owner, publication date, source reference, and retrieval date.
- Normalized `nutrientsPer100g`.
- `servingOptions`, including a 100g basis and source serving when available.
- `recordConfidence`.
- `qualityFlags`.
- `qualityAssessment`, a deterministic non-medical status (`complete`, `needs_review`, `insufficient_data`, or `user_entered`) with concrete source signals, plain-language summary, and an `isBlocking` marker. `insufficient_data` records must be replaced or corrected before meal logging.
- `originalNutrientIds`.
- `provenanceSummary`.
- `retrievalHistory`, with up to five normalized external-provider snapshots created only when source data changed. It is provenance context, not a record of changes to logged meals.
- `sourceConflicts`, with up to five retained same-name cross-provider nutrition disagreements. Each entry identifies the conflicting provider record, conflict type, provider-data evidence, detection timestamps, and whether that disagreement remains current against the latest cached source records. It is provenance context, not a change to logged meals.

Provider-backed detail lookups are cached as normalized source records. Repeating `GET /foods/{provider}:{externalId}` checks the stored source record before calling the external provider again. The initial external snapshot and later meaningful provider-record changes are retained for `retrievalHistory`; unchanged retrievals update cache freshness without adding a revision. Custom-food edits are not part of this provider-cache history, and historical meal nutrition remains in each meal item's snapshot.

`GET /foods/search` seeds normalized source-record cache entries for successful provider results. Successful provider searches also store a short-lived, normalized query-to-source-record index; a fresh complete result set is returned without another external-provider call, including partial queries and cached no-result searches. The index never copies nutrition data, expires after `FOOD_SEARCH_CACHE_TTL_SECONDS` (900 seconds by default), and is bypassed when a referenced provider record is stale or missing. Public search and its shared cache exclude `provider=user` custom records; signed-in users access those only through `/foods/custom`. The public route has an independent IP-only `RATE_LIMIT_FOOD_SEARCH_*` rolling-window budget and returns the standard correlated `429` when exhausted; the API must not use it as a substitute for an eventual product decision about public access. Fresh exact food-name cache matches remain available as a legacy fallback. If a provider search fails after matching records have already been cached, the endpoint can return cached matches for the query. Stale Food Detail and exact barcode lookup use a database-backed refresh lease and jittered exponential retry backoff; they return the flagged cached snapshot while another refresh is in progress or deferred. The independently runnable `app.workers.food_source_refresh` process periodically considers a bounded oldest-first batch of eligible stale non-user provider records using that same lease/backoff path. It does not prefetch arbitrary queries, refresh custom foods, or rewrite saved meal snapshots. Live USDA and Open Food Facts requests use configurable timeouts and bounded retries for transport failures, rate limits, and transient server responses. A circuit breaker opens after repeated transient errors, skips calls while open, and permits one half-open recovery probe; production requires its shared Redis state. A provider HTTP failure or open circuit permits the registry to try a configured fallback. If no provider completes a live lookup and no cached response exists, the API returns `503` with `error.code` `nutrition_provider_unavailable` rather than a server error.

`POST /foods/custom`, `GET /foods/custom`, `PATCH /foods/custom/{foodId}`, and `DELETE /foods/custom/{foodId}` power mobile custom-food creation, listing, editing, deletion, saving, reuse, and logging for user-entered per-100g records. `POST /foods/custom` accepts an optional `Idempotency-Key`: an exact retry for the same authenticated user replays the food detail, while changed reuse returns `409`. Delete is owner-scoped and removes the reusable source record plus that user's favorite/recent links; historical meal items retain their immutable nutrition snapshots even though their live source link is removed. `POST /foods/custom` can include `barcode` to create a user custom packaged product that is returned by future `GET /foods/barcode/{barcode}` calls before external providers. Successful Open Food Facts barcode lookups are also cached as normalized source records and reused before another external barcode lookup. A transient primary-provider HTTP failure does not prevent another configured barcode provider from being tried.

`POST /foods/label-analysis` accepts `imageBase64`, an optional barcode, and an optional `Idempotency-Key` header. Images must decode to 12 MB or less and use a JPEG, PNG, WebP, or GIF signature. Before the vision request, the backend decodes the image, applies visible orientation, re-encodes it as JPEG, and strips EXIF/container metadata. Validation errors expose only field location/type/message metadata, never the rejected image/base64 content. The endpoint returns visible raw label nutrients, serving basis, serving gram weight when readable, optional normalized `nutrientsPer100g`, confidence, quality flags, warnings, and `requiresConfirmation: true`. It does not persist a food or label image. Before dispatch it reserves the authenticated user's configured label-analysis allowance and returns `X-AI-Quota-Remaining` and `X-AI-Quota-Window-Ends` on accepted requests. A provider/system failure refunds the reservation; an exhausted allowance returns `429` with `error.code` `ai_quota_exceeded`, `Retry-After`, and a safe zero remaining value. Repeating the same key and request replays the structured extraction without another vision request or another reservation; changed reuse returns `409`. Per-serving values are normalized only when the label exposes a positive gram weight; volume-only or ambiguous servings return no per-100g result. The mobile client must present the result for editing and explicit confirmation before calling `POST /foods/custom`.

## Request limits

Public `GET /foods/search`, `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/password`, `/meal-analysis`, `/meal-analysis/jobs`, and `/foods/label-analysis` use configurable rolling-window request limits. Catalog search uses its independent IP-only `RATE_LIMIT_FOOD_SEARCH_*` budget; auth and analysis routes have separate budgets, and paid analysis also has a verified-user budget. When exhausted, the API returns `429` with `retry-after`, `x-ratelimit-limit`, `x-ratelimit-remaining`, and the standard error envelope using code `rate_limited`.

Local phone preview uses a process-local limiter keyed by the direct client address. Production configuration requires an atomic Redis sorted-set limiter shared across workers and replicas; its Redis key hashes the safely resolved client key. An explicit `TRUSTED_PROXY_CIDRS` allowlist controls which direct peers may supply `X-Forwarded-For`; untrusted or malformed headers use the direct peer. If Redis cannot decide for a protected route, the API fails closed with `503` and code `rate_limit_unavailable`. Production Redis monitoring and multi-replica validation remain planned.

When optional backend Sentry reporting is configured, unexpected server errors may be correlated by the existing request ID. The reporting boundary strips request/user/context payloads and does not change this API error-envelope contract.

The preceding planned-policy phrase is superseded by the implemented proxy policy below. Production proxy configuration is required because rate-limit decisions are only safe when the deployment declares its direct proxy CIDRs. Redis stores a hash of the resolved address rather than the raw address. Production Redis monitoring and multi-replica validation remain planned.

`GET /foods/recent` returns source-backed foods recently logged by the current user. It is populated when meals are created or edited and is used by Manual Search before the user types. `DELETE /foods/recent/{foodId}` removes one recent-food entry without deleting the source food record.

`GET /foods/favorites`, `PUT /foods/favorites/{foodId}`, and `DELETE /foods/favorites/{foodId}` power basic favorite-food persistence. Favorites are added or removed from the food provenance screen and shown in Manual Search.

`POST /foods/{id}/correction-reports` creates a source-data correction report for a stored source record or provider-backed food ID. It stores the report as `open`, creates a safe owner-visible “Report submitted” history entry, and ties it to the authenticated user. It accepts an optional `Idempotency-Key`: an exact retry for the same authenticated user returns the original reporter-safe report response, while changed key reuse returns `409`. The replay ledger retains the owned report resource link rather than the free-form report message. Creating or reviewing a report never changes a historical meal snapshot.

## Meal Analysis

- `POST /meal-analysis`
- `POST /meal-analysis/jobs` creates a durable, authenticated, review-only camera-analysis job and returns `202`. It accepts the same bounded one-to-three-image request shape as the legacy synchronous endpoint, normalizes the submitted photos before private storage, and returns only safe job metadata. The worker later produces a `needs_review` result; it never creates a meal.
- `GET /meal-analysis/{jobId}` returns a signed-in owner's safe durable-job state when one exists; it omits submitted images, storage keys, provider request IDs, and raw errors. A `needs_review` result remains an analysis draft and is never a logged meal.
- `DELETE /meal-analysis/{jobId}` cancels only the signed-in owner's outstanding durable job and deletes its private normalized inputs. For a completed `needs_review` job, it preserves the safe review metadata but discards its private inputs so a retake does not wait for expiry. Storage-cleanup failures retain retry state for the retention worker and record a minimal audit outcome; the endpoint never returns storage keys.
- `POST /meal-analysis/{jobId}/confirm` planned for async Phase 4 jobs

`POST /meal-analysis/jobs` and the legacy synchronous `POST /meal-analysis` require an authenticated account before the server accepts image-analysis work. They accept the legacy `imageBase64` field or `imagesBase64` with one to three images. The current mobile client sends both the primary image for compatibility and the bounded `imagesBase64` list to the durable endpoint. Each image must be valid JPEG, PNG, WebP, or GIF base64 data and at most 12 MB decoded; all submitted meal images together must be 18 MB or less. Before any private write or provider dispatch, each valid image is decoded, orientation-normalized, re-encoded as JPEG, and stripped of EXIF/container metadata. Durable jobs persist only these normalized temporary images and minimal job metadata. Failed or cancelled jobs delete inputs immediately; successful jobs keep them only through the existing short review window so an explicit meal-confirmation choice can copy them into a retained meal-photo record. The retention worker retries failed cleanup and expires abandoned inputs. Before work is queued, the API atomically reserves configured meal-analysis, image-count, and concurrent-analysis capacity for that authenticated account. Successful work settles the reservation; a provider/system failure or cancellation refunds it. `429` `ai_quota_exceeded` is safe to retry after `Retry-After`; an exact idempotency replay does not reserve a second allowance. A `needs_review` result includes `imageCount` alongside detection, provider-match, and confidence data. Each detected item also returns a conservative `portionRangeGrams`, a `visiblePreparation` cue, `possibleHiddenIngredients` review prompts, and up to three `candidateFoods` provider records resolved from alternate scan labels. Candidate order follows the scan-label order rather than a probability claim, and each record still requires explicit user selection. These fields assist the confirmation screen only: additional views and scan cues must not be presented as confirmation of exact portions, hidden ingredients, or cooking preparation.

`POST /meal-analysis/jobs` and `POST /meal-analysis` accept an optional `Idempotency-Key` header. The older `idempotencyKey` body field remains accepted for existing mobile builds, but it must match the header when both are supplied. For the same user, key, and canonical request content, the API returns the original response without making another vision request. Durable-job image fingerprints are keyed and non-reversible; the job itself retains only its normalized private image keys and safe visual-scale metadata. Reusing a key with different content returns `409`; a request already in progress also returns `409` until it completes or its short pending lease expires. The server never places submitted image bytes in the idempotency ledger or response.

## Meals

`POST /api/v1/meals` accepts an optional `Idempotency-Key` request header. Repeating an exact create request with the same non-empty key for the same user returns the originally persisted meal instead of creating another one. Reusing the key for changed request content returns `409`. Clients should generate and retain a key for one user action or queued sync attempt; a new intentional meal needs a new key.

- `POST /meals`
- `GET /meals?date=YYYY-MM-DD`
- `GET /meals/{id}`
- `PATCH /meals/{id}`
- `DELETE /meals/{id}`

`POST /meals` creates a persisted meal with snapshots of every submitted item. `mealType` accepts `breakfast`, `lunch`, `dinner`, `snack`, or `meal` and defaults to `meal`. `loggedAt` is optional on create and defaults to the current server time. A camera-confirmation request may include `analysisJobId` and `retainAnalysisImages: true`; before reserving idempotency or flushing a meal, the server resolves that review job for the authenticated owner, its review state, and its expiry. A guessed, expired, cancelled, or another-account job returns the normal non-enumerating `404` error envelope and records only a minimal owner-denial audit event; it never creates a partial meal. When valid, the server copies normalized private review photos only for that owner and only when the job is still available. Retention is never automatic: the copy receives the current user-selected retention deadline, while an unselected or completed review deletes the temporary inputs. `GET /meals/{id}` returns safe retained-photo metadata only, never storage keys. `GET /meals/{mealId}/images/{imageId}/access` validates ownership and returns an expiring private-storage URL (up to `IMAGE_SIGNED_URL_SECONDS`, maximum 15 minutes); preview local storage intentionally has no public read URL. `DELETE /meals/{mealId}/images/{imageId}` deletes one retained photo without changing the meal snapshot and records retry state if object storage is unavailable. `PATCH /meals/{id}` can update the meal name, category, logged time, notes, and/or replace item snapshots. Item request order is preserved when the meal is read or exported.

## Diary

- `GET /diary/{date}`

## Recipes

- `POST /recipes`
- `GET /recipes`
- `GET /recipes/{id}`
- `PATCH /recipes/{id}`
- `DELETE /recipes/{id}`
- `POST /recipes/{id}/log`

Recipes store source-backed meal-item snapshots, including confirmed grams, serving basis, source/provider identifiers, confidence fields, and nutrient snapshots. Their optional `mealType` uses the same values as meals. `POST /recipes` and `POST /recipes/{id}/log` accept an optional `Idempotency-Key`: exact retries replay the original recipe or logged meal, while changed key reuse returns `409`. The mobile library opens `PATCH /recipes/{id}` through Meal Builder for title, category, notes, food, and gram changes. `POST /recipes/{id}/log` creates a new editable diary meal from the saved snapshot, carries over the category, records the foods as recent, and increments the recipe usage count only once per idempotent action. Editing a recipe changes only future logs; it does not change previously logged meal snapshots.

## Insights

- `GET /insights/weekly?startDate=YYYY-MM-DD`
- `GET /insights/monthly?month=YYYY-MM`
- `GET /insights/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

`GET /insights/weekly` returns seven daily rows starting at `startDate`, or the last seven days when `startDate` is omitted. Each daily row includes the calorie target effective on that date, goal-day status, meal counts, and daily totals. The response summary target is the target effective on the final requested date.

`GET /insights/monthly` returns one row per day for the requested month, or the current month when `month` is omitted. Each daily row includes the calorie target effective on that date; the summary includes the target effective on the final day, logged-day count, goal-day count, average calories across logged days, meal counts, and totals.

`GET /insights/range` returns one row per calendar day for an inclusive 1-to-366-day window. Each daily row includes the calorie target effective on that date, daily totals, meal count, and goal-day status calculated from persisted meal-item snapshots. The summary includes the target effective on the final requested date plus logged-day count, goal-day count, and average calories, protein, and fiber across logged days. It rejects an end date before the start date and windows longer than 366 days.

## Goals

- `GET /goals`
- `GET /goals/history`
- `PUT /goals`

`PUT /goals` creates or updates an effective-date goal revision. When `startsOn` is omitted, the revision is effective today; a repeat save for the same date updates that revision. `GET /goals` returns the revision effective today, while `GET /goals/history` returns the authenticated user's revisions newest first for the Profile goal schedule. The separate `goalDirection` preference (`maintain`, `cut`, or `gain`) is saved through `PUT /preferences` and drives the basic Profile weight-trend language. A richer goal editor and production account lifecycle remain planned.

## Preferences

- `GET /preferences`
- `PUT /preferences`

Preferences persist the current user's locale, unit system, day-start time, timezone, goal direction, optional `onboardingGoal`, optional `loggingPreference`, optional `dietaryPreferences`, image-retention-days setting, and `themePreference` (`system`, `light`, or `dark`). Valid onboarding goals are `build_strength`, `maintain_rhythm`, `improve_nutrition`, `lose_gradually`, `support_performance`, and `track_macros`; valid logging preferences are `kitchen_scale`, `package_labels`, `household_servings`, and `visual_estimates`; valid dietary preferences are `vegetarian`, `vegan`, `pescatarian`, `gluten_free`, and `dairy_free`. Onboarding saves locally first and synchronizes these optional fields without blocking first-run completion. Profile lets users revise them, uses `unitSystem` to keep US or metric height/weight inputs across sessions, lets users edit `imageRetentionDays`, and applies `themePreference` immediately through the mobile ThemeProvider. Dietary preferences are stored as reference data only and do not filter provider results, verify ingredients/allergens, or determine medical suitability. `imageRetentionDays` is enforced only when the user separately opts in to retain a confirmed camera scan; it never retains an image automatically.

## User Data

- `GET /export`
- `GET /correction-reports?limit=`
- `DELETE /account`

`GET /export` returns a `living-nutrition-export/v1` current-user JSON export containing profile/session metadata without a token, preferences, nutrition goals, weight entries, hydration entries, meals and recipes with item snapshots, favorite foods, recent foods, and custom foods. It works for the authenticated internal profile in either Clerk or local-development mode. The mobile Data Controls flow shows a recipient warning and requires acknowledgement before handing this sensitive temporary-cache file to the native system share sheet; the app does not control any recipient copy after sharing.

`GET /correction-reports` returns the authenticated user's recent source correction reports with linked food-source metadata and a safe status history. It includes user-visible review summaries but never staff-only notes, reviewer identities, or other reporters' data. It is used by Profile to show a lightweight report history.

`DELETE /account` deletes the current Living Nutrition profile, preferences, goals, weight entries, hydration entries, meals, recipes, retained meal images, analysis jobs, favorites, recents, custom foods, and user-owned custom source records. Source correction reports and audit events are anonymized by clearing their user reference. Every remaining owned private image receives a storage deletion attempt before the request fails safely if any cleanup cannot complete; failed images retain retry metadata and the internal profile remains available for a later retry. A failed cleanup records a minimal `user_data.account_delete` audit outcome without image identifiers or storage keys. It does not delete the remote Clerk identity. Production object-storage deployment validation, managed-identity deletion coordination, an approved audit-retention schedule, and append-only receiver validation remain planned.

Sensitive account operations create internal minimal audit events: register, login, refresh, logout, password change, owner-access denial, export, account deletion, administrator audit review, correction-report review, and correction-report status transitions. Audit events store event type, outcome, timestamp, request ID, an optional user link, and a one-way client fingerprint. They do not store credentials, tokens, email addresses, food data, images, free-form request payloads, requested resource identifiers, or correction-report text. Account deletion clears the user link from its audit records. Administrative review is limited to configured Clerk subjects and returns no raw account identifiers. Each event creates a durable delivery outbox row. Production requires an HTTPS `AUDIT_DELIVERY_WEBHOOK_URL` and `AUDIT_DELIVERY_HMAC_SECRET`; the retention worker sends only a canonical envelope of schema version, event ID/type, outcome, request ID, and time. It retries safe failure categories with bounded backoff and will not purge an undelivered event. The deployment must verify that the receiver provides append-only/WORM retention; the API does not receive or store a receiver response body.

## Weight

- `GET /weight?limit=`
- `POST /weight`
- `DELETE /weight/{loggedOn}`

Basic weight entry storage exists. `POST /weight` upserts one entry per user/date and is used for both creation and editing, `GET /weight` returns recent entries for the current user, and `DELETE /weight/{loggedOn}` deletes the current user's entry for that ISO date when it exists.

## Hydration

- `GET /hydration/{loggedOn}`
- `PUT /hydration/{loggedOn}`
- `DELETE /hydration/{loggedOn}`

Hydration is an optional daily total, stored in whole milliliters. `GET` returns the current user's entry for the ISO date or `null` when no total has been logged. `PUT` upserts a total from 1 to 20,000 mL for that date; `DELETE` clears it. The current mobile Today module offers quick additions and an exact-total adjustment, but does not assign a daily target, provide medical guidance, or include hydration in trends or offline queuing.

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
