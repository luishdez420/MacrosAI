# Known Issues

Last updated: 2026-07-09

This document tracks verified issues and risks. See [[Current State]], [[Architecture]], and [[Roadmap]].

## Authentication foundation still lacks production account operations

Severity: High

Status: Partially resolved

Affected area: Backend, mobile profile, user data security

Description: Local register/login now issue short-lived signed JWT access tokens and opaque hashed refresh sessions. Refresh rotates the token and revokes the old session; logout revokes the active refresh session and its access token immediately. Mobile stores both tokens in SecureStore and retries once after refresh. Profile can list active local refresh sessions, identify the current device, and revoke another session. Credential and paid image-analysis routes use configurable process-local rolling-window request limits. Development no-token preview and legacy local-token compatibility are still enabled by default for phone preview, though production configuration refuses them and requires a strong JWT secret. OAuth, password reset/recovery, session naming/device metadata, distributed rate limiting, and a managed identity provider are not implemented.

User or engineering impact: Session handling is materially safer, but the app still lacks key production account and abuse-protection controls for sensitive user data.

Recommended resolution: Add OAuth or managed identity, recovery, session naming/device metadata, a distributed limiter with trusted-proxy policy, and production security review. Disable development compatibility flags in deployed environments.

## Incomplete camera identity confirmation

Severity: High

Status: Partially resolved

Affected area: Camera analysis, meal confirmation, nutrition accuracy

Description: Camera confirmation now requires explicit food confirmation and preparation review before logging, supports model-returned candidate-label search suggestions, in-card provider search replacement, provider-backed sauce/topping add-ons with grams, inline source issue reporting, gram adjustment, added oil/butter grams, structured skin/bone/sauce/cheese/sugar review chips, sauce/topping notes, remove, duplicate, split, mark incorrect, and source review links. Basic source correction reports can also be submitted from food provenance and viewed in Profile history. The camera screen does not yet support advanced candidate ranking, richer add-on management UX, or admin report-management workflows.

User or engineering impact: Users have more control before saving camera results, but visually similar foods and hidden ingredients still need richer candidate ranking, smoother add-on management, and report tracking.

Recommended resolution: Add richer candidate ranking, improved add-on management, and admin report-management workflow before expanding camera automation.

## Incomplete provenance display

Severity: Medium

Status: Partially resolved

Affected area: Mobile nutrition transparency

Description: A dedicated mobile food detail/source provenance screen now exists and is linked from manual search, barcode logging, meal confirmation, and saved meal detail. Basic source correction-report submission and current-user report history exist. Remaining gaps include admin review/status management, richer provider-cache history, and source actions beyond review/reporting.

User or engineering impact: Users can inspect the nutrition source, submit a basic correction report before logging or editing, and see their recent report status, but reports cannot yet be reviewed/resolved by an admin workflow and users cannot see cache/version history.

Recommended resolution: Add admin report-management workflow, provider-cache metadata, and richer provenance actions after camera confirmation is strengthened.

## Direct or insufficiently cached external-provider calls

Severity: Medium

Status: Partially resolved

Affected area: Backend providers, performance, reliability

Description: Barcode lookup checks user-created barcode products and cached Open Food Facts barcode source records before calling external providers. Successful provider search and detail lookups seed normalized source records; exact fresh cached food-name searches can be served without another external provider call; detail lookups check stored records first; stale provider records attempt a safe refresh before falling back to a flagged cached snapshot; search-time duplicate nutrition conflicts are flagged when same-named non-user records disagree substantially; and search can fall back to cached matches if provider search fails after records have been cached. USDA and Open Food Facts now share configurable timeouts and bounded retries for transient network failures, rate limits, and selected server errors. Robust query-level search cache expiration, automatic search/barcode cache refresh, persisted duplicate history, and broader distributed provider outage fallback are not complete.

User or engineering impact: Repeat Open Food Facts barcode scans and repeated detail lookups are more reliable, and stale cache warnings improve transparency, but search speed and many lookup paths still depend on external provider availability and latency.

Recommended resolution: Add query-level search cache expiration policy beyond exact fresh matches, automatic search/barcode refresh, persisted duplicate history, broader provider fallback handling, and tests for remaining failure modes.

