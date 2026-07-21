# Decisions

Last updated: 2026-07-21

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

Status: Superseded for production by the 2026-07-20 Clerk decision; retained as local-development and migration context

Context: Local register/login/session endpoints exist, verify hashed local passwords, and issue deterministic development tokens. They help phone testing and local user-scoped data, but they are not production security.

Decision: Development authentication must not be represented as production-grade authentication.

Consequences: Documentation and UI must not represent local authentication as production security. The former local JWT/refresh implementation remains compatibility-only for development previews and time-bounded account migration; Clerk now owns production credentials, recovery, verification, OAuth, and client sessions.

## 2026-07-09: Local accounts use rotating JWT sessions

Status: Superseded for production by the 2026-07-20 Clerk decision; retained for local compatibility and migration

Context: Deterministic development bearer tokens had no expiry, session record, refresh behavior, or logout revocation, which was not sufficient for user-scoped nutrition history.

Decision: Local email/password accounts issue signed short-lived JWT access tokens and opaque refresh tokens. The API stores only refresh-token hashes, rotates refresh sessions on refresh, and checks active sessions for bearer authorization so logout revokes access immediately. Development preview and legacy-token modes remain explicit settings and production configuration must disable them.

Consequences: Mobile stores local access and refresh tokens separately in SecureStore only in local compatibility mode. Production uses Clerk's SecureStore token cache and Clerk-issued sessions; the API still validates authorization and retains nutrition-data ownership. The local token model remains available solely for development previews and the bounded legacy-account migration flow.

## 2026-07-09: Nutrition-label extraction is assistive and non-authoritative

Status: Accepted

Context: A vision model can transcribe visible package-label values, but blur, glare, crop, unit ambiguity, and serving-basis confusion can produce unsafe nutrition records.

Decision: Label analysis may prefill an editable user-created food only when visible values support the conversion. Per-serving values are converted to per 100g only when a positive serving gram weight is visible. Extracted values are never persisted without explicit user comparison and confirmation.

Consequences: The UI must show the original local photo, raw label values, normalized values, confidence, and warnings. Ambiguous results fall back to manual entry. Saved records remain user-created rather than authoritative provider records, and stored label evidence requires a future consent, retention, and deletion design.

## 2026-07-09: Sensitive endpoints use bounded process-local request limits

Status: Superseded by the 2026-07-14 Redis shared-limiter decision

Context: Credential attempts and vision analysis can be abused or create avoidable paid-provider demand. The current local and phone-preview API runs as one process and does not yet have Redis-backed application behavior.

Decision: Apply configurable rolling-window limits by direct client address to authentication and paid image-analysis routes. Return the standard API error envelope with `429`, a request ID, and retry guidance when a limit is exceeded.

Consequences: Preview and single-worker deployments gain a bounded safeguard without new infrastructure. The limiter must not be described as distributed production protection; trusted-proxy handling and Redis-backed cross-replica coordination remain follow-up work.

## 2026-07-14: Production uses atomic Redis request limits

Status: Accepted

Context: Credential and paid analysis requests need shared abuse protection when the API runs in multiple processes or replicas. Redis was already a declared dependency and Docker service, while the implementation still tracked limits only in process memory.

Decision: Keep the lightweight in-memory rolling window for local phone preview, but require `RATE_LIMIT_BACKEND=redis` whenever `ENVIRONMENT=production`. The Redis limiter uses one atomic sorted-set operation per protected request, hashes client keys before storing them, and fails closed with a request-correlated `503` if it cannot make a decision.

Consequences: Production deployments cannot silently start with a per-process limiter or disabled request protection. Protected routes retain their existing `429` contract, while a Redis outage is visible and safe rather than allowing unbounded traffic. Trusted-proxy policy, production Redis monitoring, and deployment validation remain separate work.

## 2026-07-20: Forwarded client addresses require an explicit proxy allowlist

Status: Accepted

Context: Rate limits are only meaningful when the API can distinguish client requests safely behind a reverse proxy. Trusting `X-Forwarded-For` from every direct peer would let a caller forge a different rate-limit identity. The deployment provider is not selected yet, so its network ranges cannot be hard-coded into the repository.

Decision: Production startup requires a deployment-supplied `TRUSTED_PROXY_CIDRS` value. The API accepts only `X-Forwarded-For`, only when the direct socket peer belongs to that CIDR allowlist, and resolves the first non-proxy address by walking the trusted chain right-to-left. Missing, malformed, untrusted, or wholly trusted chains use the direct peer instead. The RFC `Forwarded` header is intentionally ignored to keep one explicit, testable contract.

