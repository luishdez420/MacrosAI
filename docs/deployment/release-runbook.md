# Release And Beta Runbook

Last updated: 2026-07-21

Related: [[../Architecture|Architecture]], [[../Current State|Current State]], [[../Known Issues|Known Issues]], [[edge-security-runbook|Edge Security Runbook]].

This runbook defines the repository-controlled release process. It does not select a cloud host,
Expo account, Apple team, Android signing account, Sentry project, or production secret manager.
Those are required operator inputs and must be recorded in the deployment release record rather than
committed to the repository.

## Environment Contract

| Environment | API identity and data | Mobile build | Intended use |
| --- | --- | --- | --- |
| Local preview | Local or dedicated preview database; development identity compatibility only | Expo Go or development client | Day-to-day development; never production data |
| Development device | Isolated development API/database/Redis and non-production Clerk tenant | EAS `development` profile | Physical-device debugging |
| Preview | Isolated preview API, PostgreSQL, Redis, Clerk tenant, and object storage | EAS `preview` profile | Internal QA and controlled beta validation |
| Production | Managed API, PostgreSQL, Redis, Clerk production tenant, approved object storage, audit receiver, and monitoring | EAS `production` profile | Customer release |

Never share databases, Redis key prefixes, object-storage buckets, Clerk tenants, audit receivers,
or Sentry environments between preview and production.

## Required Managed Configuration

Before a preview or production deployment, provision values outside source control for:

- API: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, provider keys, Clerk verification values,
  `TRUSTED_PROXY_CIDRS`, metrics bearer token, audit retention/delivery values, approved storage
  configuration, and `SENTRY_DSN` when reporting is enabled.
- Mobile build: `EXPO_PUBLIC_API_URL`, Clerk publishable key, and optional public Sentry DSN and
  environment. Public mobile configuration must never contain API keys, Clerk secrets, database
  URLs, audit secrets, or a Sentry release-upload token.
- Release artifacts: keep a `SENTRY_AUTH_TOKEN`, if needed for source maps/debug symbols, in the CI
  or EAS secret manager only after a Sentry project and release workflow are selected.

Use the complete edge requirements in [[edge-security-runbook|Edge Security Runbook]] for production
rate limiting, proxy policy, audit delivery, readiness, metrics, and incident response.

## API Release Checklist

1. Confirm all required CI checks are green, including type checks, tests, migration validation,
   dependency audits, CodeQL, container scan, repository-hygiene guard, and applicable Android
   Maestro smoke test.
2. Build the exact API container image that will be deployed and retain its immutable digest in the
   release record.
3. Run Alembic migrations once against the target environment before rolling out application
   replicas. Do not use automatic production schema changes as a substitute for reviewed migration
   execution.
4. Deploy the API and each required worker with the same reviewed image/version as appropriate.
   Current workers are meal analysis, image retention, and food-source refresh.
5. Confirm `GET /api/v1/health/ready` returns `200` through the intended ingress and that the
   protected root `/metrics` scrape works only from the collector network.
6. Validate Clerk token verification, trusted-proxy behavior, Redis-backed request limiting,
   provider circuit behavior, audit delivery, and approved object-storage access using preview data.
7. If Sentry is enabled, validate one controlled preview error and confirm its event contains only
   approved correlation tags. Configure source maps/debug symbols separately before relying on stack
   traces.

## Mobile Build And Beta Checklist

1. Run `npx eas-cli@latest init` from `apps/mobile` under the intended Expo account before the
   first cloud build. Record the project linkage and signing owner outside source control.
2. Build the selected profile: `development` for device debugging, `preview` for internal QA, or
   `production` for store submission. Do not use Expo Go as evidence for native release behavior.
3. Install the build on a supported physical iOS and Android device. Record OS version, build ID,
   API environment, and tester in the release record.
4. Exercise: Clerk sign-up/sign-in/recovery, manual food logging, barcode no-match recovery,
   camera confirmation, custom-food logging, saved-meal edit/delete, account data controls, and
   sign-out. Use fixture mode only in dedicated E2E builds, never a beta or production build.
5. Confirm camera/photo-library permissions, local hydration reminder permission/cancellation, dark
   mode, large text, reduced motion, network loss/retry guidance, and application relaunch behavior.
6. Check that every build points to its intended API environment and that no development, fixture,
   local-identity compatibility, or local-storage setting is present in a production release.

## Rollback Procedure

1. Stop rollout when readiness fails, unexpected error rates rise, a privacy boundary is violated,
   or a critical mobile flow cannot complete.
2. Record the deployed API image digest, mobile build identifier, request IDs, affected environment,
   and safe symptoms. Do not copy meal, image, token, account, or raw-client data into release notes.
3. Roll back API replicas to the previously validated immutable image. Do not roll back a database
   migration destructively without a separately reviewed migration recovery plan.
4. Disable a problematic mobile update/channel only through the configured Expo release controls;
   mobile store builds may require a replacement build rather than a server-side rollback.
5. Verify readiness, metrics, safe error reporting, and a minimal manual logging flow after rollback.
6. Create a follow-up issue with root cause, scope, remediation, and required test coverage.

## Release Record

For every preview or production release, retain a private release record with:

- API image digest and migration revision.
- Mobile EAS build IDs, channels, signing owner, and supported-device validation evidence.
- Environment name, deploy time, approver, and rollback target.
- Proxy CIDRs, Redis/object-storage/audit-delivery validation date, and monitoring dashboard/alert
  owners.
- Sentry project/environment, DSN provisioning confirmation, and sanitized-event validation result.
- Known limitations accepted for the release and any follow-up owners.

## Current Limitations

The repository includes EAS profile definitions and fixture-based Android smoke automation, but no
EAS project linkage, signing configuration, hosted API environment, production secret manager,
managed collector, dashboard, alert service, or physical-device release evidence. These remain
release-blocking operational work, not completed capabilities.
