# Known Issues

Last updated: 2026-07-21

This document tracks verified issues and risks. See [[Current State]], [[Architecture]], and [[Roadmap]].

## Android E2E emulator remains unproven and is manual-only

Severity: Medium

Status: Open; removed from automatic preview gating

Affected area: Android fixture E2E workflow and hosted-device coverage

Description: The container-scan and Java prebuild configuration failures are fixed in the regular CI workflow. The separate Android Maestro workflow still cannot complete a stable hosted emulator boot after using POSIX-compatible script setup and the runner-recommended `/dev/kvm` permission configuration. It is retained as a `workflow_dispatch` diagnostic workflow with fixture-only providers, but no longer runs on every push or pull request and therefore cannot block the free Render preview through its `checksPass` trigger.

User or engineering impact: Fixture device coverage is not yet trusted as a release gate. The regular CI workflow continues to require mobile type checks/Jest, API tests/linting, migrations, dependency audits, container scanning, and CodeQL before Render can deploy the free preview.

Recommended resolution: Choose and validate a stable device-test environment before restoring automatic E2E execution. Options include a compatible GitHub-hosted emulator configuration validated from a clean run, a self-hosted runner with managed KVM, or an approved device-farm service. Restore path-scoped automatic execution and consider branch protection only after repeated stable fixture runs. Do not weaken the regular CI security, migration, test, or container-scan gates.

## Free Render preview is intentionally incomplete

Severity: Medium

Status: Accepted constraint

Affected area: Hosted personal testing

Description: The root `render.yaml` provisions only a free sleeping API and temporary free Postgres database. It runs memory-only rate limiting and provider-circuit state, and has no workers, Redis, R2, Sentry, audit delivery, or production monitoring. `AI_FEATURES_ENABLED=false` rejects camera and nutrition-label analysis before images are stored, quota is reserved, or OpenAI is called. The paid production topology remains separately preserved in `render.production.yaml`.

User or engineering impact: Manual/provider-backed flows can be tested without a Render charge, but cold starts are expected, data is not production durable, and camera/label analysis plus retained image workflows are unavailable.

Recommended resolution: Use [[deployment/render-free-preview-setup|the free preview guide]] only for personal validation. Move to [[deployment/render-r2-setup|the paid production topology]] only after an explicit budget decision and the existing security, privacy, proxy, and operational gates are satisfied.

## Sentry reporting is implemented but not provisioned for production

Severity: Medium

Status: Partially resolved

Affected area: API/mobile observability and incident response

Description: The repository has privacy-minimized Sentry-compatible hooks for backend unexpected failures and mobile unexpected API `5xx` failures. They strip request, user, device, breadcrumb, context, and extra payload data; tracing, replay, screenshots, and view-hierarchy capture are disabled. No Sentry project, managed DSN, alert routing, source-map/debug-symbol upload, release artifact pipeline, or deployed redaction evidence is configured in the repository.

User or engineering impact: Until a deployment provisions and validates these settings, unexpected failures remain available through safe API envelopes, structured logs, and protected metrics but are not centrally reported. Stack traces may be incomplete without release artifacts.

Recommended resolution: Create separate managed API and mobile Sentry projects/environments, supply DSNs through deployment/EAS configuration, keep any `SENTRY_AUTH_TOKEN` server-side for release uploads only, add alert ownership, and verify a controlled preview event contains only approved correlation metadata before enabling production alerts. Follow [[deployment/release-runbook|the release and beta runbook]] for the corresponding release evidence.

## Render trusted-proxy validation remains a production deployment gate

Severity: High

Status: Open

Affected area: Production rate limiting and client-address interpretation

Description: The selected Render + Cloudflare R2 architecture has a concrete Blueprint and setup guide, but the API rejects production startup until `TRUSTED_PROXY_CIDRS` contains confirmed direct ingress proxy ranges. Render's outbound IP ranges are not a safe substitute for inbound proxy identity. The repository deliberately does not hardcode an unverified range or broaden trust to all addresses.

User or engineering impact: A production API cannot be safely deployed until Render's ingress behavior is confirmed for the selected topology, or a separate approved ingress layer with documented CIDRs is introduced.

Recommended resolution: Confirm the direct ingress proxy CIDRs with Render for the selected environment, validate spoofed and normal `X-Forwarded-For` traffic in preview, and record the validation in [[deployment/render-r2-setup|the Render and R2 setup guide]] release record.

## Duplicate repository artifacts need an owner-approved cleanup

Severity: Low

Status: Open

Affected area: Repository hygiene and dependency/source-of-truth clarity

Description: `package-lock 2.json` is a tracked historical artifact that differs from the active root `package-lock.json`. `packages/design-tokens/src/index 2.ts` is an untracked duplicate-looking file that differs from the active `index.ts`. Local Expo cache artifacts with similar names are ignored. Python cache directories and bytecode are ignored, and no tracked Python cache file was found during the 2026-07-21 audit.

