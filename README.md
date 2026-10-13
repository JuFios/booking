# Booking API

REST API for booking meeting rooms.

## Getting started

Create the environment file:

```bash
cp .env.example .env
```

### Run with Docker

Starts the database and the API:

```bash
docker compose up --build
```

### Run locally

Starts only the database in Docker and the API on your machine with auto-reload:

```bash
npm install
docker compose up -d db
npm run start:dev
```

The API runs on http://localhost:3000, Swagger docs on http://localhost:3000/docs.
