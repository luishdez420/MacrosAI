# Authorization Boundaries

Last updated: 2026-07-22

Related: [[Architecture]], [[Current State]], [[Known Issues]], [[../api/endpoints|API Endpoints]].

## Purpose

This inventory records the current owner-authorization policy for API routes.
It is an implementation map, not a claim that deployment validation or every
possible BOLA test is complete. When this note conflicts with code, code is
the source of truth.

## Policy

- Every private resource route depends on `ensure_current_user`.
- Queries for owner-bound records include the authenticated internal user ID
  in the lookup itself. They do not fetch first and compare ownership later.
- A guessed private ID returns the same `404` as a missing record. The server
  records a minimal `authorization.owner_access_denied` event without the
  requested ID, request body, or resource payload.
- User-created records are private and must never enter shared provider
  search/cache paths. Global USDA and Open Food Facts catalog data is shared
  between signed-in accounts: text search, barcode lookup, and food detail all
  require a signed-in user.
- Date-keyed user values (weight and hydration) are scoped by `(user_id,
  logged_on)`. A delete for another account's date is an idempotent no-op;
  it cannot affect the owner's value.
- Administrative routes are not owner-resource routes. They require a
  configured Clerk administrator subject and return privacy-minimized
  operational data.

## Owner-Bound Resources

| Resource | Routes | Current enforcement | Regression coverage |
| --- | --- | --- | --- |
| Meals and meal images | `/meals`, `/meals/{id}`, meal-image access/delete | `Meal.user_id` is in every detail/mutation query; image access also verifies the image belongs to that owned meal. | Two-account read/update/delete/list and image access/delete tests. |
| Meal confirmation from camera analysis | `POST /meals` with `analysisJobId` | The review job is resolved by `AnalysisJob.id`, owner, `needs_review` status, and expiry before idempotency or meal writes begin. | Two-account confirmation test proves a `404`, minimal audit event, intact owner job, and no created attacker meal. |
| Analysis jobs | `/meal-analysis/jobs`, `/meal-analysis/{id}` | Create/read/cancel are authenticated; status/cancel lookups include `AnalysisJob.user_id`. | Owner status/cancel denial coverage, plus job lifecycle tests. |
| Recipes, private recipe favorites, and private recipe folders | `/recipes`, `/recipes/{id}`, `/recipes/{id}/log`, `/recipes/folders`, `/recipes/folders/{id}` | Recipe queries include `Recipe.user_id`; the favorite flag is an owner-scoped recipe field; folder lookups include `RecipeFolder.user_id`, and deleting a folder updates only that owner's recipe links before removal. | Two-account recipe read/update/delete/log/list coverage, including a cross-account favorite update, plus folder list/update/delete denial coverage. |
| Custom foods | `/foods/custom`, `/foods/{id}`, `/foods/custom/{id}` | `CustomFood.user_id` joins are required for detail, edit, delete, barcode resolution, and provider fallback. | Two-account detail/edit/delete/list coverage. |
| Favorites, private tags, and recents | `/foods/favorites`, `/foods/favorites/{foodId}/tags`, `/foods/recent` | Favorite and recent link-table lookups include the current user. Tag updates first resolve the current user's `FavoriteFood`; tags and assignments are user-owned and never attach to source records. | Two-account add/remove/list and favorite-tag update coverage. |
| Source correction reports | `/foods/{id}/correction-reports`, `/correction-reports` | Private custom records must be owned before a report can reference them; history filters `DataCorrectionReport.user_id`. | Two-account report/history coverage. |
| Goals and preferences | `/goals`, `/goals/history`, `/preferences` | Reads and upserts use the current user's rows. | Separate accounts receive independent values. |
| Weight and hydration | `/weight`, `/hydration/{date}` | Queries and upserts constrain `user_id` and date. | Same-date two-account write/delete/read coverage. |
| Diary and insights | `/diary/{date}`, `/insights/*` | Meal and goal queries are built from the authenticated user ID. | Other-account reads return empty totals rather than owner data. |
| Sessions and security activity | `/auth/sessions`, `/auth/activity` | Session and audit queries use the current user ID; session revocation includes owner scope. | Cross-account revocation returns `404`; activity is account-only. |
| Export and profile deletion | `/export`, `/account` | Every export/deletion query uses the current user ID. | Second account's export contains none of the owner's records. |

## Explicitly Shared Or Separate Scopes

- `GET /foods/search` is an authenticated shared-provider catalog search. It
  never returns user-created records; those remain owner-scoped.
- USDA/Open Food Facts detail and barcode lookup are shared provider data but
  currently require a signed-in user. `provider=user` records remain private
  to their owner.
- Administrative audit and correction-review endpoints are protected by
  `ensure_clerk_admin`, not a general user ID. They must remain unavailable to
  ordinary Clerk users and do not return account identifiers to administrators.
- Authentication registration, Clerk provisioning, refresh, and logout have
  their own session and identity rules. They do not take a user-selected
  resource identifier.

## Review Checklist

When a new owner-bound route is introduced:

1. Add `ensure_current_user` and include the owner constraint in the initial
   query.
2. Use `raise_owner_scoped_not_found` for guessed resource IDs when a
   non-enumerating response applies.
3. Ensure audit writes cannot accidentally commit an in-progress mutation.
4. Add a two-account positive/negative test, including any nested resource or
   handoff ID such as an analysis job or image ID.
5. Update this inventory, [[Current State]], and [[Known Issues]] if coverage
   or a limitation changes.
