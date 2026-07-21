# API Load, Stress, And Abuse Harness

This directory contains [k6](https://grafana.com/docs/k6/latest/) scenarios for release-readiness evidence. They target a **disposable local or preview environment only**. Never point them at production, a shared development database, a live provider, or a real user account.

Related: [Architecture](../../../docs/Architecture.md), [Current State](../../../docs/Current%20State.md), and the [edge-security runbook](../../../docs/deployment/edge-security-runbook.md).

## What is covered

- `baseline.js`: health, catalog search, food provenance, and authenticated diary reads.
- `mutation-idempotency.js`: source-backed meal creation followed by an identical `Idempotency-Key` replay. It verifies both responses refer to one meal.
- `abuse-resilience.js`: malformed camera and nutrition-label payloads must fail before image processing and must not echo the rejected value. With fixture mode enabled, it also verifies the normal provider-outage `503` envelope.

The scenarios use no real food or AI provider. The default food ID and snapshot are supplied by `E2E_FIXTURE_MODE=true`; use a matching deterministic record when adapting the harness to another fixture service.

## Safety prerequisites

1. Start an isolated API, PostgreSQL, Redis, and analysis worker. Use a throwaway database because `mutation-idempotency.js` creates meals.
2. Set `ENVIRONMENT=development`, `IDENTITY_PROVIDER=local`, `ALLOW_DEV_AUTH=true`, and `E2E_FIXTURE_MODE=true`. Production startup rejects fixture mode.
3. Register a disposable local user and export the returned access token only into the shell running k6. Do not place it in source control or terminal logs.
4. Install k6 locally or use an approved internal k6 container image. The repository intentionally does not download or run a load tool in normal CI.

Example disposable user setup:

```sh
curl --fail --silent --show-error \
  --request POST http://127.0.0.1:8000/api/v1/auth/register \
  --header 'Content-Type: application/json' \
  --data '{"email":"load-test@example.invalid","password":"load-test-password"}'
```

Copy only the `accessToken` value into the next command:

```sh
export LIVING_NUTRITION_LOAD_BASE_URL=http://127.0.0.1:8000
export LIVING_NUTRITION_LOAD_BEARER_TOKEN='replace-with-disposable-token'
export LIVING_NUTRITION_LOAD_EXPECT_FIXTURE_OUTAGE=true

k6 run infrastructure/load/k6/baseline.js
k6 run infrastructure/load/k6/mutation-idempotency.js
k6 run infrastructure/load/k6/abuse-resilience.js
```

Use `LIVING_NUTRITION_LOAD_VUS` and `LIVING_NUTRITION_LOAD_DURATION` to increase a scenario gradually. Start with the defaults; never begin a new environment at high concurrency.

## Initial budgets and evidence

The scripts fail when reads exceed `500 ms` p95, idempotent meal writes exceed `800 ms` p95, any scenario exceeds `1%` failed HTTP requests, or checks drop below `99%`. These are initial guardrails, not a capacity claim. Record the target commit, environment, VUs, duration, API replica count, Redis configuration, database size, output summary, and observed saturation before changing them.

For a release-readiness review, run:

1. Baseline at the expected preview traffic level.
2. Idempotency at a low then increasing write concurrency; confirm no duplicate meal IDs for a repeated key.
3. Abuse/resilience against malformed inputs; confirm no provider calls, leaked payloads, worker errors, or unbounded CPU/memory growth.
4. A Redis outage drill in a dedicated production-like environment; protected routes must return request-correlated `503 rate_limit_unavailable` rather than silently allowing traffic.
5. A provider outage drill with cache fallback and circuit-breaker metrics; retain only aggregated metrics and safe request IDs in the evidence.

Do not treat a local laptop result as production capacity. Multi-replica, trusted-proxy, Redis-failure, provider-outage, and mobile physical-device validation remain required deployment work.