## Limited Open Food Facts validation

Severity: Medium

Status: Partially resolved

Affected area: Packaged-food barcode logging

Description: Open Food Facts validation checks required per-100g fields, basic energy/macros consistency, negative raw nutrient values, parsed gram serving basis, serving-vs-per-100g conflicts when the provider supplies both serving and per-100g values, stale cached source age at the API boundary, safe stale detail refresh, and search-time duplicate nutrition conflicts. Richer completeness scoring, persisted duplicate history, automatic search/barcode refresh, and broader community-data validation are still incomplete.

User or engineering impact: Community-contributed package records with conflicting serving data are now visibly flagged and downgraded, but some incomplete or stale records may still appear more reliable than they should.

Recommended resolution: Add completeness scoring, persisted duplicate history, automatic search/barcode refresh, richer confidence explanations, and provider-cache quality history.

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

Description: Basic weight-entry API and Profile logging/history flow exist, including entry editing/deletion, a unit-aware trend graph, and selected-goal-direction feedback. Persisted goal trend integration and richer progress recommendations are not complete.

User or engineering impact: Users can log, edit, view, and delete recent weight entries, see a simple trend, compare it with the selected direction, and view weekly/monthly calorie insight summaries, but richer goal-integrated progress recommendations remain basic.

Recommended resolution: Persist the user's weight-goal direction where appropriate and add richer goal/progress insight integration.

## Incomplete custom-food lifecycle

Severity: Medium

Status: Partially resolved

Affected area: Manual logging, barcode fallback

Description: Backend and mobile support creating, editing, saving, reusing, and logging user-entered per-100g custom foods, including barcode no-match custom products. Nutrition-label capture now performs strict assistive visual extraction, refuses unsafe per-serving conversion without gram weight, shows the local label photo and raw values next to editable normalized values, and requires explicit user confirmation. Remaining gaps include consented stored evidence and richer label verification.

User or engineering impact: Users can manage missing foods manually and are prompted to explicitly confirm manual label review, but package-label verification is still not complete.

Recommended resolution: Add stored label evidence where explicitly consented, evidence deletion/retention controls, and richer verification workflows without elevating extracted values to authoritative status.

## Missing privacy and account-management functionality

Severity: High

Status: Open

Affected area: Privacy, security, compliance readiness

Description: Basic current-user JSON export and local account deletion exist for profile, preferences, goals, weight entries, meals, and saved foods. Register, login, refresh, logout, export, and account deletion create minimal database audit events without credentials, tokens, meal data, images, or raw client IPs. Profile image-retention preference editing exists, but enforcement is not implemented. A process-local limiter now protects credential and paid analysis requests, but production account lifecycle, image deletion, private object storage, distributed request limiting, audit-log review/retention, and immutable audit delivery remain incomplete.

User or engineering impact: Users can inspect/export a JSON snapshot, delete a local account, and state a retention preference, but the product is not ready for production handling of sensitive food photos, meal history, or weight history.

Recommended resolution: Implement production auth first, then production account lifecycle, image controls, retention enforcement, audit-log review/retention, and an immutable external audit sink.

## Incomplete mobile component and end-to-end tests

Severity: Medium

Status: Open

Affected area: Mobile reliability, CI

Description: Backend tests, mobile typecheck, and initial mobile Jest coverage for the food provenance screen, saved-meal source fallback, food provenance presentation, camera confirmation save blocking, barcode no-match screen recovery, barcode cooldown helpers, Home logging-hub rendering, custom-food manual label-review gating, manual-search sticky layout, manual selected-food portion/log controls, progress graph goal-status rendering, saved-food presentation, profile presentation, Profile US/metric unit switching, and floating-tab configuration exist, but most mobile component tests, navigation tests, accessibility tests, and end-to-end tests are still missing.

User or engineering impact: Phone-only regressions in barcode, camera, keyboard, and meal logging flows can slip through.

Recommended resolution: Expand the mobile test runner coverage and add E2E fixtures for manual log, barcode log, camera confirmation, edit meal, and delete meal.

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
