# Booking API

REST API for booking meeting rooms.

## Getting started

Create the environment file:

```bash
cp .env.example .env
```

### Run with Docker

Starts the database and the API. Migrations are applied automatically when the API container starts:

```bash
docker compose up --build
```

### Run locally

Starts only the database in Docker and the API on your machine with auto-reload:

```bash
npm install
docker compose up -d db
npx prisma migrate dev
npm run start:dev
```

`npx prisma migrate dev` applies the migrations from `prisma/migrations` to the local database.

The API runs on http://localhost:3000, Swagger docs on http://localhost:3000/docs.

### Seed data

Creates the admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` and fills the database with 3 equipment items and 8 rooms. Registration through the API always creates a member, so the seed is the only way to get an admin. The seed can be run more than once: existing rooms and equipment are skipped, the admin's password is reset to the value from `.env`.

```bash
npx prisma db seed
```

`SEED_BULK=true` additionally creates 20 equipment items, 5000 rooms, 200 users and 100 000 bookings (20 per room, September–October 2026, every tenth one cancelled). Bulk users get a random password and cannot log in. On a small table Postgres always reads the whole table, so this data set is needed to see indexes in `EXPLAIN ANALYZE`:

```bash
SEED_BULK=true npx prisma db seed
```

The seed runs from your machine only (it needs `ts-node` and the generated Prisma client from `npm install`), not inside the API container. It works in both modes above, because the database port 5432 is published to the host.

## Tests

```bash
npm test          # unit tests, no database needed
npm run test:e2e  # e2e tests on a fresh test database
```

`npm run test:e2e` is the only command needed. Before the tests it creates the database `<name>_test` next to the one from `DATABASE_URL` (for example `booking_test`), drops it if it is left from a previous run, applies all migrations and points the tests at it. The development database is not touched. It needs Postgres to be running (`docker compose up -d db`).

Request logs are off during the e2e tests, whatever `LOG_LEVEL` is in `.env`; `LOG_LEVEL=info npm run test:e2e` turns them on.

- **Unit tests** (`src/**/*.spec.ts`): the booking rules as pure functions (`booking-rules.spec.ts`), the service with a mocked database (`bookings.service*.spec.ts`: what is checked and in which order, access by owner and admin, 409/404/400 answers, the advisory lock), the error filter, the DTOs and the logger setup.
- **E2E tests** (`test/*.e2e-spec.ts`) run the whole application against Postgres:
  - `auth`: registration, login, refresh rotation with reuse detection, logout, roles;
  - `bookings`: the full cycle (create, read, list, change, cancel, the slot is free again), 401 without a token, 403 for other users' bookings, overlaps, every booking rule, invalid input (always 400 or 404, never 500), list filters and availability;
  - `bookings-race`: 20 parallel requests for one slot give one 201 and nineteen 409, and the same for parallel `PATCH`;
  - `health`.
- Each e2e file creates its own users and rooms with unique names and removes them afterwards, so the files can run in parallel.

## Logging

Logs are JSON, one line per request, written to stdout by `nestjs-pino`:

```json
{"level":40,"time":1792136787189,"pid":1,"hostname":"api","req":{"id":"abc-1","method":"POST","url":"/auth/login"},"res":{"statusCode":401},"responseTime":96,"msg":"request completed"}
```

- The level follows the status: 2xx and 3xx `info`, 4xx `warn`, 5xx `error`. `userId` is added when the request is authenticated.
- Only the method, url, id and status of a request are logged. Headers (`Authorization`, `Cookie`) and bodies (passwords, refresh tokens) are never written.
- `x-request-id` from the request is used as the request id if it is up to 64 characters of letters, digits, `_`, `.` or `-`; otherwise an id is generated. The id is returned in the `x-request-id` response header, so a client can quote it when it reports a problem.
- Requests to `/health` are not logged (any method, also with a query string or a trailing slash), so frequent health probes do not fill the log. A 503 from it is still logged by `AllExceptionsFilter`.
- The level is set by `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`; default `info`). Unexpected 500 errors are logged with the stack by `AllExceptionsFilter`.

## Environment variables

The variables the API reads are validated at start (`src/config/env.validation.ts`): the application does not start with a missing or invalid value. `POSTGRES_*` are read only by `docker-compose.yml`, `ADMIN_*` only by the seed, which checks them itself. `.env.example` lists all of them.

| Variable | Meaning |
|---|---|
| `NODE_ENV` | `development`, `production` or `test` |
| `PORT` | HTTP port, default 3000 |
| `LOG_LEVEL` | see Logging, default `info` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | used by `docker-compose.yml` to create the database |
| `DATABASE_URL` | connection string of the application |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | at least 32 characters, must be different |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | token lifetime in seconds (900 and 604800) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | the admin account created by the seed |

## Project structure

```
src/
  main.ts              starts the app, Swagger at /docs, pino as the logger
  app.module.ts        imports the modules, global validation pipe and error filter
  config/              validation of environment variables
  prisma/              PrismaService: one connection pool for the whole app
  generated/           Prisma client from `prisma generate` (not committed)
  common/
    guards/            JwtAuthGuard and RolesGuard (global, registered in AuthModule)
    decorators/        @Public, @Roles, @CurrentUser, @ApiErrorResponse (Swagger)
    filters/           AllExceptionsFilter: one error format for every error
    pipes/             AppValidationPipe: whitelist, rejects an array as a body
    logging/           pino-http options, request logging mounted before the body parser
    dto/               shared DTOs: error response, pagination query and page meta
    utils/             pagination, time constants, Postgres error codes
  auth/                register, login, refresh with rotation, logout, hourly cleanup of expired tokens
  users/               GET /users/me
  equipment/           equipment list and creation
  rooms/               rooms with filters and pagination, create and update (admin)
  bookings/            bookings and room availability
    booking-rules.ts   the rules as pure functions: time, capacity, access, free slots
    bookings.service.ts  transactions, locks, error mapping
  health/              GET /health
prisma/
  schema.prisma        the schema
  migrations/          the only way the schema changes
  seed.ts              admin, equipment, rooms, optional bulk data
test/                  e2e tests and the test database setup
```

A controller accepts the request and returns the response, a service holds the logic, Prisma talks to the database. The rules that need no database are in `booking-rules.ts`, so they are tested without mocks.

A request passes the parts in a fixed order: global guards (`JwtAuthGuard`, then `RolesGuard`), the validation pipe, the controller and the service. An error at any step goes through `AllExceptionsFilter`.

## Database schema

| Table | Purpose |
|---|---|
| `User` | email (unique), argon2 hash, name, role `admin` or `member` |
| `RefreshToken` | one row per issued refresh token, with `expiresAt` and `revokedAt` |
| `Room` | name (unique), capacity, floor, `isActive` |
| `Equipment` | name (unique) |
| `RoomEquipment` | links a room and its equipment, primary key `(roomId, equipmentId)` |
| `Booking` | room, user, `startsAt`, `endsAt`, `status`, `attendeesCount`, title |

Decisions:

- **Ids are uuid**, generated by the database. They cannot be guessed or counted by a client.
- **Time is `timestamptz`** and every API date is UTC (`Z` is required), so the server's time zone and daylight saving time do not change what a booking means.
- **Rooms are deactivated, not deleted.** A booking keeps pointing at its room (`onDelete: Restrict` for user and room in `Booking`), so history is not lost. An inactive room cannot be booked, and its availability is empty.
- **Cancelling is a status, not a delete.** The booking stays as history, and the exclusion constraint looks only at `confirmed` rows, so the slot is free again.
- **Roles and statuses are Postgres enums**, so the database rejects any other value.
- **Only a `member` can be registered through the API.** An admin is created by the seed, so nobody can make themselves an admin.
- **Refresh tokens are stored**, so that logout and rotation work: a used token is marked `revokedAt`. If a revoked token comes back after 10 seconds, all sessions of that user are revoked, because it was probably stolen. A repeat inside 10 seconds is treated as a double click or two tabs and is refused without revoking anything. Expired rows are deleted every hour.
- **Rules are repeated in the database where they can be.** The exclusion constraint forbids overlaps, CHECK constraints keep the duration between 15 minutes and 8 hours, foreign keys keep references valid. The service checks the same rules first to give a clear 400, the database is the last word.
- **Migrations are forward-only.** Prisma has no down migrations. A migration that is already applied is never edited: a mistake is fixed by a new migration (see `20261015150000_drop_redundant_booking_time_check`).
- **Several instances.** The API keeps no state in memory: access tokens are checked by their signature, refresh tokens, locks and the overlap check live in Postgres. Several instances behind a load balancer therefore work with no code change. Only the hourly cleanup of expired tokens would run in every instance, which is harmless because deleting an already deleted row does nothing.

Indexes are listed with the queries they serve in the Performance section below.

## Double booking protection

Two confirmed bookings of one room must not overlap in time, even when the requests arrive at the same moment. A check in the service is not enough: two requests can both run `SELECT` and see a free slot before either of them has inserted its row, and then both insert.

The rule lives in the database (migration `20261014143825_booking_constraints`):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap" EXCLUDE USING gist (
    "roomId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE (status = 'confirmed');
```

- Postgres rejects a row if a confirmed booking of the same room (`=`) has an overlapping time range (`&&`).
- `btree_gist` lets one GiST index combine `=` on a uuid with `&&` on a range.
- `'[)'` includes the start and excludes the end, so 10:00–11:00 and 11:00–12:00 do not overlap.
- `WHERE (status = 'confirmed')` ignores cancelled bookings, so cancelling frees the slot.
- CHECK constraints repeat the time rules of the service: a duration from 15 minutes to 8 hours (`startsAt < endsAt` follows from the 15-minute minimum).

How each operation works with the constraint:

| Operation | SQL | Slot is taken |
|---|---|---|
| `POST /bookings` | `SELECT … FROM "Room" … FOR SHARE`, then `INSERT … ON CONFLICT ON CONSTRAINT "Booking_no_overlap" DO NOTHING RETURNING id` | no row is returned → 409 |
| `PATCH /bookings/:id` with a new time | `pg_advisory_xact_lock(hashtext(roomId))`, `SELECT … FROM "Room" … FOR SHARE`, then `UPDATE … WHERE status = 'confirmed'` | Postgres error `23P01` → 409 |
| `POST /bookings/:id/cancel` | `UPDATE … SET status = 'cancelled' WHERE status = 'confirmed'` | — (of parallel cancels only one changes the row) |

- **Why `ON CONFLICT DO NOTHING`.** A plain `INSERT` writes the row first and then checks the constraint. Parallel inserts into one slot wait for each other and Postgres aborts some of them as a deadlock (114 of 800 inserts in a test). With `ON CONFLICT` Postgres checks the constraint first and skips the row: 0 deadlocks. `ON CONSTRAINT "Booking_no_overlap"` limits the skip to this constraint: any other conflict (for example, a unique constraint added later) stays an error instead of a false 409.
- **Why the advisory lock in `PATCH`.** `UPDATE` has no `ON CONFLICT`, and parallel updates into one slot deadlock the same way. The lock makes time changes within one room run one after another; it is taken only when the time changes and is released at the end of the transaction. The constraint still decides whether the new time is free. After taking the lock, `PATCH` reads the booking again and checks the rules against that fresh row, so two parallel changes of one booking do not overwrite each other's field with stale values.
  - Measured with a one-off script, without the lock: 20 connections send `UPDATE` into one slot at the same moment, 10 rounds. 38 of 200 updates were aborted as a deadlock (`40P01`); the API would answer them with 409 "try again" and a warning in the log instead of letting them wait their turn.
  - Through the API the requests reach the database less simultaneously, so the `PATCH` race test passes even without the lock. It checks the outcome (one 200, the rest 409) and that `23P01` turns into 409, not the deadlock itself.
  - `hashtext(roomId)` turns the uuid into the integer key that `pg_advisory_xact_lock` needs. Two rooms with the same hash only wait for each other, which is harmless.
  - The lock is not a second protection against double booking: without it the result stays correct, only some requests would fail with 409 "try again".
  - A request that waits for the room lock longer than 5 s (`SET LOCAL lock_timeout`) gets 503 "Database is busy, try again", so a stuck lock holder cannot block requests and their database connections forever. A deadlock (`40P01`, `P2034`) is a 409 "Concurrent update conflict, try again".

Two solutions were tried, both are in the commit history: a transaction that locks the room row with `SELECT … FOR UPDATE`, and the exclusion constraint. The constraint was kept: `FOR UPDATE` protects only the code paths that remember to take the lock, while the constraint holds for every writer, including future endpoints and scripts.

`test/bookings-race.e2e-spec.ts` sends 20 parallel `POST /bookings` for one slot:

| Version | 201 | 409 | Bookings in the database |
|---|---|---|---|
| Naive (`SELECT`, then `INSERT`) | 7–8 | 12–13 | 7–8 |
| `SELECT … FOR UPDATE` on the room | 1 | 19 | 1 |
| Exclusion constraint (final) | 1 | 19 | 1 |

The second test in the same file moves 20 bookings into one slot with parallel `PATCH /bookings/:id`: one 200, nineteen 409, one booking in the slot.

### Room changes and bookings

A booking also depends on its room: the room must be active and `attendeesCount` must not exceed `capacity`. Without a lock a booking could pass these checks while an admin deactivates the room or lowers its capacity in a parallel request.

- `POST /bookings` and a time change in `PATCH /bookings/:id` read the room with `FOR SHARE` in the same transaction as the write.
- `PATCH /rooms/:id` locks the room with `FOR NO KEY UPDATE` before changing it. A new `capacity` must not be less than `attendeesCount` of any confirmed booking that has not ended yet, otherwise 409.
- `FOR SHARE` and `FOR NO KEY UPDATE` wait for each other, so a room change and a booking in that room run one after another and each sees the result of the other. Bookings do not wait for each other: two `FOR SHARE` locks on one row are compatible.
- `FOR NO KEY UPDATE` instead of `FOR UPDATE`: it does not block the foreign key checks of new bookings, which take `FOR KEY SHARE` on the room.
- Parallel `PATCH /rooms/:id` with `equipmentIds` also run one after another, so they no longer collide on the room–equipment links.

## Performance

Measured on the bulk data set (`SEED_BULK=true`: 5008 rooms, 23 equipment items, 10013 room–equipment links, 201 users, 100 000 bookings).

### No N+1 in `GET /rooms`

The number of SQL queries does not depend on the page size (counted with `log_statement = 'all'` in Postgres):

| Request | Rooms on the page | SQL queries |
|---|---|---|
| `GET /rooms?limit=5` | 5 | 4 |
| `GET /rooms?limit=20` | 20 | 4 |
| `GET /rooms?limit=100` | 100 | 4 |
| `GET /rooms?limit=100&floor=3&minCapacity=10` | 100 | 4 |

The 4 queries run in one transaction: rooms of the page, their equipment links (one `WHERE "roomId" IN (...)`), the equipment itself (one `WHERE id IN (...)`) and `COUNT(*)` for `total`.

### Indexes used by the room filters

Plans from `EXPLAIN (ANALYZE, COSTS OFF)` after `ANALYZE "Room"; ANALYZE "RoomEquipment";`.

`floor = 3` uses `Room_floor_idx`:

```
Aggregate (actual time=0.051..0.052 rows=1 loops=1)
  ->  Index Only Scan using "Room_floor_idx" on "Room" (actual time=0.035..0.044 rows=155 loops=1)
        Index Cond: (floor = 3)
        Heap Fetches: 6
Planning Time: 0.243 ms
Execution Time: 0.093 ms
```

`minCapacity=38` (`capacity >= 38`) uses `Room_capacity_idx`:

```
Aggregate (actual time=0.076..0.076 rows=1 loops=1)
  ->  Index Only Scan using "Room_capacity_idx" on "Room" (actual time=0.036..0.057 rows=384 loops=1)
        Index Cond: (capacity >= 38)
        Heap Fetches: 4
Planning Time: 0.190 ms
Execution Time: 0.101 ms
```

`equipment=<id>` (`WHERE EXISTS` on `RoomEquipment`, as generated by Prisma for `some`) uses `RoomEquipment_equipmentId_idx`:

```
Aggregate (actual time=0.932..0.932 rows=1 loops=1)
  ->  Hash Join (actual time=0.235..0.913 rows=500 loops=1)
        Hash Cond: (r.id = t0."roomId")
        ->  Seq Scan on "Room" r (actual time=0.002..0.284 rows=5008 loops=1)
        ->  Hash (actual time=0.223..0.224 rows=500 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 32kB
              ->  Bitmap Heap Scan on "RoomEquipment" t0 (actual time=0.044..0.175 rows=500 loops=1)
                    Recheck Cond: ("equipmentId" = '5f9cb5b8-e4c5-42e8-8541-02dc0fddf0f1'::uuid)
                    Heap Blocks: exact=74
                    ->  Bitmap Index Scan on "RoomEquipment_equipmentId_idx" (actual time=0.036..0.036 rows=500 loops=1)
                          Index Cond: ("equipmentId" = '5f9cb5b8-e4c5-42e8-8541-02dc0fddf0f1'::uuid)
Planning Time: 0.651 ms
Execution Time: 0.978 ms
```

The links are found through the index. 10% of the rooms match, so reading `Room` once and joining by hash is cheaper than 500 separate lookups.

A page (`floor=3&minCapacity=10`, `ORDER BY name LIMIT 20`) reads rooms in name order through the unique index `Room_name_key` and stops after 20 matches, without sorting the whole table:

```
Limit (actual time=0.038..0.130 rows=20 loops=1)
  ->  Index Scan using "Room_name_key" on "Room" (actual time=0.037..0.128 rows=20 loops=1)
        Filter: ((capacity >= 10) AND (floor = 3))
        Rows Removed by Filter: 745
Planning Time: 0.240 ms
Execution Time: 0.143 ms
```

To reproduce:

```bash
SEED_BULK=true npx prisma db seed
docker compose exec db psql -U booking -d booking -c 'ANALYZE "Room"; ANALYZE "RoomEquipment";'
docker compose exec db psql -U booking -d booking -c 'EXPLAIN (ANALYZE, COSTS OFF) SELECT count(*) FROM "Room" WHERE floor = 3'
```

### No N+1 in `GET /bookings`

Every booking in the list comes with its room and user. The number of SQL queries does not depend on the page size or the role (counted with `log_statement = 'all'`):

| Who | Request | Bookings on the page | SQL queries |
|---|---|---|---|
| admin | `GET /bookings?limit=5` | 5 | 4 |
| admin | `GET /bookings?limit=20` | 20 | 4 |
| admin | `GET /bookings?limit=100` | 100 | 4 |
| admin | `GET /bookings?limit=100&status=confirmed&from=…&to=…` | 100 | 4 |
| admin | `GET /bookings?roomId=…&limit=100` | 20 | 4 |
| member | `GET /bookings?limit=5` | 5 | 4 |
| member | `GET /bookings?limit=100` | 100 | 4 |
| member | `GET /bookings?limit=100&from=…&to=…` | 100 | 4 |
| any | `GET /rooms/:id/availability?date=…` | — | 2 |

The 4 queries: bookings of the page, their rooms (one `WHERE id IN (...)`), their users (one `WHERE id IN (...)`) and `COUNT(*)` for `total`. Availability reads the room and then all confirmed bookings of that day (and the first 15 minutes of the next one, so that a short tail at the end of the day is not lost) in one query.

### Indexes used by the booking filters

| Index | Used by |
|---|---|
| `Booking_userId_startsAt_idx` (`userId`, `startsAt`) | a member's list: own bookings, sorted by time, with a period |
| `Booking_roomId_startsAt_idx` (`roomId`, `startsAt`) | `roomId` filter, availability of a room |
| `Booking_startsAt_id_idx` (`startsAt`, `id`) | an admin's list without `roomId`: sorting and the period filter |
| `Booking_no_overlap` (GiST, `roomId` + time range) | the exclusion constraint against double booking |

A booking overlaps the period `[from, to)` when `endsAt > from` and `startsAt < to`. `endsAt > from` alone cannot use an index on `startsAt`, so the service also adds `startsAt > from − 8 hours`: a booking lasts at most 8 hours, so one that ends after `from` started later than `from − 8 hours`. The `Booking_duration_max_8h` CHECK constraint guarantees this in the database. With both bounds the index reads only the requested period.

`status` has no index of its own: it has two values, and it is checked on the rows already found by the other conditions.

Plans from `EXPLAIN (ANALYZE, COSTS OFF)` after `VACUUM ANALYZE "Booking";`.

A member's page (`userId = …`, `ORDER BY "startsAt", id LIMIT 20`):

```
Limit (actual time=0.318..0.322 rows=20 loops=1)
  ->  Incremental Sort (actual time=0.317..0.318 rows=20 loops=1)
        Sort Key: "startsAt", id
        Presorted Key: "startsAt"
        Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
        ->  Index Scan using "Booking_userId_startsAt_idx" on "Booking" (actual time=0.036..0.234 rows=26 loops=1)
              Index Cond: ("userId" = 'e1c4c627-316b-4175-923a-44b5108ccac5'::uuid)
Planning Time: 0.738 ms
Execution Time: 0.378 ms
```

A member's page for October (`from=2026-10-01`, `to=2026-10-31`):

```
Limit (actual time=0.180..0.182 rows=20 loops=1)
  ->  Incremental Sort (actual time=0.179..0.180 rows=20 loops=1)
        Sort Key: "startsAt", id
        Presorted Key: "startsAt"
        Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
        ->  Index Scan using "Booking_userId_startsAt_idx" on "Booking" (actual time=0.022..0.147 rows=26 loops=1)
              Index Cond: (("userId" = 'e1c4c627-316b-4175-923a-44b5108ccac5'::uuid) AND ("startsAt" > '2026-09-30 16:00:00+00'::timestamp with time zone) AND ("startsAt" < '2026-10-31 00:00:00+00'::timestamp with time zone))
              Filter: ("endsAt" > '2026-10-01 00:00:00+00'::timestamp with time zone)
Planning Time: 0.405 ms
Execution Time: 0.204 ms
```

`roomId = …`:

```
Limit (actual time=0.055..0.058 rows=20 loops=1)
  ->  Sort (actual time=0.055..0.056 rows=20 loops=1)
        Sort Key: "startsAt", id
        Sort Method: quicksort  Memory: 27kB
        ->  Bitmap Heap Scan on "Booking" (actual time=0.036..0.037 rows=20 loops=1)
              Recheck Cond: ("roomId" = '8e170bcb-8731-4ce7-be0b-cbc74c26cef1'::uuid)
              Heap Blocks: exact=1
              ->  Bitmap Index Scan on "Booking_roomId_startsAt_idx" (actual time=0.026..0.026 rows=20 loops=1)
                    Index Cond: ("roomId" = '8e170bcb-8731-4ce7-be0b-cbc74c26cef1'::uuid)
Planning Time: 0.334 ms
Execution Time: 0.079 ms
```

An admin's page without filters reads the first 20 rows of `Booking_startsAt_id_idx` (before this index: a sequential scan of all 100 000 rows and a sort, 10 ms):

```
Limit (actual time=0.010..0.090 rows=20 loops=1)
  ->  Index Scan using "Booking_startsAt_id_idx" on "Booking" (actual time=0.010..0.088 rows=20 loops=1)
Planning Time: 0.306 ms
Execution Time: 0.107 ms
```

An admin's page for October with `status=confirmed` (before: a sequential scan, 7.7 ms):

```
Limit (actual time=0.981..0.993 rows=20 loops=1)
  ->  Index Scan using "Booking_startsAt_id_idx" on "Booking" (actual time=0.980..0.991 rows=20 loops=1)
        Index Cond: (("startsAt" > '2026-09-30 16:00:00+00'::timestamp with time zone) AND ("startsAt" < '2026-10-31 00:00:00+00'::timestamp with time zone))
        Filter: (("endsAt" > '2026-10-01 00:00:00+00'::timestamp with time zone) AND (status = 'confirmed'::"BookingStatus"))
        Rows Removed by Filter: 333
Planning Time: 0.369 ms
Execution Time: 1.006 ms
```

Availability of a room for 2026-10-21:

```
Index Scan using "Booking_roomId_startsAt_idx" on "Booking" (actual time=0.059..0.059 rows=1 loops=1)
  Index Cond: (("roomId" = '9351734f-f883-4f1c-b7bb-cec095f1feb7'::uuid) AND ("startsAt" > '2026-10-20 16:00:00+00'::timestamp with time zone) AND ("startsAt" < '2026-10-22 00:15:00+00'::timestamp with time zone))
  Filter: (("endsAt" > '2026-10-21 00:00:00+00'::timestamp with time zone) AND (status = 'confirmed'::"BookingStatus"))
Planning Time: 0.785 ms
Execution Time: 0.103 ms
```

To reproduce:

```bash
SEED_BULK=true npx prisma db seed
docker compose exec db psql -U booking -d booking -c 'VACUUM ANALYZE "Booking";'
docker compose exec db psql -U booking -d booking -c 'EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM "Booking" ORDER BY "startsAt", id LIMIT 20'
```