Consequences: Operators must document the load balancer or reverse-proxy CIDRs before production deployment. Raw addresses remain ephemeral limiter inputs and are hashed before Redis storage; they are not written to rate-limit keys or audit records. Production multi-replica validation, dashboards, alerts, and proxy-platform runbooks remain follow-up work.

## 2026-07-09: Sensitive account actions create minimal audit events

Status: Accepted

Context: Export, account deletion, and session lifecycle actions affect sensitive nutrition and profile data. The product needs operational accountability, but an audit system must not become another store of secrets or meal content.

Decision: Record minimal database events for local registration, login, token refresh, logout, export, and account deletion. Store event type, outcome, request ID, timestamp, optional user link, and a one-way direct-client fingerprint. On account deletion, clear the user link from audit records while retaining the anonymous operation history.

Consequences: The local API has a testable operational trail without recording emails, raw IP addresses, credentials, tokens, images, meal data, or request bodies. Audit-log review, retention enforcement, export, and an immutable external delivery mechanism remain follow-up work.

## 2026-07-21: Administrative audit review is Clerk-allowlisted and privacy-minimized

Status: Accepted

Context: The application records minimal events for sensitive operations, but owner-only activity does not provide a safe operational-review surface. A user-editable role or a mobile admin page would create unnecessary privilege and privacy risk.

Decision: Expose a server-side `GET /api/v1/admin/audit-events` route only to verified Clerk subjects listed in the managed `ADMIN_CLERK_SUBJECTS` environment setting. Production startup rejects an empty allowlist. The route returns only event ID, type, outcome, request ID, timestamp, and linked/anonymized account state, never user IDs, Clerk subjects, emails, fingerprints, credentials, tokens, request content, food data, or image data. Each successful review records a separate minimal audit event.

Consequences: Operations can correlate incidents without a broad database export or client-accessible staff UI. The allowlist is server-managed and must be rotated through secret/environment management. Audit-retention policy approval, broader staff workflows, immutable delivery, and production access-review procedures remain separate work.

## 2026-07-21: Correction reports use a one-way, privacy-separated review lifecycle

Status: Accepted

Context: Reporters could submit a source-data issue and see an open report, but staff had no accountable way to triage it. Returning staff notes or reviewer identity to a reporter would create unnecessary privacy exposure, while rewriting a meal snapshot to reflect a report would corrupt historical nutrition data.

Decision: Restrict staff correction-report review to the existing Clerk-subject allowlist. Persist a one-way lifecycle of `open -> triaged -> resolved | dismissed`; terminal states cannot be reopened. Each transition records a reporter-safe summary separately from an optional internal note, a source-revision link that must belong to the reported food record, and a staff actor link. Owner history returns only the safe summary and timestamp. Minimal administrative audit events record review and transition outcomes without report text or resource identifiers.

Consequences: Staff can resolve reports without exposing internal review context to reporters, and users can see an understandable status history. Correction reports remain metadata about a source record and never rewrite prior meal-item snapshots. Notification delivery, formal moderation SLA, and a dedicated staff UI remain separate work.

## 2026-07-09: Local users can revoke other active refresh sessions

Status: Accepted; superseded in part by the 2026-07-14 privacy-preserving session-label decision

Context: Rotating refresh sessions and logout revocation existed, but a user could not inspect or invalidate another active local session from the product.

Decision: Expose active local refresh sessions through the authenticated API and Profile. Mark the current session, allow another active session to be revoked, and preserve Sign out as the current-device action so local credentials are cleared from SecureStore.

Consequences: Users gain a basic account-safety control without exposing tokens or raw client identifiers. Generic app labels are now available through the later decision; richer user-defined session names, device metadata, OAuth sessions, recovery, and broader production identity management remain follow-up work.

## 2026-07-12: Recipes preserve the user-confirmed nutrition snapshot

Status: Accepted

Context: Reusable recipes must be fast to log without silently replacing the nutrition source or portions a user originally confirmed.

Decision: A recipe stores a copy of each confirmed meal-item snapshot. Logging a recipe creates a new meal from that snapshot rather than re-querying providers or overwriting historical meals.

Consequences: Recipe logs retain provider/source identifiers, portion grams, confidence fields, and nutrient snapshots. Editing a recipe affects future logs only. Recipe records are included in the current-user export and explicitly removed during account deletion.

## 2026-07-12: Nutrition goals retain effective-date revisions

Status: Accepted

Context: Applying a user’s newest calorie target to older meals made historical goal-day counts misleading after a goal change.

Decision: A nutrition goal is an effective-date revision. Saving a goal on a new `startsOn` date creates a revision; saving again for the same date updates that revision. Insight responses resolve and return the calorie target effective on each calendar day.