User or engineering impact: Tooling uses the canonical lockfile and token entry point, but duplicate-looking files can confuse future contributors and make a careless cleanup destructive.

Recommended resolution: Confirm whether the historical lockfile has any intended archival value, then remove it and the untracked duplicate using a reviewed change. Do not delete either automatically while the worktree is shared. New feature pull requests now include a repository-hygiene and documentation checklist in `.github/pull_request_template.md`.

## Generalized idempotency is not yet complete across every mutation

Severity: Medium

Status: Partially resolved

Affected area: Retry safety, paid image analysis, offline synchronization

Description: `POST /meals`, `POST /meal-analysis`, `POST /meal-analysis/jobs`, `POST /foods/label-analysis`, `POST /foods/custom`, `POST /foods/{id}/correction-reports`, `POST /recipes`, and `POST /recipes/{id}/log` now use a database-backed, user-scoped idempotency ledger. Exact replays return the completed response, changed reuse returns `409`, and camera/label-image bytes are never stored in that ledger. Correction-report replays retain only the owned report resource link, then reconstruct the reporter-safe response, so free-form report text is not duplicated into the ledger. Paid AI operations now couple that replay boundary to one durable entitlement/usage record, but the ledger currently has no scheduled retention cleanup, while exports, account-sensitive mutations, updates, and other retry-sensitive operations have not yet adopted it. Durable camera jobs create normalized temporary private inputs, poll safe owner-only state, support cancellation, run through a separate worker, and complete only as review results. The mobile app can resume one account-scoped pending job after restart without retaining its image locally; a user-visible multi-job history remains incomplete.

User or engineering impact: Confirmed meal retries and repeated camera-analysis requests are protected, but an interrupted operation outside these two paths can still duplicate work or require manual recovery. Completed replay records remain until future cleanup work is introduced.

Recommended resolution: Add retention cleanup with an audit-safe policy, extend the ledger to remaining high-risk mutations such as exports and account-sensitive operations, add a complete durable-job history/retry surface, then introduce billing-provider integration before production provider-cost exposure.

## AI quota guard is pre-billing infrastructure only

Severity: High

Status: Partially resolved

Affected area: Camera analysis, nutrition-label capture, provider-cost control

Description: The API now creates a default free entitlement lazily, supports configured free, trial, paid, internal, and disabled tiers, and records each AI reservation, settlement, refund, or expiration without retaining images, prompts, provider responses, nutrition data, or raw idempotency keys. It enforces configurable fixed-window operation/image allowances and a per-user concurrent-analysis limit before vision work starts. It does not yet include a billing provider, customer-facing usage screen, background reconciliation worker, scheduled expired-reservation cleanup, operator dashboard, or production multi-replica validation.

User or engineering impact: Preview and API consumers are protected from accidental duplicate or unbounded camera/label analysis, but entitlement assignment and allowance changes remain administrator/database configuration work. The Premium screen remains non-purchasable.

Recommended resolution: Connect tier changes to a billing/identity source, add a safe account usage surface, scheduled reconciliation and operational metrics, then validate concurrency across PostgreSQL/Redis-backed production replicas.

## Private image storage is a local worker seam, not production retention

**Update 2026-07-21:** Explicit completed-meal photo retention, owner-authorized signed access, and saved-meal photo deletion are now implemented. A camera image remains temporary unless the user chooses to retain it during meal confirmation; a selected image gets an enforceable deadline and deletion retry metadata. The unresolved issue is production operation: configure/validate the S3-compatible private bucket, its credentials/KMS policy, worker deployment, and actual signed URL viewing. The local preview filesystem intentionally cannot serve a photo URL.

Severity: High

Status: Partially resolved

Affected area: Camera analysis, privacy, durable analysis jobs

Description: The API now has a tested local private-filesystem storage abstraction with generated keys, path-traversal protection, atomic writes, private file permissions, and no public URL method. It also supports an S3-compatible backend with server-side encryption and read URLs presigned for at most 15 minutes; production startup rejects local storage or a missing bucket. `meal_images` and `analysis_job_images` hold deletion/retry metadata, account deletion fails safely if cleanup cannot complete, and Docker Compose has bounded analysis, retention, and stale-provider refresh workers. Durable camera jobs store only normalized temporary inputs; a completed meal retains scans only after the user explicitly chooses retention during confirmation. Owner authorization around signed reads and user-facing retained-image deletion are implemented. Cloud-worker deployment validation, actual signed-URL viewing in a deployed app, and a complete multi-job recovery/history experience remain incomplete.

User or engineering impact: The worker can safely process temporary inputs across API restarts and the app can restore one pending review, but users cannot browse, retry, or manage multiple historical analysis jobs.

Recommended resolution: Configure a private S3-compatible bucket and managed credentials, deploy and monitor the retention worker, validate signed-URL viewing on supported devices, and add multi-job recovery/history without weakening the current consented retention boundary.

## Clerk production configuration still needs a live-environment validation

Severity: High

Status: Partially resolved

Affected area: Clerk tenant configuration, mobile development build, backend deployment

