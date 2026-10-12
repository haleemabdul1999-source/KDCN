# ADR 0001 — Modular monolith on PostgreSQL

**Status:** accepted · **Date:** 2026-10-12

## Context

Release 1 serves one city, one flagship mall and a pilot of home and independent vendors. The team
is small; the hardest problems are transactional correctness (orders, payments, refunds, stock) and
merchant adoption — not throughput.

## Decision

One NestJS API (a modular monolith) and one PostgreSQL database. Domain modules live in
`apps/api/src/modules/*`. Cross-module consistency uses database transactions, not messaging.
Background work runs in-process with database leases (`job_leases`). Search uses PostgreSQL
full-text search and `pg_trgm`. No Redis, Kafka, Elasticsearch, Kubernetes or microservices.

## Consequences

- Strong consistency: an order, its stock reservation, payment, settlement and notifications commit
  or roll back together.
- Horizontal scaling is still possible (stateless API, DB leases for jobs). The in-memory rate
  limiter is per instance — acceptable until multiple instances are behind a load balancer; then
  move limits to the edge/WAF or a shared store (see KNOWN_LIMITATIONS).
- Extraction path: a module whose load or team ownership diverges can be split out along its
  existing service interface (payments and search are the likeliest candidates).