Consequences: The Progress chart and goal-day status retain historical target context while meal nutrition remains based on immutable meal-item snapshots. `GET /goals` remains a simple current-goal endpoint; a user-facing goal-history editor, weight integration, and comparative insights remain follow-up work.

## 2026-07-12: Weight-goal direction is a persisted preference

Status: Accepted

Context: The Profile screen used a maintain/cut/gain choice for recommendations, but the choice reset after a restart and could not reliably inform future progress work.

Decision: Store the user's maintain/cut/gain direction in `user_preferences` and expose it through the existing preferences API. Saving a nutrition goal also persists the currently selected direction.

Consequences: Weight-trend language now has a durable user-intent source without adding a second goal endpoint. Weight-aware Progress insights and coaching remain separate work and must avoid medical claims based on short-term changes.

## 2026-07-12: Appearance is a persisted semantic theme preference

Status: Accepted

Context: The product brief requires accessible light and dark themes, while the existing design tokens only exposed raw light colors and dormant dark foundations. A per-screen color toggle would duplicate palette decisions and make reduced-transparency fallbacks inconsistent.

Decision: Store `system`, `light`, or `dark` in `user_preferences`, restore the choice locally through SecureStore, and resolve it through a root mobile ThemeProvider backed by semantic palettes. Shared material components, the root shell, macro ring, navigation, and Profile appearance control consume the resolved palette first; feature-local style migration continues incrementally.

Consequences: A user can choose an appearance that survives app restarts and API sessions without adding a dedicated settings endpoint. Macro meaning remains stable across themes. The application must not claim complete dark-theme coverage until every feature-local screen style is migrated and both themes pass accessibility review.

## 2026-07-13: Onboarding personalization is local-first and preference-backed

Status: Accepted

Context: The first-run experience collected a user's goal framing and preferred logging method, but those choices lived only in SecureStore. That made a kitchen-scale preference useful on one device while leaving Profile and a future authenticated session unaware of the user's stated routine.

Decision: Complete onboarding locally first, then synchronize the selected goal framing and logging method through the existing user-preferences API without delaying navigation. Store an optional onboarding goal and logging preference separately from the maintain/cut/gain direction; map goal framing to direction only as a helpful default. Profile exposes both choices for revision.

Consequences: First-run usability remains resilient when the phone is offline, while successful API sessions retain personalization across launches and devices. A user-selected framing does not automatically create calorie or macro targets; Profile remains the explicit target-review flow. Dietary preferences and production offline synchronization remain separate work.

## 2026-07-13: Dietary preferences are saved as informational, non-filtering data

Status: Accepted

Context: Users need a place to record common dietary preferences during onboarding and later revise them. Current USDA and Open Food Facts records cannot reliably prove ingredient suitability, cross-contact risk, or medical safety, so automatically filtering or validating foods from a preference alone would overstate the product's accuracy.

Decision: Store a small validated set of optional dietary preferences in `user_preferences`, collect them locally during onboarding, synchronize them best-effort through the existing preferences API, and expose them in Profile. Label the choices as reference-only in the UI. Do not filter provider results, verify ingredients/allergens, or make medical-suitability claims from these selections.

Consequences: Preferences persist across successful API sessions without blocking offline onboarding. Any future dietary-aware search or recommendation feature must be designed separately with reliable product data, explicit caveats, and accessibility review; it cannot treat the stored values as allergen protection.

## 2026-07-13: Confirmed meal creation supports caller-owned idempotency

Status: Accepted

Context: A network interruption can leave a mobile client uncertain whether a confirmed meal reached the API. Retrying a non-idempotent create request risks duplicate diary entries, especially once offline synchronization is introduced.

Decision: `POST /api/v1/meals` accepts an optional `Idempotency-Key` header. The backend stores the key with the meal and returns the previously persisted meal when the same authenticated user replays that key. The typed API client exposes the header as an explicit caller-owned option.

Consequences: Mobile flows and a future offline queue can retain one key per user logging action and retry safely. A new intentional meal must use a new key. This is a prerequisite for, not an implementation of, durable offline queuing and image-upload synchronization.

## 2026-07-20: Retry-sensitive mutations use a fingerprinted idempotency ledger

Status: Accepted

Context: The original meal-specific key prevented a duplicate saved meal, but it could not detect changed payload reuse and camera analysis accepted an idempotency field without enforcing it. Retrying paid vision work after an ambiguous connection failure could therefore incur duplicate provider work.

