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

Fills the database with 3 equipment items and 8 rooms. The seed can be run more than once: existing records are skipped.

```bash
npx prisma db seed
```

`SEED_BULK=true` additionally creates 20 equipment items and 5000 rooms. On a small table Postgres always reads the whole table, so this data set is needed to see indexes in `EXPLAIN ANALYZE`:

```bash
SEED_BULK=true npx prisma db seed
```

The seed runs from your machine only (it needs `ts-node` and the generated Prisma client from `npm install`), not inside the API container. It works in both modes above, because the database port 5432 is published to the host.