Description: Clerk now owns mobile sign-in, sign-up, email verification, password recovery, configured Google OAuth, and managed session storage. FastAPI verifies Clerk tokens through JWKS and maps the verified subject to an internal account; legacy local accounts can be migrated only during a dated, opt-in window. The flow has automated backend authorization/migration coverage and uses a SecureStore token cache, but it has not been exercised against the project's real Clerk tenant in a development build or production deployment.

User or engineering impact: A misconfigured Clerk issuer, JWKS URL, OAuth redirect, email template, or publishable key will prevent users from entering the app. Existing local users also need a clearly communicated migration window before legacy credentials are retired.

Recommended resolution: Create and configure the Clerk application, enable the intended email/password, email-code, and Google flows, register the `livingnutrition://` redirect, set production environment variables, verify the full journey in an EAS development build, and set a short migration deadline only if legacy users must be preserved. The mobile screen asks Clerk which factors the identifier supports, prefers its advertised password factor for email/password accounts, and uses email code only when password is unavailable. A verified sign-up that still requires a supported username, name, or legal-acceptance field stays in the original Clerk sign-up attempt until that account completes; if the user returns to sign in with that email, the screen restores the remembered requirements rather than attempting a factor. Clerk's structured invalid-strategy codes and message variants clear the old attempt before a fresh advertised email-code alternative is considered. The live tenant still needs validation. Add mobile integration/E2E coverage for Clerk screens and Clerk account-linking behavior before production release.

## Public provider-catalog search needs a production access policy

Severity: Medium

Status: Partially resolved

Affected area: Food search, provider abuse controls, API edge security

Description: `GET /api/v1/foods/search` currently searches shared USDA/Open Food Facts catalog data without an authenticated account. It deliberately excludes user-created foods and cannot reveal another user's records. It now has an independent configurable IP-only `RATE_LIMIT_FOOD_SEARCH_*` budget that returns the standard correlated `429` envelope and is hashed in Redis in production. The current [[architecture/authorization-boundaries|Authorization Boundaries]] inventory records this distinction so it is not mistaken for an owner-scoped route. It still does not have an authenticated-user budget because the endpoint is public.

User or engineering impact: The endpoint is bounded against simple client-IP bursts but remains an unauthenticated provider proxy. Shared-network users also share the same budget.

Recommended resolution: Decide whether catalog search must require a Living Nutrition session or should remain public behind the current anonymous budget plus stronger cache, abuse-monitoring, and deployment policy. Record the decision, validate the budget against real provider limits, and include it in the production rate-limit review.

## Production rate-limit deployment validation remains incomplete

Severity: High

Status: Partially resolved

Affected area: API edge security, Redis, deployment

Description: Production configuration now requires Redis-backed limits and a validated `TRUSTED_PROXY_CIDRS` allowlist. The API accepts `X-Forwarded-For` only from a direct peer in that allowlist, resolves the first non-proxy address from the trusted chain, hashes the result before Redis storage, and falls back safely to the direct peer for untrusted or malformed headers. Authentication routes are IP-scoped; paid analysis uses atomic IP and verified-user budgets, and a denied user check cannot consume a separate IP budget. `GET /api/v1/health/ready` checks database/schema plus the configured Redis limiter without exposing connection details, and tests prove shared and multi-key atomic windows across independent limiter instances. A protected Prometheus-compatible `/metrics` endpoint exposes normalized request, latency, rate-limit, and readiness data without client or user data. The chosen hosting platform, its proxy CIDRs, deployed multi-replica Redis validation, metrics collector, dashboards, alerts, and incident response runbook are not yet configured.

User or engineering impact: The application will fail safely rather than start in a production-like configuration without a proxy policy, but it cannot be considered deployment-ready until the real load balancer and Redis behavior are tested under replica and outage conditions.

Recommended resolution: Select the production platform, set its documented proxy CIDRs in managed configuration, provision the dashboards and alerts described in [[deployment/edge-security-runbook|the edge-security runbook]], deploy at least two API replicas with Redis, and record the real `429`/fail-closed `503` validation.

## Load and abuse harness still needs preview-environment evidence

Severity: Medium

Status: Partially resolved

Affected area: Performance, API edge, release validation

Description: `infrastructure/load/k6/` now provides fixture-safe baseline-read, idempotent-meal-retry, malformed-image rejection, and deterministic provider-outage scenarios with initial latency and error-rate thresholds. It intentionally requires a disposable local or preview environment, a test-only account, and fixture-mode providers; it is not a production workload and is not run in normal CI. The harness has not yet been executed against multiple API replicas, a shared Redis limiter, a real proxy, or a production-like object-storage/worker topology.

User or engineering impact: The repository now has a repeatable starting point for catching retry, validation, and outage regressions under modest concurrency, but it does not prove capacity or release readiness yet.

Recommended resolution: Run the documented scenarios against an isolated preview environment, retain the safe aggregate output and environment metadata, then add controlled Redis/provider outage drills and record the observed saturation thresholds in the release checklist.

