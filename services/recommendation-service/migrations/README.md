# Migrations — recommendation-service

This directory contains Drizzle-generated SQL migrations for `civitas_recommendation`.

## Generate migrations from Drizzle schema

```bash
npx drizzle-kit generate
```

## Apply migrations

```bash
npx drizzle-kit migrate
```

## Push schema directly (dev only)

```bash
npx drizzle-kit push
```

## Environment

Set `DATABASE_URL` or it defaults to `postgres://localhost:5435/civitas_recommendation`.
