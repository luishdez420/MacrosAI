# Living Nutrition

Living Nutrition is a production-oriented mobile nutrition tracker. Camera analysis identifies visible foods, matches USDA nutrition records, estimates portions with confidence notes, and lets users log or retake the scan.

## Current Phase

This repo is set up for Phase 1 and the beginning of Phase 2:

- Monorepo workspace structure
- TypeScript Expo app with Expo Router
- Design tokens and shared schemas
- Shared validation helpers for per-100g nutrition math
- FastAPI backend skeleton
- SQLAlchemy production schema with Alembic migration
- USDA and Open Food Facts provider abstractions
- Per-100g nutrition calculation utilities
- Persistent manual meal logging and daily diary totals from backend snapshots
- Barcode scanning for packaged foods with serving/gram confirmation
- Assistive nutrition-label extraction into an editable, explicitly confirmed custom-food record
- Local-password JWT/refresh sessions, nutrition goals, meal editing, and meal deletion
- Camera scan results saved as provider-backed estimates with confidence notes and editable grams
- CI, Docker Compose, and architecture docs

For the full implementation tracker, see [docs/product/feature-status.md](/Users/luishernandez/Documents/New%20project/docs/product/feature-status.md).
For the current source-of-truth implementation snapshot, see [docs/Current State.md](/Users/luishernandez/Documents/New%20project/docs/Current%20State.md).

## Structure

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
  accuracy/
  api/
  architecture/
  privacy/
  product/
```

## Local Setup

Create a real root `.env` file for local secrets. The API loads `/Users/luishernandez/Documents/New project/.env` first, then optionally `apps/api/.env` if you need API-specific overrides. `.env.example` files are documentation templates only.

For production, configure Clerk first: set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for the mobile build, then set `ENVIRONMENT=production`, `IDENTITY_PROVIDER=clerk`, `CLERK_JWKS_URL`, `CLERK_ISSUER`, a unique `JWT_SECRET` of at least 32 characters, both `ALLOW_DEV_AUTH=false` and `ALLOW_LEGACY_LOCAL_TOKENS=false`, `RATE_LIMIT_BACKEND=redis`, and `NUTRITION_PROVIDER_CIRCUIT_BREAKER_BACKEND=redis` with a reachable `REDIS_URL`. Production configuration also requires `METRICS_ENABLED=true`, a managed `METRICS_BEARER_TOKEN` for the protected root `/metrics` scrape, an HTTPS `SENTRY_DSN` for backend error reporting, and `BACKGROUND_WORKER_HEARTBEATS_REQUIRED=true`. The three deployed workers report only anonymous process liveness; `/api/v1/health/ready` fails closed if analysis, image-retention, or source-refresh work stops reporting within `BACKGROUND_WORKER_HEARTBEAT_TTL_SECONDS`. Production configuration refuses to start without Clerk verification settings, metrics protection, Sentry configuration, worker-heartbeat enforcement, either compatibility mode, a disabled limiter, the local in-memory limiter, or memory-only provider-circuit state. The `RATE_LIMIT_*` settings protect authenticated catalog search, credential, and paid image-analysis endpoints through an atomic shared Redis rolling window: signed-in `GET /foods/search` uses the dedicated IP-only `RATE_LIMIT_FOOD_SEARCH_*` budget, while analysis uses an IP budget and, for a verified account, a separate `RATE_LIMIT_ANALYSIS_USER_*` budget in the same decision. Local phone preview deliberately uses `RATE_LIMIT_BACKEND=memory` and an in-memory provider circuit.

To enable mobile error reporting in an installed build, set the public ingestion settings `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_SENTRY_ENVIRONMENT` in the EAS build environment. These are not secret API keys. Do not place a `SENTRY_AUTH_TOKEN`, server credential, or release-upload token in the mobile bundle.

For production, set `TRUSTED_PROXY_CIDRS` to the CIDRs of only the selected load balancer or reverse proxy. The API reads `X-Forwarded-For` only from those direct peers; otherwise it limits by the direct socket address. This is required in production and must be chosen with the deployment provider, not guessed from a client header.

The local API also records minimal audit events for account/session lifecycle, export, and account deletion. These events intentionally exclude credentials, tokens, nutrition entries, image data, and free-form request payloads. Audit-log review, retention, and immutable external delivery remain production follow-up work.

Install mobile dependencies:

```bash
npm install
```

Start the API dependencies:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up postgres redis
```

Apply database migrations manually when you need a direct database maintenance command:

```bash
cd apps/api
alembic upgrade head
cd ../..
```

For normal API development, `npm run api` and `npm run api:reload` run Alembic automatically before serving requests. This prevents meal logging from failing because tables such as `meals` or `meal_items` have not been created yet.

Run the API:

```bash
npm run api
```

Run the mobile app with a development build:

```bash
npm run dev:device
```