## Incomplete camera identity confirmation

Severity: High

Status: Partially resolved

Affected area: Camera analysis, meal confirmation, nutrition accuracy

Description: Camera capture supports one photo or up to three complementary meal views, and confirmation requires explicit food confirmation and preparation review before logging. Each detected item now includes a conservative visible-portion range, optional visible-preparation cue, possible hidden-ingredient prompts, and up to three provider-backed alternative records. The analysis preserves sanitized per-view visible-label support, orders alternate suggestions by that support, and surfaces corroborated, conflicting, single-view, or unavailable evidence in the confirmation screen. This is deliberately a review aid: corroboration never raises confidence, while conflicting views lower identity confidence and require user choice. It also supports candidate-label search suggestions, in-card provider search replacement, and source-backed sauce/topping multi-adds. Add-ons start as a compact calorie/source-quality summary and expand for search, favorite/recent reuse, source review, portion changes, removal, or accessible up/down ordering; every selected add-on starts with blank grams and cannot be logged until the user enters an amount. Common dressing, cheese, avocado, and butter shortcuts prefill a provider search but cannot add nutrition without a user-selected record and explicit grams. Inline source issue reporting, gram adjustment, added oil/butter grams, structured skin/bone/sauce/cheese/sugar review chips, sauce/topping notes, remove, duplicate, split, mark incorrect, and source review links are also available. Multiple views cannot establish hidden ingredients, exact portions, or cooking details. Source correction reports can be submitted from food provenance, viewed in Profile history, and triaged through the restricted staff workflow. Reusable add-on groups and batch-selection refinements remain pending.

User or engineering impact: Users can add several source-backed items without every add-on search crowding the confirmation screen, reuse saved sources, and cannot accidentally save a default portion. Visually similar foods across images, hidden ingredients, reusable add-on grouping, and batch selection still need more work.

Recommended resolution: Validate the new cross-image wording with users and add ambiguity fixtures from real, consented test data. Build reusable add-on groups or batch-selection refinements before expanding camera automation.

## Incomplete provenance display

Severity: Medium

Status: Partially resolved

Affected area: Mobile nutrition transparency

Description: A dedicated mobile food detail/source provenance screen now exists and is linked from manual search, barcode logging, meal confirmation, and saved meal detail. It includes a bounded timeline of meaningful external provider-record changes, separate from immutable saved-meal snapshots. Source correction-report submission, safe current-user status history, and Clerk-allowlisted server-only staff triage/resolution exist. Remaining gaps include moderation policy/SLA, notification delivery, richer cache analytics, and source actions beyond review/reporting.

User or engineering impact: Users can inspect the nutrition source and recent source-data changes, submit a correction report before logging or editing, and see safe status changes. Staff can triage and link a corrected source revision without seeing a reporter identity in the review list. Source history remains limited to the five most recent meaningful provider snapshots.

Recommended resolution: Define moderation SLA and notification delivery, then add richer cache analytics and provenance actions after camera confirmation is strengthened.

## Direct or insufficiently cached external-provider calls

Severity: Medium

Status: Partially resolved

Affected area: Backend providers, performance, reliability

Description: Barcode lookup checks user-created barcode products and cached Open Food Facts barcode source records before calling external providers. Stale exact barcode and Food Detail records claim a database-backed refresh lease before contacting a provider; while another replica holds the lease or a prior request has backed off, the flagged cached snapshot remains available. A provider failure or no match records jittered exponential backoff, and a later successful refresh clears it. The independently runnable `food-source-refresh-worker` periodically considers an oldest-first bounded batch of eligible stale non-user provider records and invokes that same lease/backoff path. It does not prefetch arbitrary search queries, refresh custom foods, or rewrite meal snapshots. Successful provider search and detail lookups seed normalized source records. Successful searches also persist a bounded query-to-source-record index, including no-result responses, so complete fresh partial-query results do not repeat provider calls; it stores IDs rather than nutrition values, expires after `FOOD_SEARCH_CACHE_TTL_SECONDS`, and is bypassed if a referenced record is stale or missing. Search-time duplicate nutrition conflicts are flagged when same-named non-user records disagree substantially; and search can fall back to cached matches if provider search fails after records have been cached. USDA and Open Food Facts share configurable timeouts and bounded retries for transient network failures, rate limits, and selected server responses. A shared Redis circuit breaker is required in production: it records only transient provider failures, opens before repeat retry storms, permits one half-open recovery probe, and lets the registry continue to a configured fallback. If no provider completes a live lookup and no cached response is available, the API returns a safe `503` error envelope rather than an unexpected server error. The protected metrics endpoint records low-cardinality provider outcomes/latency/circuit state and cache hit, refresh, and fallback events without retaining food queries or barcodes. Query-cache prefetching, deployed outage validation, and dashboard/alert operation are not complete.

User or engineering impact: Repeat Open Food Facts barcode scans and repeated detail lookups are more reliable, and stale cache warnings improve transparency, but search speed and many lookup paths still depend on external provider availability and latency.