Decision: Add a user-scoped `idempotency_records` ledger keyed by operation and caller-owned key. It stores a SHA-256 canonical request fingerprint, bounded pending/completed state, resource reference, and replay response. Exact replays return the stored response; changed requests with the same key return `409`. Apply it first to meal creation, meal analysis, and nutrition-label analysis. Camera and label-image bytes are never stored in the ledger. The existing unique meal key stays as a second persistence boundary.

Consequences: Mobile clients can safely retain one analysis or meal key during retries, while accidental key reuse is visible rather than silently replayed. A crash can leave a short-lived pending analysis reservation which may be reclaimed after its configured lease. Scheduled cleanup, idempotency for every mutation, durable analysis jobs, and worker-backed processing remain separate work. The later 2026-07-21 decision adds a separate entitlement/usage quota boundary for paid analysis.

## 2026-07-20: Custom-food and recipe actions join the replay boundary

Status: Accepted

Context: Saving a custom food or a reusable recipe, and logging a recipe into the diary, can all be retried after an ambiguous network failure. Replaying any of those actions without a durable boundary can create duplicate records, duplicate diary meals, or increment a recipe's usage count twice.

Decision: Extend the existing user-scoped idempotency ledger to `POST /foods/custom`, `POST /recipes`, and `POST /recipes/{id}/log`. Mobile uses a screen-local action scope plus the reviewed payload to retain a key across a retry while allowing a later intentional save/log to use a new key. Recipe logging fingerprints the recipe identifier, so an exact retry replays the same logged meal and does not increment `timesUsed` again.

Consequences: The highest-risk food/recipe creation paths now share the same deterministic replay and changed-key conflict behavior as meal and paid image-analysis actions. The ledger remains incomplete for exports, account-sensitive mutations, updates, scheduled cleanup, and durable background jobs. Paid analysis now has a separate entitlement/usage reservation boundary recorded below.

## 2026-07-21: Reserve paid AI usage before provider dispatch

Status: Accepted

Context: Request-rate limits and idempotency protect against bursts and duplicate retries, but neither limits a user's total paid camera/label use or records whether failed provider work should consume an allowance. A billing provider is not yet selected, so the product also needs a stable pre-billing model that can later receive external entitlement changes.

Decision: Add one product-owned entitlement per user with `free`, `trial`, `paid`, `internal`, and `disabled` tiers, plus a durable AI usage record. The API locks the entitlement decision before camera or label dispatch, reserves configured per-operation/image/concurrent capacity, settles the same record on success, and refunds only documented provider/system failures. The record stores operation metadata, timestamps, status, reason codes, and a SHA-256 digest of the caller's idempotency key; it never stores image data, prompts, model responses, or nutrition content. Exact idempotency replays return before a new reservation is created. A quota denial releases a fresh pending idempotency record so the user is not blocked by a rejected action.

Consequences: The API can bound AI cost and reconcile current `reserved`, `settled`, `refunded`, and `expired` state before billing exists. The defaults are configuration values, not a subscription contract. A customer usage screen, scheduled reconciliation, billing synchronization, production multi-replica verification, durable analysis jobs, and observability dashboards remain separate work.

## 2026-07-21: Camera analysis runs as a durable review job

Status: Accepted

Context: A camera request may outlive a mobile connection or an app restart. Running provider work in the request-response lifecycle loses review state, makes cancellation unreliable, and encourages storing photo drafts on the device.

Decision: Persist a bounded, owner-scoped analysis job with temporary normalized private images, execute it in a separate worker, and expose only safe job status and a structured review result to the app. The mobile app retains only one account-scoped pending-job ID in SecureStore to resume review after restart; it does not retain the image bytes. A completed job never creates a meal without an explicit confirmation save.

Consequences: Camera processing can recover from API/mobile restarts, cancellation wins before a result is persisted, and private inputs are removed after processing. The system still needs a multi-job history, retry controls, cloud-worker validation, and production observability.

## 2026-07-12: Food-search cache indexes source records, not nutrition snapshots

Status: Accepted

Context: Broad and partial food searches previously called external providers on every request unless a fresh exact display-name match happened to exist locally. Repeating these calls adds latency and outage exposure, but copying provider nutrition into a separate query cache could create drift from the normalized provenance record.

Decision: Persist a short-lived normalized query and locale index that stores ordered `FoodSourceRecord` IDs only. Return it only while it is unexpired and every referenced non-user provider record is present and fresh. Cache both successful result sets and authoritative no-result searches; bypass the index on expiry, missing records, or stale records and keep existing provider and cached-record fallbacks.

Consequences: Repeated partial searches avoid unnecessary provider calls without creating another nutrition-data authority. `FOOD_SEARCH_CACHE_TTL_SECONDS` controls the freshness window. This does not provide background refresh, distributed cache coordination, persisted duplicate history, or a complete provider-outage policy.

