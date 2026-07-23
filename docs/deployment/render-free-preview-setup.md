# Free Render Preview Setup

Last updated: 2026-07-21

Related: [[release-runbook|Release And Beta Runbook]], [[render-r2-setup|Render And Cloudflare R2 Setup]], [[../Current State|Current State]], and [[../Known Issues|Known Issues]].

`render.yaml` is the repository's no-cost Render preview Blueprint. It is for personal testing only and must never be represented as a production environment.

## What It Creates

- One free Render web service: `living-nutrition-preview-api`.
- One free Render Postgres database: `living-nutrition-preview-postgres`.

It intentionally creates no workers, Key Value instance, Cloudflare R2 bucket, Sentry configuration, audit-delivery receiver, or production monitoring. The free API can sleep when idle and the free database is temporary, so neither availability nor data durability is suitable for real users.

## Available Flows

- Clerk sign-in when its verification values are configured.
- Manual food search, USDA/Open Food Facts barcode lookups, custom foods, meals, diary, goals, weight, and hydration.

## Disabled Flows

`AI_FEATURES_ENABLED=false` rejects camera meal analysis and nutrition-label extraction before images are stored, an AI quota is reserved, or OpenAI is called. Use manual search, barcode lookup, or custom-food entry instead. Retained meal photos and durable camera-job recovery are unavailable because there is no private object storage or worker.

## Deploy

1. In Render, create a Blueprint from this repository's root `render.yaml`.
2. Provide `CLERK_JWKS_URL` and `CLERK_ISSUER` from the Clerk development tenant. Do not enter an OpenAI key for this free preview. Leave `CLERK_AUDIENCE` unset when the mobile app uses Clerk's default session token; configure it only if the app is deliberately changed to request a custom JWT template with an `aud` claim.
3. Confirm the service and database show the `free` plan before applying the Blueprint.
4. After deployment, set the generated API URL with its `/api/v1` suffix as `EXPO_PUBLIC_API_BASE_URL` for a test mobile build or device configuration.
5. Allow for a cold start after inactivity. Retry a request if the service is waking.

Run `render blueprints validate render.yaml` after authenticating the Render CLI and selecting the workspace. It validates the actual Render schema and resource plan before deployment.

## Moving To Production

The paid production topology is preserved separately in `render.production.yaml`; it provisions always-on API/workers, Redis, managed PostgreSQL, and Cloudflare R2. Use [[render-r2-setup|the production setup guide]] only after accepting paid service charges and completing the required security and privacy gates.

## References

- [Render free instances](https://render.com/docs/free)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