Recommended resolution: Feed the existing provider/cache telemetry into dashboards and alerts, validate Redis circuit recovery across deployed replicas, then decide whether query-cache prefetching is justified and add tests for remaining failure modes.

**Update 2026-07-21:** The prior references to missing persisted duplicate history, automatic stale-record refresh, and a general completeness classification are superseded. Same-name non-user source records that substantially disagree create durable provider-only evidence with first/last detection timestamps. Food Detail recomputes whether the disagreement is current from the latest cached records and retains aligned records as historical context. The bounded stale-provider refresh worker uses the same request-safe lease/backoff rules and preserves stale snapshots on failure. Every current food record now exposes a deterministic complete/review/insufficient/user-entered assessment with traceable signals; incomplete or invalid essential per-100g records are blocked from logging. Provider-specific quality tiers, query-cache prefetching, deployed outage validation, and dashboard/alert operation remain incomplete.

## Limited Open Food Facts validation

Severity: Medium

Status: Partially resolved

Affected area: Packaged-food barcode logging

Description: Open Food Facts validation checks required and parseable per-100g fields, basic energy/macros consistency, negative raw nutrient values, parsed gram serving basis, and serving-vs-per-100g conflicts when the provider supplies both serving and per-100g values. USDA also checks that the source payload contains energy, protein, carbohydrate, and fat identifiers. A malformed or incomplete core nutrient field is visibly flagged, classified as `insufficient_data`, and blocked from logging rather than silently becoming zero; a descriptive serving without a verified mass is visibly flagged but remains reviewable for direct gram logging. Stale cached source age, database-backed request-safe and scheduled stale-provider refresh backoff, and search-time duplicate nutrition conflicts are handled at the API boundary. Provider-specific quality tiers, query-cache prefetching, and broader community-data validation are still incomplete.

User or engineering impact: Community-contributed package records with incomplete essential nutrition now cannot be logged, while stale, conflicting, or uncertain-serving records remain visible with a plain-language review state. Provider-specific freshness and completeness policy is still deliberately conservative rather than a medical-quality score.

Recommended resolution: Define provider-specific quality tiers and duplicate-ranking policy, add richer confidence explanations, evaluate query-cache prefetching only if it is cost-justified, and operate provider-cache quality history through dashboards.

**Update 2026-07-21:** The prior references to missing persisted duplicate history, automatic stale-record refresh, and a general completeness classification are superseded. Open Food Facts conflicts can be retained and presented as current or historical provider-source evidence, while the bounded worker refreshes eligible stale provider records under the same lease/backoff policy. The shared quality assessment now exposes the reason for complete, review, insufficient, or user-entered status. Provider-specific quality tiers, query-cache prefetching, richer confidence explanations, and broader community-data validation remain incomplete.

## Limited saved-food organization

Severity: Medium

Status: Partially resolved

Affected area: Manual logging speed, backend API, mobile UX

Description: Favorite foods can be added/removed from food provenance, displayed in Manual Search, searched/filtered/sorted in Saved Foods, individually removed, and bulk cleared for visible results. Recent foods are automatically persisted from logged meal items, displayed in Manual Search, searchable/filterable/sortable in Saved Foods, individually removable, and bulk clearable for visible results. Richer saved-food organization controls are not complete.

User or engineering impact: Repeat logging is faster and saved foods are easier to find, sort, and clear, but saved-food management is still basic.

Recommended resolution: Add richer saved-food grouping and explicit organization controls.

## Limited weight-tracking workflow

Severity: Medium

Status: Partially resolved

Affected area: Goals and progress tracking

Description: Basic weight-entry API and Profile logging/history flow exist, including entry editing/deletion, a unit-aware trend graph, and a persisted maintain/cut/gain direction. Progress now shows an optional selected-period pattern from saved entries, but it is client-side, descriptive only, and has no comparative or coaching model.

User or engineering impact: Users can log, edit, view, and delete recent weight entries, see a simple trend, compare it with the selected direction, and view selected-range/monthly nutrition summaries, but richer goal-integrated progress recommendations remain basic.

Recommended resolution: Add richer comparative trends only after defining data-quality thresholds and continue avoiding medical conclusions from short-term changes.

## Limited hydration workflow

Severity: Low

Status: Partially resolved

Affected area: Today dashboard and user-data portability

Description: Today supports a user-owned daily hydration total with quick additions, exact whole-milliliter adjustment, retry, clearing, export, and account deletion. It intentionally has no default target or medical guidance. Profile now also supports one optional, local daily reminder with explicit permission, an editable local time, and direct cancellation. Native delivery needs physical-device validation; history, trends, insight integration, and offline queuing are not implemented.

User or engineering impact: Users can keep a lightweight daily water log and choose one non-pressuring device reminder, but cannot review hydration patterns or rely on the log while disconnected. The absence of a target avoids unsupported individualized claims, but also means hydration is not integrated with goals.