## 2026-07-14: Session labels are allowlisted product context

Status: Accepted

Context: Basic session management made it possible to revoke another active refresh session, but labels such as `This device` and `Other device` were not useful context. Accepting arbitrary client headers as labels would risk persisting raw user agents or identifiers in account data.

Decision: The mobile client sends a fixed, product-owned label for iOS, Android, or web through `X-Living-Nutrition-Client`. The API whitespace-normalizes the value, accepts only its allowlisted labels, and sanitizes values returned from existing sessions. It never derives session labels from user agents, IP addresses, fingerprints, or device identifiers.

Consequences: Profile can display useful generic session context without adding a device-fingerprinting store. User-defined session names, detailed device metadata, OAuth-managed sessions, recovery, and broader production identity operations remain separate work.

## 2026-07-14: Provider source history is separate from meal snapshots

Status: Accepted

Context: Provider data can change over time, especially for community-contributed packaged-food records. The app already preserves immutable meal-item nutrition snapshots, but the live Food Detail screen previously exposed only the latest cached provider value and no evidence that a provider record had changed.

Decision: Keep the initial normalized external provider record and each later meaningful source-data change in `FoodSourceRevision`. Return at most five revisions from the existing `GET /foods/{id}` response and display them as source provenance. Do not create revisions for unchanged retrievals, user-created food edits, or logged-meal edits.

Consequences: Users can review recent source-data evolution without mistaking it for changes to meals already logged. The history is intentionally bounded and does not replace immutable meal snapshots, background refresh, duplicate-record history, or provider-cache analytics.

## 2026-07-20: Clerk is the managed production identity provider

Status: Accepted

Context: Local password hashing, rotating JWT refresh sessions, logout, password changes, and basic local session controls improved the preview, but they do not provide hosted email verification, recovery, OAuth, or a production identity lifecycle for sensitive nutrition and weight data.

Decision: Use Clerk for mobile credentials, email verification, recovery, configured OAuth, and client-session storage. The mobile app receives only Clerk's publishable key and uses the Clerk Expo SecureStore token cache. FastAPI verifies Clerk session JWTs through a configured JWKS endpoint and issuer, then maps the verified subject to the existing internal `users` record. An authenticated Clerk user explicitly provisions a new profile or, only during a dated migration window, proves the prior local password to attach a legacy account and revoke its old local refresh sessions.

Consequences: Clerk owns authentication secrets and recovery flows while this API remains the authority for nutrition data, authorization, and historical snapshots. Production requires Clerk mode, JWKS/issuer configuration, disabled development and legacy bearer modes, and Redis rate limiting. The former local endpoints remain compatibility-only and return `410` in Clerk mode. Social-provider account linking/unlinking is managed in Clerk; the app intentionally does not duplicate that control yet.

## 2026-07-21: Provider outage state is shared and circuit-bounded

Status: Accepted

Context: USDA and Open Food Facts already use bounded retries and registry fallback, but repeated transient failures across multiple API replicas could still create avoidable retry storms. A per-process circuit would make production outage behavior inconsistent and would not protect the provider from replica-wide retries.

Decision: Record transient provider failures by static provider name in a circuit breaker. Open the circuit after a configurable threshold, reject repeated calls during a bounded recovery window, and allow only one leased half-open probe before closing on success or reopening on another transient failure. Preview uses a bounded in-memory implementation; production startup requires the Redis-backed implementation. Circuit keys never contain a query, barcode, food identifier, user identifier, or provider response. The registry continues to configured fallback providers and route-level stale cache behavior when a circuit is open.

Consequences: Production replicas share provider-outage behavior without storing sensitive lookup inputs. Readiness reports provider-circuit health, and protected metrics expose provider outcome, latency, and circuit state with bounded labels. Redis deployment validation, collector dashboards/alerts, automatic cache refresh, and provider-specific incident thresholds remain follow-up work.

## 2026-07-21: Stale provider refreshes are leased and back off per source record

Status: Accepted

Context: Stale detail and exact barcode records remained available when a provider failed, but every later user request could immediately repeat the same provider call. That behavior risks a refresh storm across API replicas during an outage while providing no fresher data to the user.

Decision: Store refresh-attempt time, retry-not-before time, and failure count on each non-user `FoodSourceRecord`. A stale detail or exact barcode request atomically claims a short database-backed lease before calling the provider. Failed or no-match attempts preserve the stale snapshot and set deterministic jittered exponential backoff; a successful normalized provider response clears that state. The metadata contains only internal record state and timestamps, never a query, barcode, user identifier, or meal data.

