# Privacy Model

Last updated: 2026-07-09

Related documents: [[Current State]], [[Architecture]], [[Known Issues]], [[Roadmap]].

Food photos and weight history are sensitive personal data.

## Current implementation

- Third-party API keys are backend-side rather than called directly from mobile.
- Mobile stores access and refresh tokens in SecureStore. The API stores only a hash of refresh tokens, rotates refresh tokens on use, and revokes sessions on logout.
- API responses use request IDs and consistent error envelopes.
- User preferences include an image-retention-days field in the database model.
- Nutrition-label analysis is initiated explicitly by the user, sends the image through the backend to the configured vision provider, keeps only a temporary local mobile draft, and does not persist the image or extraction as evidence in the current implementation.
- Meal and label analysis reject invalid base64, unsupported image signatures, and decoded image payloads larger than 12 MB before provider transmission.

## Planned privacy and security controls

The product should add:

- Backend-only third-party API keys
- Encryption in transit
- Private object storage
- Time-limited signed URLs
- Image deletion controls
- Account deletion
- Data export
- Secret management
- Distributed API rate limiting beyond the current process-local limits on credential and paid image-analysis routes
- Audit-log review, retention, and immutable delivery for sensitive operations
- Configurable image retention

User meal photos must not be used for model training without separate explicit opt-in consent.

## Current limitation

Basic current-user JSON export and local account deletion are implemented. Register, login, refresh, logout, export, and account deletion create minimal internal audit events containing only event type, outcome, timestamp, request ID, optional user link, and a one-way client fingerprint. Label photos are not persisted by the current extraction flow, but they are transmitted to the configured vision provider for analysis. Credential and paid image-analysis routes have process-local rolling-window limits; this does not provide multi-replica production protection. Private object storage, signed image URLs, stored image deletion controls, production account lifecycle, distributed rate limiting, audit-log review/retention, immutable audit delivery, and enforceable retention workflows are planned rather than implemented.