Recommended resolution: Validate the basic daily-total workflow and native reminder delivery with users before adding history or insight features, and keep any future guidance non-medical and user-configurable.

## Historical goal interpretation in insights

Severity: Medium

Status: Resolved on 2026-07-12

Affected area: Progress ranges, nutrition goals

Description: This issue was resolved by making `PUT /goals` create or update an effective-date revision and by returning the calorie target effective on every insight day. The Progress chart now renders the daily target path and goal-day status against the historical target rather than applying a newer target retroactively.

User or engineering impact: Historical calories, protein, fiber, target paths, and goal-day counts are now evaluated against the target active on each date. Future work still needs weight-integrated progress interpretation and comparative insight periods.

Recommended resolution: No additional remediation is required for historical calorie-target interpretation. Build weight-integrated coaching and comparison periods as separate product work.

## Incomplete custom-food lifecycle

Severity: Medium

Status: Partially resolved

Affected area: Manual logging, barcode fallback

Description: Backend and mobile support creating, editing, saving, reusing, and logging user-entered per-100g custom foods, including barcode no-match custom products. Nutrition-label capture now performs strict assistive visual extraction, refuses unsafe per-serving conversion without gram weight, shows the local label photo and raw values next to editable normalized values, requires explicit user confirmation, and keeps recoverable capture/import/extraction failures inline with manual-entry recovery. Remaining gaps include consented stored evidence and richer label verification.

User or engineering impact: Users can manage missing foods manually and are prompted to explicitly confirm manual label review, but package-label verification is still not complete.

Recommended resolution: Add stored label evidence where explicitly consented, evidence deletion/retention controls, and richer verification workflows without elevating extracted values to authoritative status.

## Missing privacy and account-management functionality

**Update 2026-07-21:** The prior statement that completed-meal photo retention and user image controls were missing is superseded. Users can opt in to retaining a confirmed camera scan for their chosen duration, delete retained photos from saved-meal detail, and use owner-scoped expiring storage access when a private object store is configured. The versioned export flow now requires recipient acknowledgement before sharing sensitive data. Audit events now have a signed external-delivery outbox with bounded retries, but the deployment still must select and validate an append-only/WORM receiver. Managed identity deletion coordination, approved audit-retention duration, and production deployment validation remain open.

Severity: High

Status: Partially resolved

Affected area: Privacy, security, compliance readiness

Description: Dedicated Data Controls provides a current-user JSON export summary, typed Living Nutrition profile deletion, explicit completed-meal-photo retention duration, an owner-only recent security-activity list, and native JSON sharing. The export file exists only in the mobile cache during the sharing operation and is removed afterward; the app does not control handling by a selected recipient. Activity rows expose only an event label, outcome, and timestamp; request IDs, client fingerprints, credentials, tokens, meal data, images, and raw client IPs remain internal. Temporary normalized analysis inputs are privately stored and cleaned up after failure, cancellation, user discard/retake, confirmation, or expiry. A confirmed camera review can retain its scans only after a separate explicit choice; retained images use owner-scoped expiring access when configured storage supports it and can be deleted without changing meal snapshots. Profile deletion removes any remaining private image assets from Living Nutrition or fails safely when cleanup cannot complete; it does not delete a managed Clerk identity. Register, login, refresh, logout, export, profile deletion, and administrator audit review create minimal database audit events. A server-side audit-review endpoint is restricted to configured Clerk subjects and returns no account identifiers, emails, or fingerprints. Each event now creates a durable delivery outbox row; production requires an HTTPS HMAC-signed webhook receiver, retries delivery with bounded backoff, and does not purge an undelivered row. The envelope excludes account links, client fingerprints, credentials, nutrition, image, and request-body content. The product still lacks a selected and validated append-only/WORM receiver, an approved policy duration, and deployment evidence. Credential and paid analysis requests use process-local limits only in local preview; production configuration requires atomic Redis shared limits and fails closed when Redis cannot decide. Production account lifecycle, managed-identity deletion coordination, trusted-proxy deployment validation/monitoring, audit-retention policy approval, append-only receiver validation, and production object-storage validation remain incomplete.

User or engineering impact: Users can inspect and share a JSON export, delete a local account after an explicit typed confirmation, explicitly retain or delete scan photos under the documented owner-only lifecycle, but cannot control a recipient after sharing. The product is not ready for production handling of sensitive food photos, meal history, or weight history until cloud storage and production lifecycle controls are validated.

Recommended resolution: Select and validate a managed append-only/WORM audit receiver, configure its HTTPS endpoint and HMAC secret through managed secrets, verify delivery/retry and receiver retention in preview, approve and configure the audit-retention schedule, validate production object storage and managed-identity lifecycle, and complete the production privacy/security review.

## Incomplete mobile component and end-to-end tests

Severity: Medium

Status: Open

Affected area: Mobile reliability, CI

