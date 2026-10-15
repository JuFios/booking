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
- CHECK constraints repeat the time rules of the service: `startsAt < endsAt`, a duration from 15 minutes to 8 hours.

How each operation works with the constraint:

| Operation | SQL | Slot is taken |
|---|---|---|
| `POST /bookings` | `INSERT … ON CONFLICT ON CONSTRAINT "Booking_no_overlap" DO NOTHING RETURNING id` | no row is returned → 409 |
| `PATCH /bookings/:id` with a new time | `pg_advisory_xact_lock(hashtext(roomId))`, then `UPDATE … WHERE status = 'confirmed'` | Postgres error `23P01` → 409 |
| `POST /bookings/:id/cancel` | `UPDATE … SET status = 'cancelled' WHERE status = 'confirmed'` | — (of parallel cancels only one changes the row) |

- **Why `ON CONFLICT DO NOTHING`.** A plain `INSERT` writes the row first and then checks the constraint. Parallel inserts into one slot wait for each other and Postgres aborts some of them as a deadlock (114 of 800 inserts in a test, each a 500). With `ON CONFLICT` Postgres checks the constraint first and skips the row: 0 deadlocks. `ON CONSTRAINT "Booking_no_overlap"` limits the skip to this constraint: any other conflict (for example, a unique constraint added later) stays an error instead of a false 409.
- **Why the advisory lock in `PATCH`.** `UPDATE` has no `ON CONFLICT`, and parallel updates into one slot deadlock the same way. The lock makes time changes within one room run one after another; it is taken only when the time changes and is released at the end of the transaction. The constraint still decides whether the new time is free.

Two solutions were tried, both are in the commit history: a transaction that locks the room row with `SELECT … FOR UPDATE`, and the exclusion constraint. The constraint was kept: `FOR UPDATE` protects only the code paths that remember to take the lock, while the constraint holds for every writer, including future endpoints and scripts.

`test/bookings-race.e2e-spec.ts` sends 20 parallel `POST /bookings` for one slot:

| Version | 201 | 409 | Bookings in the database |
|---|---|---|---|
| Naive (`SELECT`, then `INSERT`) | 7–8 | 12–13 | 7–8 |
| `SELECT … FOR UPDATE` on the room | 1 | 19 | 1 |
| Exclusion constraint (final) | 1 | 19 | 1 |

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

The 4 queries: bookings of the page, their rooms (one `WHERE id IN (...)`), their users (one `WHERE id IN (...)`) and `COUNT(*)` for `total`. Availability reads the room and then all confirmed bookings of that day in one query.

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
Index Scan using "Booking_roomId_startsAt_idx" on "Booking" (actual time=0.027..0.027 rows=1 loops=1)
  Index Cond: (("roomId" = '8e170bcb-8731-4ce7-be0b-cbc74c26cef1'::uuid) AND ("startsAt" > '2026-10-20 16:00:00+00'::timestamp with time zone) AND ("startsAt" < '2026-10-22 00:00:00+00'::timestamp with time zone))
  Filter: (("endsAt" > '2026-10-21 00:00:00+00'::timestamp with time zone) AND (status = 'confirmed'::"BookingStatus"))
Planning Time: 0.299 ms
Execution Time: 0.043 ms
```

To reproduce:

```bash
SEED_BULK=true npx prisma db seed
docker compose exec db psql -U booking -d booking -c 'VACUUM ANALYZE "Booking";'
docker compose exec db psql -U booking -d booking -c 'EXPLAIN (ANALYZE, COSTS OFF) SELECT * FROM "Booking" ORDER BY "startsAt", id LIMIT 20'
```
