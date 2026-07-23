# Edge Security Runbook

Last updated: 2026-07-21

Related: [[../Architecture|Architecture]], [[../Current State|Current State]], [[../Known Issues|Known Issues]], [[../api/endpoints|API Endpoints]].

This is a platform-neutral runbook for the production API edge. It documents the controls implemented in the repository. It does **not** claim that a hosting provider, proxy CIDR range, Redis service, dashboard, or alert channel has been selected or deployed.

## Production Preconditions

Before a production deployment, operators must set managed environment variables rather than committing them:

- `ENVIRONMENT=production`
- `RATE_LIMIT_ENABLED=true`
- `RATE_LIMIT_BACKEND=redis`
- `REDIS_URL` pointing to the managed, TLS-enabled Redis service where supported by the selected provider
- `RATE_LIMIT_REDIS_KEY_PREFIX` unique to the deployment environment
- reviewed `RATE_LIMIT_FOOD_SEARCH_*`, `RATE_LIMIT_AUTH_*`, `RATE_LIMIT_ANALYSIS_*`, and `RATE_LIMIT_ANALYSIS_USER_*` values appropriate for expected authenticated-catalog, authentication, and paid-analysis abuse scenarios
- `NUTRITION_PROVIDER_CIRCUIT_BREAKER_BACKEND=redis`
- `NUTRITION_PROVIDER_CIRCUIT_BREAKER_REDIS_KEY_PREFIX` unique to the deployment environment
- `TRUSTED_PROXY_CIDRS` containing only the direct load-balancer/reverse-proxy CIDRs documented by the selected platform
- `METRICS_ENABLED=true`
- `METRICS_BEARER_TOKEN` provided by managed secrets and used only by the private metrics collector
- `BACKGROUND_WORKER_HEARTBEATS_REQUIRED=true` and a `BACKGROUND_WORKER_HEARTBEAT_TTL_SECONDS` value longer than the meal-analysis, image-retention, and food-source-refresh worker poll intervals
- `AUDIT_LOG_RETENTION_DAYS` selected through the approved privacy/operations policy
- `AUDIT_DELIVERY_BACKEND=webhook`, `AUDIT_DELIVERY_WEBHOOK_URL` using HTTPS, and `AUDIT_DELIVERY_HMAC_SECRET` from managed secrets. The receiver must be a deployment-approved append-only/WORM destination.
- Clerk production identity values and production S3-compatible storage values required by the application configuration

Production startup rejects memory rate limiting, memory-only provider-circuit state, disabled rate limiting, an empty proxy allowlist, local identity compatibility, and local image storage. Do not work around these validations.

## Forwarded-Header Contract

Only `X-Forwarded-For` is used. The API accepts it only when the direct socket peer is inside `TRUSTED_PROXY_CIDRS`.

1. The proxy must append the connecting peer to `X-Forwarded-For` and preserve the chain.
2. The API walks the chain right to left and selects the first address outside the trusted proxy ranges.
3. Missing, malformed, untrusted, or entirely trusted chains use the direct peer instead.
4. The RFC `Forwarded` header is intentionally ignored.

Never use a broad range such as `0.0.0.0/0`. Revalidate the platform CIDRs whenever the load balancer, CDN, or ingress configuration changes.

## Readiness And Monitoring

Use `GET /api/v1/health/ready` for a readiness probe. It checks database/schema readiness, the shared limiter, the shared provider-circuit state when configured for Redis, and the aggregate anonymous liveness of the three required workers when heartbeat enforcement is enabled. It returns:

- `200` only when the checked dependencies are ready.
- `503` with a request ID and dependency categories, never connection strings or Redis error details.

Create alerts for:

- Any sustained `503` response from `/api/v1/health/ready`.
- `rate_limit_backend_unavailable` structured log events.
- A sharp rise in `rate_limit_denied` events by policy.
- Failed Prometheus scrapes, an unavailable `/metrics` endpoint, and an unexpected decline in scraped API replicas.
- A sustained increase in HTTP `5xx` responses or high request-duration buckets on normalized API routes.
- Unexpected API or mobile error events after privacy-minimized Sentry reporting has been provisioned. Alert rules must correlate request IDs and must not depend on user, request-body, device, breadcrumb, or replay data.
- Redis connection/error-rate, latency, memory-pressure, eviction, and availability signals from the managed Redis provider.
- Any sustained open provider circuit, failed half-open probe, or `circuit_unavailable` provider metric.
- A sustained `audit_delivery_sweep_complete` retry count, an unexpected absence of delivery sweep logs, or a growing population of retrying audit-delivery outbox rows.
- A sustained `living_nutrition_background_worker_healthy{worker="..."} 0` gauge or any `backgroundWorkers.healthy=false` readiness response. Restore the missing worker; do not disable production heartbeat enforcement to mask a worker outage.

The application logs only the stable operation name, budget values, retry duration, and request ID for limiter events. It must not log a raw client address, verified user identity, resolved limiter key, authorization token, or provider payload.

`GET /metrics` is a root endpoint, not `/api/v1`. Keep it on a private scrape network and present `Authorization: Bearer $METRICS_BEARER_TOKEN`; the app returns `404` for a missing/invalid token or disabled metrics. It exposes only low-cardinality normalized routes, statuses, duration buckets, rate-limit decisions, readiness dependency gauges, aggregate background-worker liveness by static worker type, provider outcomes/latency/circuit state, and food-cache hit, refresh, and fallback events. Prometheus-compatible collectors must scrape every API replica and aggregate them; no collector, dashboard, or alert service is supplied by this repository.