Description: Backend tests, mobile typecheck, and initial mobile Jest coverage for the food provenance screen, saved-meal source fallback, food provenance presentation, saved-meal portion/replacement/addition/removal save behavior, camera capture/import recovery, camera confirmation save blocking and multi-view payload/snapshot behavior, multi-angle capture bounds, barcode no-match screen recovery, barcode cooldown helpers, Manual Search provider-outage and offline-queue recovery, manual-search and barcode accessible labels/states, Home logging-hub rendering, custom-food manual label-review gating, manual-search sticky layout, manual selected-food portion/log controls, Saved Foods filtering/source actions, Meal Builder search/add/portion/save behavior, Recipe Library edit/log actions, Natural Entry parsing/selection/logging, progress graph/day selection/month navigation, saved-food presentation, profile presentation, Profile US/metric unit switching, and floating-tab configuration exist. A path-scoped Android Maestro workflow uses a production-contract fixture provider and fixture camera input to cover manual logging, barcode no-match recovery/successful logging, provider-outage search recovery, camera confirmation, Meal Builder, custom-food logging, saved-meal editing/deletion, account-scoped SQLite queue replay, and typed local-profile deletion. It runs for relevant pull requests and `main` changes, verifies API and Metro readiness, and uploads service/Android diagnostics when it fails. The queue fixture is compiled only into the dedicated test build and validates the real replay/idempotency path; automatic transport-failure queuing remains a unit-tested branch, not device coverage. Local profile deletion does not delete a managed Clerk identity. Fixture modes are rejected by production API configuration. CI also runs high-severity production Node auditing, third-party Python auditing, PostgreSQL migration application, API container build/scanning, and CodeQL. Backend covers unauthenticated camera-analysis rejection and two-account resource isolation for meal/recipe detail, mutations, and collections; nested analysis-job confirmation cannot create a cross-account meal; date-keyed weight/hydration updates; custom-food detail/list/mutations/favorites/reports; saved-food links; diary/range insights; report history; goals; preferences; session revocation; and exports. [[architecture/authorization-boundaries|Authorization Boundaries]] records the current route inventory. The Android workflow has not yet completed its first hosted-emulator validation, while systematic BOLA coverage for every owner-scoped endpoint and broader mobile navigation/accessibility/device coverage remain incomplete.

User or engineering impact: Phone-only regressions in barcode, camera, keyboard, and meal logging flows can slip through.

Recommended resolution: Record and investigate the first hosted Android-emulator run, then mark the existing path-scoped workflow as a required branch-protection check if it remains stable. Add deterministic device fixtures for Clerk sign-in/recovery/deletion, true offline/reconnect, and custom-food editing. Camera-permission recovery now uses the real denied/ungranted camera screen and its Manual Search fallback. Rate-limit recovery uses a fixture-only `429` that reproduces the production envelope and retry header without sharing mutable capacity across smoke flows. A durable queue now supports confirmed Manual Search, Barcode, Natural Entry, Meal Builder, Camera Confirmation, and already-saved Custom Food meal snapshots; it intentionally excludes camera images/new analysis requests, custom-food creation, automatic retry policy, and conflict handling.

## React Native test-harness warning in Custom Food query loading

Severity: Low

Status: Resolved 2026-07-21

Affected area: Mobile Jest tests, React Query, Custom Food screen

Description: A Custom Food deletion-confirmation test allowed its asynchronous React Query mutation to finish after the interaction's `act(...)` boundary, producing a React 19 environment warning. The test now awaits the confirmation mutation and its immediate query invalidation within that boundary; the full mobile Jest suite completes without this warning.

User or engineering impact: No runtime user impact. CI output is now clear enough to expose new asynchronous test warnings.

Recommended resolution: Keep asynchronous mutations and query invalidations inside awaited test interactions. Do not suppress `console.error` globally; investigate any newly emitted act warning as a test-sequencing defect.

## FastAPI synchronous test-client deprecation warning

Severity: Low

Status: Resolved 2026-07-21

Affected area: Backend test harness

Description: The secure FastAPI/Starlette dependency range emitted an upstream `StarletteDeprecationWarning` while backend tests imported `fastapi.testclient.TestClient`. The suite now uses a small synchronous test helper over HTTPX's supported ASGI transport. It creates and closes an `AsyncClient` for each synchronous request, preserves the existing response/error behavior, and intentionally does not run application lifespan hooks implicitly because the previous non-context-manager client usage did not do so either.

User or engineering impact: No runtime product behavior changed. Backend CI output is warning-free without weakening the secure dependency range.

Recommended resolution: Keep new synchronous API tests on `tests.http_client.ApiTestClient`. Add explicit lifespan coverage if a future test requires startup/shutdown behavior rather than assuming it.

## Premium design system is not yet a complete adaptive theme or screen inventory

Severity: Medium

Status: Partially resolved

Affected area: Mobile design system, accessibility, product completeness

