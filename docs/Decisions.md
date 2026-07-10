# Decisions

Last updated: 2026-07-09

This document records confirmed product and architecture decisions. Historical ADRs are preserved separately, including [[adr-0001-phased-nutrition-architecture]]. Mark decisions as superseded rather than erasing them.

## 2026-07-07: Nutrition values come from authoritative providers

Status: Accepted

Context: AI vision can identify likely foods, but it is not a reliable nutrition database.

Decision: Nutrition values should come from provider records such as USDA FoodData Central, Open Food Facts, or user-confirmed custom foods rather than AI-generated nutrient guesses.

Consequences: The backend must preserve provider identity, source identifiers, source references, and nutrient snapshots. AI can assist food identification, but it must not be the final nutrition authority.

## 2026-07-07: Camera recognition is assistive

Status: Accepted

Context: A food photo cannot reliably reveal exact weight, hidden oils, sauces, cooking methods, edible portion, or ingredients.

Decision: Camera recognition is an assisted-entry workflow and must not be treated as perfectly accurate.

Consequences: Camera results must use language such as estimated, needs confirmation, and based on the portion entered. Future camera work must improve confirmation and correction before expanding automation.

## 2026-07-07: Users confirm or correct meal information before final persistence

Status: Accepted

Context: Manual and barcode flows already ask users to confirm grams or servings. Camera confirmation currently supports gram adjustment but needs stronger identity and preparation confirmation.

Decision: Final persisted meals should reflect user-confirmed or user-corrected information, not unreviewed model output.

Consequences: Meal items store `userConfirmed`, confidence fields, portion details, and nutrition snapshots. Camera confirmation remains a priority because it is not yet complete.

## 2026-07-07: Nutrient calculations preserve source and serving basis

Status: Accepted

Context: Historical diary totals should not silently change when an external provider updates a record.

Decision: Nutrient calculations should retain food source, source identifier, source version, serving basis, gram weight when available, and a nutrient snapshot.

Consequences: Meal items duplicate key nutrition values at log time. Future edit flows must update snapshots intentionally rather than depending on live provider records.

## 2026-07-07: TypeScript is preferred for mobile development

Status: Accepted

Context: The prototype has been migrated into an Expo workspace with strict TypeScript.

Decision: New mobile code should be TypeScript and should keep UI, domain logic, API access, and persistence concerns separated.

Consequences: Shared schemas and API client types should be updated when endpoint contracts change. New JavaScript files should be avoided unless there is a documented reason.

## 2026-07-07: Backend uses FastAPI, SQLAlchemy, and Alembic

Status: Accepted

Context: The backend is implemented with FastAPI, Pydantic, SQLAlchemy models, and Alembic migrations.

Decision: Continue backend development in this stack unless a future ADR supersedes it.

Consequences: Schema changes need migrations. API contracts should be represented with Pydantic schemas and mirrored in shared TypeScript types where mobile consumes them.

## 2026-07-07: Development authentication is temporary

Status: Superseded in part by the 2026-07-09 JWT session decision

Context: Local register/login/session endpoints exist, verify hashed local passwords, and issue deterministic development tokens. They help phone testing and local user-scoped data, but they are not production security.

Decision: Development authentication must not be represented as production-grade authentication.

Consequences: Documentation and UI should describe current auth as local/development. Production auth, refresh tokens, OAuth or managed auth, and account lifecycle remain planned work.

## 2026-07-09: Local accounts use rotating JWT sessions

Status: Accepted

Context: Deterministic development bearer tokens had no expiry, session record, refresh behavior, or logout revocation, which was not sufficient for user-scoped nutrition history.

Decision: Local email/password accounts issue signed short-lived JWT access tokens and opaque refresh tokens. The API stores only refresh-token hashes, rotates refresh sessions on refresh, and checks active sessions for bearer authorization so logout revokes access immediately. Development preview and legacy-token modes remain explicit settings and production configuration must disable them.

Consequences: Mobile stores access and refresh tokens separately in SecureStore and retries a protected request once after refresh. Existing `token` response data remains a temporary compatibility alias for `accessToken`. OAuth, recovery, rate limiting, managed identity, and device-management UI are separate follow-up work.

## 2026-07-09: Nutrition-label extraction is assistive and non-authoritative

Status: Accepted

Context: A vision model can transcribe visible package-label values, but blur, glare, crop, unit ambiguity, and serving-basis confusion can produce unsafe nutrition records.

Decision: Label analysis may prefill an editable user-created food only when visible values support the conversion. Per-serving values are converted to per 100g only when a positive serving gram weight is visible. Extracted values are never persisted without explicit user comparison and confirmation.

Consequences: The UI must show the original local photo, raw label values, normalized values, confidence, and warnings. Ambiguous results fall back to manual entry. Saved records remain user-created rather than authoritative provider records, and stored label evidence requires a future consent, retention, and deletion design.

## 2026-07-09: Sensitive endpoints use bounded process-local request limits

Status: Accepted

Context: Credential attempts and vision analysis can be abused or create avoidable paid-provider demand. The current local and phone-preview API runs as one process and does not yet have Redis-backed application behavior.

Decision: Apply configurable rolling-window limits by direct client address to authentication and paid image-analysis routes. Return the standard API error envelope with `429`, a request ID, and retry guidance when a limit is exceeded.

Consequences: Preview and single-worker deployments gain a bounded safeguard without new infrastructure. The limiter must not be described as distributed production protection; trusted-proxy handling and Redis-backed cross-replica coordination remain follow-up work.

## 2026-07-09: Sensitive account actions create minimal audit events

Status: Accepted

Context: Export, account deletion, and session lifecycle actions affect sensitive nutrition and profile data. The product needs operational accountability, but an audit system must not become another store of secrets or meal content.

Decision: Record minimal database events for local registration, login, token refresh, logout, export, and account deletion. Store event type, outcome, request ID, timestamp, optional user link, and a one-way direct-client fingerprint. On account deletion, clear the user link from audit records while retaining the anonymous operation history.

Consequences: The local API has a testable operational trail without recording emails, raw IP addresses, credentials, tokens, images, meal data, or request bodies. Audit-log review, retention, export, and an immutable external delivery mechanism remain follow-up work.

## 2026-07-09: Local users can revoke other active refresh sessions

Status: Accepted

Context: Rotating refresh sessions and logout revocation existed, but a user could not inspect or invalidate another active local session from the product.

Decision: Expose active local refresh sessions through the authenticated API and Profile. Mark the current session, allow another active session to be revoked, and preserve Sign out as the current-device action so local credentials are cleared from SecureStore.

Consequences: Users gain a basic account-safety control without exposing tokens or raw client identifiers. Session names, device metadata, OAuth sessions, recovery, and broader production identity management remain follow-up work.