Before the first physical-device run, create and install the development build:

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest build --profile development --platform ios
```

`eas init` links the app to your Expo account and writes the real EAS project ID; the repository intentionally does not contain a placeholder project ID. Install the internal iOS build from the EAS link, then return to the repository root and run `npm run dev:device`. Wait for the bundle prewarm message before opening the build on the phone. `dev:phone` remains the Expo Go path; `dev:device` uses the installed development client and the same LAN API discovery.

For Expo Go preview on a personal phone:

```bash
npm run dev:phone
```

This starts or reuses the FastAPI server on `0.0.0.0:8000`, forces Expo/Metro to advertise your Mac's LAN IP, and starts Expo Go mode so your phone can reach both the JavaScript bundle and the nutrition API from the same Wi-Fi network.

For phone preview, the script uses a local SQLite database at `apps/api/.local/living-nutrition-dev.sqlite` unless `DATABASE_URL` is exported in your shell or you run with `DEV_PHONE_USE_POSTGRES=1`. On startup it safely creates missing preview tables and repairs the explicitly supported legacy columns before Expo starts. Production and Docker development still use PostgreSQL and Alembic migrations.

The script also prewarms the iOS bundle locally. Wait until you see:

```text
iOS bundle ready: ...
Now scan the Expo QR code from Expo Go.
```

Then scan the QR code. This avoids Expo Go timing out while Metro is still doing its first file crawl.

When the command starts, it prints two phone test URLs:

```text
Phone bundle test: http://YOUR_MAC_LAN_IP:8081/status
Phone API test:    http://YOUR_MAC_LAN_IP:8000/api/v1/health
```

Open both URLs in Safari on the phone. The bundle test should show Metro's packager status, and the API test should return `{"ok":true}` with `database.schemaReady` set to `true`. If either URL does not load, the phone cannot reach the Mac over LAN. Check that the phone and Mac are on the same Wi-Fi, turn off VPN/private relay for this test, allow local-network access for Expo Go in iOS Settings, and allow incoming connections for Node/Terminal in macOS firewall settings.

If your Wi-Fi blocks device-to-device traffic, use Expo's tunnel mode:

```bash
npm run dev:phone:tunnel
```

If Expo Go keeps showing an old route or native-module error, restart Metro with a cleared cache:

```bash
npm run dev:phone:clear
```

If `npm run dev:phone` says port `8000` or `8081` is already in use, inspect the blocking process:

```bash
npm run ports
```

If port `8000` is already running a healthy Living Nutrition API with the current database schema, `npm run dev:phone` now reuses it automatically, starts its bounded local meal-analysis worker, and then starts Expo. If something is listening but `/api/v1/health` does not report `database.schemaReady: true`, stop that process before starting phone dev again.

Expo SDK 54 should be run with an active LTS Node version such as Node 22. Node 26 can fail while loading Expo CLI dependencies.

If Expo Go reports `Cannot find module 'babel-preset-expo'`, reinstall dependencies from the repo root and start the workspace app:

```bash
nvm use
npm install
npm run mobile:go
```

Avoid running `npx expo start` from the repo root because it can pick up leftover prototype files instead of the workspace app in `apps/mobile`.

The old root `App.js`, root `app.json`, root `babel.config.js`, `server/`, and `services/` prototype files have been removed. The Expo entry point now lives in `apps/mobile`.

For testing on a physical phone, the app tries to derive the API URL from Expo's LAN host automatically. If needed, set `EXPO_PUBLIC_API_BASE_URL` in [apps/mobile/.env.example](/Users/luishernandez/Documents/New%20project/apps/mobile/.env.example) to your computer's LAN IP, such as `http://10.0.0.227:8000/api/v1`.

## Accuracy Principle

Nutrition is calculated from authoritative records using:

```text
nutrientAmount = nutrientPer100g * consumedGrams / 100
```

The app must show source, confidence, and editable portions. Camera-generated results are estimates and should never be presented as perfectly accurate. Current camera confirmation requires identity, preparation, and portion review; supports provider-backed food replacement and add-ons; and exposes source details before saving. Advanced candidate ranking, richer add-on organization, and production image/privacy controls remain planned.

Manual logging is the current accuracy anchor. When a user selects a food and enters grams, ounces, or a source serving with a verified gram weight, the app calculates a preview from per-100g data, then saves a meal item snapshot through `POST /api/v1/meals`. Ounces are converted to grams for calculation while the entered unit is retained in the snapshot. Household or volume servings without a verified gram weight are not converted or treated as 100g. The home dashboard reads `GET /api/v1/diary/{date}` so totals survive reloads and do not silently change if an external provider updates a food record later.

Natural entry is also available from Home for short, explicitly weighted lists such as `150 g grilled chicken; 2 oz cooked rice`. It searches provider records and requires a user confirmation for every item. It intentionally rejects cups, pieces, and unweighted descriptions because mass cannot be safely inferred.