Description: The current mobile app now has a shared material system, Expo Blur-backed glass surfaces with runtime opaque reduced-transparency fallbacks, a semantic light/dark palette, root ThemeProvider, persisted `system`/`light`/`dark` user preference, theme-aware shared materials/macro ring/navigation, a configured native light/dark leaf-mark splash plus a branded structural in-app launch state, Onboarding and Profile appearance controls, a dedicated Accessibility route that reads and subscribes to device text-scale, reduced-motion, reduced-transparency, and screen-reader status without pretending to override it, theme-aware Today, daily nutrient detail, Progress, Manual Search, Barcode, Saved Foods, Meal Builder, Custom Food, Recipe Library, Natural Entry, the complete food-provenance route, saved-meal detail editor, the core Meal Confirmation review/replacement/add-on flow, and a read-only Premium preview that clearly separates current free tools from planned membership directions. Camera can optionally pass a known 25 cm, 28 cm, or 30 cm visible round-plate cue into review, but it remains a visual prompt rather than a calibration or precision claim. Barcode, Food Detail, Manual Search, saved-meal detail, Recipe Library, Progress date-range controls, and daily nutrient detail have deterministic dark-palette regression tests for key actions, placeholders, selections, and saved-data emphasis. Camera capture labels manual alternatives and explains the limitation of one or multiple photographs; Meal Confirmation labels correction, provider-search, report, and add-on controls with accessible expandable states/input hints and meets the 44px minimum for those compact review actions. Saved Foods filter/sort, Profile unit/direction, onboarding logging/camera settings, Meal Builder category choices, and Natural Entry source-record choices now expose selected-state semantics; Meal Builder time presets and destructive recipe/meal actions include clear spoken context, and all of those compact controls meet the 44px target. The daily nutrient-detail route displays saved calories, macros, fiber, sugar, sodium, user-configured targets, and meal contributions without inferring medical targets. Meal Confirmation's inputs, candidate selectors, source/report actions, warning and destructive controls, and selected accessibility states now use semantic palette values. Premium Today/Scan/Review/Search/Progress core flows, a five-destination floating navigation, reduced-motion-safe camera and macro-ring behavior, visible source/confidence language, locally persisted onboarding goal framing, explicitly accepted nutrition targets, logging/dietary preferences, and a source-backed Meal Builder with duplicate plus accessible persisted reordering and reusable recipe save/edit/log/delete also exist. The optional onboarding target is a disclosed general-wellness estimate and not medical advice. Dietary preferences are currently reference-only: they do not filter provider records or verify ingredients/allergens. The backend now has a pre-billing entitlement guard, but the app still has no purchases, billing-provider integration, customer-facing quota management, or entitlement UX. Several remaining feature-local styles, a full dynamic-type and VoiceOver audit, dietary-aware provider filtering with reliable validation, richer recipe organization, connected services, offline flow, and the remaining screen inventory are not implemented.

Update 2026-07-14: The earlier reference to missing drag reordering is superseded. Meal Builder now reorders live as its drag handle crosses item boundaries, provides selection feedback, and keeps explicit move-up/move-down controls for screen readers and reduced-motion users. Richer physics-based list layout animation remains a refinement, not a missing basic interaction.

User or engineering impact: The core experience is more coherent and premium, but the product should not be represented as a complete adaptive premium app across every requested screen or accessibility preference yet.

Recommended resolution: Convert each remaining feature-local style group to semantic theme values, complete contrast/VoiceOver/dynamic-type audits in both modes, then build the remaining product screens in roadmap slices backed by actual API capabilities.

## Development build is configured but not yet cloud-validated

Severity: Low

Status: Open

Affected area: Mobile delivery, physical-device testing

Description: `expo-dev-client` is installed in the mobile workspace, `apps/mobile/eas.json` has physical-device development, internal preview, and production profiles, and `npm run dev:device` starts Metro in development-client mode with the schema-ready local API. The repository deliberately has no EAS project ID, Expo account link, signing credentials, or completed cloud build.

User or engineering impact: Expo Go remains available for quick LAN testing, but the development-client path cannot be installed on a physical device until the project owner links EAS and completes the first iOS/Android build.

Recommended resolution: Run `npx eas-cli@latest init` from `apps/mobile` under the intended Expo account, build the development profile for the target platform, install it, and record the validated build workflow without committing credentials.

## Documentation drift

Severity: Medium

Status: In progress

Affected area: Project planning, contributor onboarding

Description: Some docs previously described implemented features as missing and referenced documents that did not exist.

User or engineering impact: Future work can target stale priorities or duplicate already-completed work.

Recommended resolution: Keep [[Current State]], [[Architecture]], [[Roadmap]], [[Decisions]], and this document updated after meaningful implementation changes.

## Generated Python cache files present locally

Severity: Low

Status: Open

Affected area: Source-control hygiene

Description: `__pycache__` directories and `.pyc` files are present under `apps/api` locally.

User or engineering impact: Generated files can clutter status output or accidentally enter source control if ignore rules are incomplete.

Recommended resolution: Keep `__pycache__/` and `*.py[cod]` ignored. If generated files are tracked in Git, remove them from tracking without deleting local copies using `git rm --cached -r apps/api/app/__pycache__ apps/api/tests/__pycache__`.
