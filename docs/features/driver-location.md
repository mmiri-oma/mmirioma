# Current driver location

Requirements: FR-001, FR-002, FR-031, FR-035, NFR-005 · Acceptance tests: T-07

## 1. Overview and purpose

Backend portion of #410, implementing the location amendment in
[partners.md](../api/partners.md#amendment-410-driver-location-for-automatic-dispatch)
agreed in #423 and recorded by #424. An approved online driver may consent to
store one current device point. Coordinates are private; clients receive only
sharing, age and accuracy. This is backend capability, not a complete pilot flow.

## 2. Feature workflow

After explaining collection and obtaining consent, a client enables sharing with
`POST /driver/location/sharing` and retains the returned grant. Each confirmation
carries that grant. Updates replace the point and use server receipt time.
Withdrawal deletes the point and advances the grant without taking the driver
offline. Offline, suspension, deactivation and anonymization invalidate sharing
in the same transaction as their existing change. Going online again does not
restore consent. Automatic offers and location reminders belong to #411.

## 3. Important files

| File | Responsibility |
| --- | --- |
| `backend/app/modules/partners/location.py` | Grants, shared profile lock, freshness, point overwrite and deletion |
| `backend/app/modules/partners/location_schemas.py` | Coordinate validation and coordinate-free responses |
| `backend/app/modules/partners/models.py` | Current-point model |
| `backend/app/modules/partners/router.py`, `service.py`, `schemas.py` | Thin endpoints and profile summary |
| `backend/app/modules/dispatch/models.py`, `service.py` | Profile grant fields and CLI availability |
| `backend/app/modules/partners/directory.py` | Approval/deactivation clearing |
| `backend/app/modules/auth/service.py` | CLI deactivation clearing and acceptance version |
| `backend/app/modules/privacy/service.py`, `cli.py` | Transactional anonymization counts, dry run and audit |
| `backend/alembic/versions/20261112_0029_add_driver_locations.py` | Migration |
| `frontend/src/lib/api/partners.ts` | Preserve the new coordinate-free summary in runtime profile parsing |
| `PRIVACY_NOTICE.md`, `frontend/src/features/marketing/LegalPages.tsx` | Collection/deletion disclosure |

## 4. Database models and relationships

`driver_locations.driver_id` is both primary key and FK to `users.id`, cascading
on user deletion. It has one non-null SRID 4326 geography point, a GiST index,
positive integer `accuracy_metres` and UTC `confirmed_at`. No history exists.
`driver_profiles` gains `location_sharing_on` (false by default) and a nonnegative
bigint `location_sharing_grant` (zero initially). Migration 0029 follows 0028.
Downgrade discards all points and grants; re-upgrade requires fresh consent.

## 5. API endpoints

All paths are under `/api/v1`; only the authenticated driver acts on their own row.

| Method | Path | Request | Success |
| --- | --- | --- | --- |
| POST | `/driver/location/sharing` | No body; explicit consent | 200 `{grant}` |
| PUT | `/driver/location` | `{location: {latitude, longitude}, accuracy_metres, grant}` | 200 location summary |
| DELETE | `/driver/location` | None | 204, including already withdrawn |
| GET | `/driver/profile` | None | Existing profile plus `location` summary |

The summary has `state` (`fresh`, `stale`, `none`), `sharing`, `confirmed_at`,
`fresh_until`, `accuracy_metres`; never coordinates or the grant.

## 6. Business rules

- FR-031: active, approved and online is required to enable sharing or write.
- FR-035/#410: a grant follows explicit consent; withdrawal invalidates all old
  grants, including across offline/online cycles and a later re-consent.
- Freshness is time only: `now < confirmed_at + DRIVER_LOCATION_FRESHNESS_SECONDS`.
  Exactly the threshold is stale. Default 300 seconds; setting must be positive.
- Device points use existing delivery bounds and six decimal places. Accuracy is
  finite, greater than zero and at most 100,000 metres, rounded upward on storage.
- Every location write and clearing path holds the profile row lock. Locked reads
  refresh ORM state after waiting, so previously loaded objects cannot bypass it.
- BR-03: verified payload logic is unchanged. Keke declaration limits remain deferred.

## 7. Authentication and authorization

Reuse centralized cookie sessions, driver-only role checks and CSRF. No driver ID
is accepted from clients. Eligibility is checked again after acquiring the lock,
including a fresh active-account read, because authentication can predate a
concurrent deactivation. No new provider or network integration is involved.

## 8. Error handling and edge cases

Use the existing API error envelope: 401 `not_authenticated`, 403 `forbidden` or
`csrf_failed`; enabling/updating also return 403 `partner_not_approved`, 409
`driver_offline`, 404 `no_driver_profile`. A revoked/superseded update returns 409
`location_sharing_withdrawn`; validation returns 422 `validation_error`.
Out-of-bounds errors are on `body.location` with the existing delivery-area message.
No point or grant is added to logs/audits. The privacy audit adds only the count
`location_points_cleared`; its dry run rolls back deletion and grant changes.

## 9. Testing

- `backend/tests/test_driver_location.py`: bounds, accuracy/grant validation,
  role/CSRF denials, schemas, error envelopes and injected-clock freshness boundary.
- `backend/tests/test_driver_location_integration.py`: PostGIS overwrite, grant
  rotation, actual lock contention for write-first/clear-first against withdrawal
  and offline, stale grants after online again, approval/account restrictions,
  clearing paths and anonymization dry run/application.
- Existing partner, driver, dispatch, auth and privacy regressions remain applicable.
- `frontend/src/lib/api/partners.test.ts`: preserve the summary, tolerate future
  states, reject malformed metadata and strip unexpected coordinates/grants.
- `frontend/src/features/marketing/privacyNotice.test.tsx`: disclosure and version.
- Official framework references checked for this implementation: [SQLAlchemy 2.1
  ORM refresh semantics](https://docs.sqlalchemy.org/en/21/orm/queryguide/api.html#populate-existing)
  and [Pydantic numeric fields](https://docs.pydantic.dev/latest/api/fields/).
- Migration validation requires a dedicated disposable PostGIS database: upgrade,
  downgrade one revision, upgrade, `alembic check`. Never use development data.

Validation on 2026-11-12: backend Ruff lint/format and whitespace checks passed;
the full database-free run passed 1,864 tests and skipped 337 database tests.
The affected PostGIS run passed 82 tests; after final locking/privacy refinements,
34 checks passed, followed by 43 final location validation/API checks and 44
deployment checks. These runs overlap and are not additive coverage totals.
Migration upgrade/downgrade/re-upgrade/schema comparison passed on a disposable
PostGIS 16 database, since removed. Frontend lint, typecheck, build and all 1,693
tests across 127 files passed, with mocks explicitly enabled. The build retains
its existing chunk-size/PWA option warnings. No deployment or real-phone test ran.

## 10. Known limitations

No new rider/driver screens or foreground refresh are implemented: the written
flow is approved but visual mockup approval is outstanding. No automatic dispatch,
ranking, reminders, push, sound or customer tracking is implemented here. Keke
capacity is deferred; #410 remains open for the remaining UI and real Android
check. The broader legal/data-protection review #392 remains outstanding.