Consequences: One replica refreshes a stale record at a time, while other requests receive the existing flagged snapshot instead of producing repeat calls. At the time of this decision, refresh was request-safe only; the scheduled-refresh limitation is superseded by [[Decisions#2026-07-21: Stale provider records receive bounded scheduled refresh|the later bounded worker decision]]. Persisted duplicate history, deployed multi-replica validation, and cache dashboards remain separate work.

## 2026-07-21: Stale provider records receive bounded scheduled refresh

Status: Accepted

Context: The earlier leased refresh decision protected request paths, but a record could remain stale until someone opened its detail or scanned its barcode. Refreshing arbitrary search queries would create unbounded provider work and could reveal no new user benefit.

Decision: Run an independently deployable worker that periodically selects an oldest-first, configured-size batch of eligible stale non-user `FoodSourceRecord` values. Each record is refreshed through the existing database-backed lease, provider circuit breaker, provenance revision, and deterministic backoff path. The worker never refreshes custom foods, raw search queries, query-cache entries, or immutable meal snapshots. Provider failures preserve the stale snapshot and defer the next attempt; worker logs and metrics use only static operation/outcome labels.

Consequences: Stale provider data can improve without waiting for a user request, while batch limits and the shared lease prevent provider-call storms across worker replicas. This supersedes the scheduled-refresh limitation in the 2026-07-21 request-safe refresh decision, but not its lease/backoff design. Query-cache prefetching, deployed outage validation, dashboards, and provider-specific freshness tiers remain separate work.

## 2026-07-21: Provider nutrition conflicts are durable provenance evidence

Status: Accepted

Context: Search-time duplicate warnings disappeared as soon as a response ended, which made it impossible to explain a later conflicting provider record from Food Detail or distinguish a current mismatch from a record that had since been corrected.

Decision: When same-named non-user provider records materially disagree on normalized per-100g calories or macros, retain the ordered source-record pair, conflict type, provider-data evidence, and first/last detection timestamps in `food_source_conflicts`. `GET /foods/{id}` returns a bounded counterpart history and recalculates whether each disagreement remains current from the latest cached records. Current disagreements add the existing quality warning; historical evidence remains visible without claiming an active warning. The data contains no user, query, barcode, or meal information and never modifies meal-item snapshots.

Consequences: Food provenance can explain provider disagreement across process restarts and after a later correction. This is not a complete food-data quality score, duplicate-ranking system, scheduled reconciliation process, or correction-report administration workflow; those remain separate roadmap work.

## 2026-07-21: Audit retention requires an explicit production policy

Status: Accepted

Context: The application records privacy-minimized internal audit events, but no approved legal or operational duration exists for retaining them. Leaving a default duration in code would make a product and compliance decision without the required owners.

Decision: Add the optional `AUDIT_LOG_RETENTION_DAYS` environment setting. Production configuration rejects an unset value, while local preview leaves it unset and retains audit history. The retention worker deletes expired database audit events in bounded oldest-first batches and emits only aggregate cleanup counts to structured logs and protected metrics. It does not export events or act as an immutable audit sink.

Consequences: Deployment operators must choose and document the retention value through the approved privacy and operations process before production startup. The external-delivery mechanism is now implemented by the later [[#2026-07-21 Audit delivery uses a privacy-minimized signed outbox|signed outbox decision]], while receiver selection/validation, access-review process, and legally approved retention schedule remain separate work.

## 2026-07-21: Audit delivery uses a privacy-minimized signed outbox

Status: Accepted

Context: Database-only audit records can be lost from operational visibility during an incident or after local retention cleanup. Sending full audit rows to an external system would unnecessarily disclose internal account links, client fingerprints, or sensitive request context.

Decision: Create one durable `audit_deliveries` outbox row for every minimal audit event. The retention worker leases and sends a canonical HMAC-signed webhook envelope containing only schema version, event ID, event type, outcome, request ID, and occurrence time. Delivery uses bounded retry state and never retains receiver response bodies or error text. Database retention skips undelivered events. Production startup requires `AUDIT_DELIVERY_BACKEND=webhook`, an HTTPS receiver URL, and a 32-character-or-longer managed HMAC secret; local preview keeps delivery disabled. The selected receiver must be append-only/WORM-capable because the API cannot establish its immutability itself.

Consequences: Sensitive operations gain an eventual external audit-delivery boundary without sending user IDs, emails, fingerprints, food, image, or request-body data. Operators must select, configure, and validate a receiver and its immutable-retention policy before production; an unavailable receiver will accumulate retrying outbox rows rather than silently dropping audit evidence.

## 2026-07-21: Vision input accepts normalized still images only

Status: Accepted

Context: Camera and nutrition-label uploads are untrusted binary input. Accepting large, malformed, or animated formats can waste memory or CPU before a provider request, and preserving original container metadata would expose unnecessary private information.

Decision: Apply one shared validation path to meal and label analysis. Bound encoded request fields before decoding; validate base64 and recognized JPEG, PNG, WebP, or GIF signatures; reject malformed and animated images; enforce decoded 12 MiB and 36-megapixel limits before loading pixels; then orientation-normalize and re-encode only a still JPEG without EXIF or container metadata. Retry matching uses keyed image digests rather than a second JSON serialization of base64 input. Invalid input returns a generic safe error and never reaches the vision client.

Consequences: GIF is accepted only when it represents a single still frame, and successful provider requests receive normalized JPEG bytes rather than original camera or label files. This is an intake boundary, not a consent policy for storing evidence or completed-meal photos; those product controls remain separate work.

## 2026-07-21: Owner-resource denials are non-enumerating and minimally auditable

Status: Accepted

Context: Nutrition history, recipes, private custom foods, sessions, and analysis jobs use guessable path parameters. Returning different outcomes for a missing resource and an owned-by-another-account resource would expose account data through identifier probing, but silently discarding every denied attempt would leave no operational signal.

Decision: Owner-scoped meal, recipe, durable-analysis-job, custom-food, and local-session lookups return the same `404` whether the record is missing or not owned. The shared denial path writes `authorization.owner_access_denied` with only the requesting internal account link, request ID, one-way client fingerprint, and the `not_found_or_not_owned` outcome. It does not retain a resource ID, route parameter, request body, or ownership distinction.

Consequences: Clients cannot distinguish a guessed valid identifier from an unknown identifier, while operators can investigate a safe correlated pattern through restricted audit review. Broader endpoint inventory coverage, production Clerk/Redis deployment validation, append-only receiver validation, and alerting on denial anomalies remain follow-up work.

## 2026-07-21: JWT verification uses PyJWT with an explicit Clerk algorithm allowlist

Status: Accepted

Context: A dependency audit identified that `python-jose` pulled the unpatched `ecdsa` package. The API needs local HMAC token validation and Clerk JWKS verification, but does not need the vulnerable signing implementation. The previous Clerk verifier also reflected the untrusted JWT header's algorithm into its decode allowlist.

Decision: Replace `python-jose` with `PyJWT[crypto]`. Keep local tokens on the existing `HS256` contract, and verify Clerk session tokens only with `RS256` after parsing a matching JWK through PyJWT. Reject any other advertised Clerk algorithm before key lookup or claim processing.

Consequences: Clean dependency audits no longer install `python-jose` or `ecdsa`, and tests cover a valid RS256 Clerk token plus pre-key-lookup rejection of an HMAC token. If Clerk changes its documented session-token algorithm, adding a new algorithm requires an explicit security review and matching test coverage rather than accepting a header-selected value automatically.

## 2026-07-21: CI gates clean dependencies, PostgreSQL migrations, containers, and static analysis

Status: Accepted

Context: Existing CI ran mobile type checking/Jest and API linting/tests, but a fresh release could still contain a vulnerable dependency, an unapplied or PostgreSQL-incompatible migration, or a container build failure. The API package also relied on implicit setuptools discovery, which failed from a clean editable install because Alembic was detected as a second top-level package.

Decision: Configure explicit setuptools discovery for `app*` packages. Make GitHub Actions block high-severity production Node vulnerabilities, audit resolved third-party Python packages, apply every Alembic migration to PostgreSQL and require all heads, and build/scan the API image for fixable high/critical vulnerabilities. Add scheduled CodeQL analysis for Python and TypeScript/JavaScript plus weekly Dependabot updates.

Consequences: A clean checkout now exercises the real production migration dialect rather than only SQLite test fixtures. Local verification also found and corrected the historical Alembic-version-column width before revision `0008`, allowing the full chain to reach current long revision IDs. A path-scoped Android Maestro workflow now also runs fixture-only mobile smoke flows on relevant pull requests and `main` changes with explicit API/Metro readiness checks and failure diagnostics; a first hosted-emulator success must still be reviewed before it is enforced through branch protection. Cloud deployment, registry attestation, protected-branch enforcement, and production release validation remain separate work.

## 2026-07-21: Paid analysis is rate-limited by both IP and verified user

Status: Accepted

Context: A single shared IP budget limits anonymous request bursts, but it cannot prevent one authenticated account from distributing paid image-analysis requests across multiple networks. Conversely, applying scopes one after another can spend an IP budget even when the user budget rejects the request.

Decision: Keep credential routes IP-scoped because their credentials are not yet verified. For paid meal-image and nutrition-label analysis, evaluate an IP check and a verified-user check in one all-or-nothing limiter operation. The preview implementation evaluates capacity before recording any scope; the production Redis implementation does the same in a single Lua script. Derived client and user limiter keys are hashed before Redis persistence, and logging/metrics retain only the stable operation label, decision, request ID, limit, and retry duration.

Consequences: A user cannot bypass the paid-analysis budget by changing networks, and a rejected user scope does not deplete another IP scope. `RATE_LIMIT_ANALYSIS_USER_MAX_REQUESTS` and `RATE_LIMIT_ANALYSIS_USER_WINDOW_SECONDS` are explicit deployment-managed budgets. Real ingress, Redis-replica, dashboard, and alert validation remain required before production release.

## 2026-07-21: Food-record quality is a traceable classification, not a score of nutritional truth

Status: Accepted

Context: Individual provider flags existed for stale data, invalid nutrients, serving conflicts, and duplicate records, but users and mobile logging flows had no consistent answer to whether a record was complete, needs review, unsafe to calculate from, or user-entered. A numeric score would suggest medical certainty and would make provider quality rules opaque.

Decision: Derive a deterministic `qualityAssessment` from a food record's provider and normalized quality flags. It has one status: `complete`, `needs_review`, `insufficient_data`, or `user_entered`; concrete signals identify provider/user origin, stale data, provider conflicts, incomplete per-100g data, serving-basis issues, and validation failures. Only incomplete or invalid essential per-100g data is blocking. Manual Search, Barcode, and Camera Confirmation show the assessment and refuse to save a blocking record. The assessment does not rewrite provider values, meal snapshots, or confidence breakdowns, and is explicitly described as a data-completeness aid rather than a guarantee of nutritional accuracy.

Consequences: The same transparent quality language now applies to live provider records, cached food detail, barcode results, provider replacements, and camera add-ons. Older saved snapshots remain readable even when they predate the field. Provider-specific quality tiers, duplicate-ranking policy, and operational cache-quality analytics remain separate work.

## 2026-07-21: Completed meal photos require explicit confirmation and private lifecycle controls

Status: Accepted

Context: Camera analysis needs temporary normalized images to complete a user review, but a retention-day preference alone is not consent to keep a completed meal photo. Deleting inputs immediately after analysis also prevented an explicit confirmation flow from honoring that preference.

Decision: Keep normalized scan inputs private and temporary through the bounded completed-review window. Failed or cancelled jobs delete inputs immediately. At meal creation, accept an analysis-job reference only from the authenticated owner and copy its inputs into separate `meal_images` records only when that person explicitly selects retention. Apply the stored retention-day deadline to each copy; otherwise delete the temporary inputs after confirmation. Return safe image metadata, authorize a short-lived storage URL only after owner validation, and allow the owner to delete an image without changing the meal's nutrition snapshot. Local preview storage never exposes a network image URL.

Consequences: Retention is a per-meal affirmative action rather than a background default. Offline queued camera meals cannot promise photo retention because the temporary asset may expire before sync, so they retain only confirmed nutrition snapshots. Production still requires a validated private object-store deployment, KMS/credential policy, worker monitoring, and a mobile photo-viewing experience.

## 2026-07-21: Runtime error reporting is opt-in and privacy-minimized

Status: Accepted

Context: Production incident response needs a cross-platform signal for unexpected API and mobile failures, but nutrition, image, account, request, and device data are sensitive. Standard error-reporting defaults can collect request bodies, user context, breadcrumbs, or replay-like data that the product does not need to diagnose this MVP.

Decision: Add optional Sentry-compatible API and mobile runtime hooks. API production configuration requires an HTTPS `SENTRY_DSN`; mobile reporting initializes only in a build with `EXPO_PUBLIC_SENTRY_DSN`. Before transmission, both paths remove request, user, device, breadcrumb, context, and extra payload data, retaining only an approved stable-tag allowlist with request-ID correlation when available. Disable tracing, profiling, replay, session tracking, screenshots, and view-hierarchy capture. Keep Sentry project selection, managed DSNs, alert policy, and release-symbol/source-map upload as deployment work rather than source-controlled defaults.

Consequences: Unexpected failures can be correlated without exposing nutrition records or user/device context to the reporting provider. Production starts fail closed without an API DSN, while local preview remains usable with reporting disabled. Operators must validate a sanitized preview event and configure release artifacts/alerts before treating Sentry as production observability.