The retention worker emits an aggregate `living_nutrition_audit_delivery_events_total` metric and structured delivery sweep counts. It does not expose audit IDs, request IDs, client data, receiver URLs, response bodies, or error text. Treat a retrying outbox as an audit-delivery incident: restore the approved receiver or its managed secret, then verify the backlog drains before allowing retention cleanup to remove delivered records.

Sentry is optional in local preview. Production API startup requires an HTTPS `SENTRY_DSN`; installed mobile builds may use `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_ENVIRONMENT`. The mobile DSN is a public ingestion setting, not a secret. Keep server DSNs and any `SENTRY_AUTH_TOKEN` for release artifacts in managed deployment secrets, never in the mobile bundle. Before enabling alerting, verify a controlled preview error contains only approved stable tags and no request, account, device, breadcrumb, context, nutrition, or image data.

## Incident Response

### Redis limiter unavailable

1. Confirm `/api/v1/health/ready` returns `503` and record its request ID.
2. Check managed Redis health, connectivity, TLS/network rules, and the API deployment's `REDIS_URL` without copying credentials into tickets or chat.
3. Keep protected routes fail-closed. Do not switch production to memory limiting or disable limits as a workaround.
4. Restore Redis connectivity, confirm readiness returns `200`, then review `rate_limit_backend_unavailable` events around the incident window.
5. Record the cause, duration, affected policies, and remediation. Do not include client IPs or bearer tokens.

### Redis provider circuit unavailable or open

1. Confirm `/api/v1/health/ready` identifies `providerCircuit` as unhealthy, or review the provider circuit metric state and request ID from affected `503` responses.
2. Check the managed Redis service, TLS/network policy, and the configured `NUTRITION_PROVIDER_CIRCUIT_BREAKER_REDIS_KEY_PREFIX` without exposing credentials.
3. Keep production on shared Redis circuit state. Do not switch to memory state or bypass the breaker to force external provider requests.
4. When the circuit is open, inspect provider operation and latency metrics. Wait for the configured half-open probe rather than manually generating retries.
5. After recovery, verify readiness returns `200`, the circuit returns to `closed`, and cached stale-source behavior remains available during the incident window.

### Unexpected rate-limit denials

1. Collect the response request ID, endpoint, status, `Retry-After`, and rate-limit headers from the affected client.
2. Confirm the deployed `TRUSTED_PROXY_CIDRS` match the direct proxy peer ranges.
3. Check `rate_limit_denied` volumes by operation and compare the configured auth, analysis-IP, and analysis-user budgets with the documented abuse scenario. Credential routes are IP-scoped; paid image analysis is atomically checked against both IP and verified-user budgets.
4. Adjust budgets only through reviewed configuration, then deploy and validate the change across at least two API replicas.

### Unexpected API or mobile error spike

1. Record the request ID shown in the client error envelope, if present, and the affected route/status without copying meal, image, token, or account data into an incident ticket.
2. Review the corresponding structured application logs and the sanitized Sentry event. The event should contain only approved correlation tags; treat any request/user/device/context payload as a privacy incident.
3. Use protected metrics and provider/Redis readiness to determine whether the spike is application, dependency, or client-network related. Do not reconstruct user input from an error-reporting system.
4. Roll back or mitigate through reviewed deployment/configuration changes, then validate the same safe error path in preview before closing the incident.

## Release Validation

Run these checks in a preview environment using the same ingress and Redis topology intended for production:

1. Deploy two API replicas connected to one Redis instance.
2. Send requests through the real proxy until the auth and analysis IP policies return `429`; alternate replicas to prove one shared budget.
3. Verify every protected denial includes `Retry-After`, rate-limit headers, and `X-Request-Id`.
4. Verify the durable route `POST /api/v1/meal-analysis/jobs` consumes the analysis budget.
5. Send authenticated analysis requests from two different client networks for the same Clerk subject. Verify the shared user budget returns `429`, and verify the rejected request does not consume the second network's IP budget.
6. Simulate Redis unavailability and verify protected routes return correlated `503` with `rate_limit_unavailable`, while the readiness endpoint returns `503`.
7. Verify a spoofed `X-Forwarded-For` from an untrusted direct peer does not change the limiter identity.
8. Restore Redis, verify readiness, then check that logs contain no raw client address, verified user identity, or token values.
9. Simulate a transient nutrition-provider outage across both replicas, verify only the leased half-open probe resumes after the recovery window, and confirm the healthy fallback provider or stale cached record remains available where applicable.
10. Confirm the protected `/metrics` scrape succeeds from the collector network, shows provider/cache health signals, and contains no request IDs, client addresses, user identifiers, tokens, food queries, barcodes, image data, or exception messages.
11. Stop one worker in preview and verify readiness returns `503` with only the unhealthy worker type, the background-worker gauge becomes `0`, and the API resumes readiness only after the worker reports again. Do not expose or record a process ID, hostname, user, image, or storage key while testing.
12. When Sentry is enabled, verify a controlled preview failure arrives with the request-ID correlation tag only and has no request, user, device, breadcrumb, context, screenshot, view-hierarchy, replay, nutrition, or image payload. Verify release symbols/source maps separately before relying on stack traces.

Document the deployment provider, exact proxy CIDRs, dashboard links, Sentry project and alert owners, on-call route, and validation date in the release record. Those deployment-specific values do not belong in source control.
