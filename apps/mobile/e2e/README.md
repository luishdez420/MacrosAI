# Android Device E2E

These [Maestro](https://maestro.mobile.dev/) flows exercise the app through a dedicated Android development build. They are intentionally fixture-only:

- `EXPO_PUBLIC_E2E_FIXTURE_MODE=true` enables a hidden test meal and skips first-run onboarding.
- `E2E_FIXTURE_MODE=true` replaces live USDA, Open Food Facts, and OpenAI calls with deterministic backend fixtures.
- The backend remains responsible for normal validation, provider routing, analysis-job processing, idempotency, meal persistence, and diary writes.

The fixture settings are rejected by production API configuration. Never set either variable in a phone, preview, or production release build.

## Current smoke coverage

- `manual-log.yaml`: provider-backed manual search and meal persistence.
- `barcode-recovery.yaml`: no-match recovery, typed barcode fallback, and packaged-food logging.
- `camera-confirmation.yaml`: fixture camera input, durable analysis processing, mandatory food/preparation confirmation, and meal persistence.
- `camera-permission-recovery.yaml`: the real camera-permission screen's manual-search fallback when camera access is unavailable. The fixture build starts with no granted camera permission and uses the same user-visible recovery path as a denied request.
- `meal-builder.yaml`: multi-food builder search, source-backed item selection, and meal persistence.
- `custom-food.yaml`: barcode no-match fallback, user-created per-100g nutrition entry, and meal persistence.
- `meal-edit-delete.yaml`: saved-meal portion update and explicit deletion confirmation.
- `offline-queue-sync.yaml`: account-scoped SQLite queue creation and idempotent replay through Today. It uses a control compiled only into the dedicated fixture build; the automatic transport-failure branch remains covered by unit tests.
- `z-local-profile-deletion.yaml`: typed deletion of the Living Nutrition profile under the local development identity. It intentionally does not test deletion of a Clerk identity.
- `provider-outage-recovery.yaml`: a deterministic fixture-provider outage surfaced through the normal `503` API error envelope and Manual Search retry UI.
- `rate-limit-recovery.yaml`: a deterministic fixture-only `429` using the normal rate-limit error envelope, retry header, and Manual Search retry UI. It does not consume a shared budget that could make another smoke flow flaky.

The dedicated GitHub Actions workflow runs automatically for pull requests and `main` changes that touch the mobile app, API, shared mobile packages, or the workflow itself. It can also be dispatched manually. It builds the fixture-only Android development app, verifies both API and Metro readiness instead of relying on a fixed delay, and uploads API, worker, Metro, and Android logs on failure. A first successful hosted-emulator run is still required before repository branch protection should mark this check as required.

To reproduce the workflow locally, use an Android emulator, a local API, a meal-analysis worker, Metro, and the Maestro CLI. Clerk sign-in and managed-identity account lifecycle still need a separate Clerk test tenant; true airplane-mode/device reconnect and custom-food editing need separate device fixtures. See [Known Issues](../../../docs/Known%20Issues.md).
