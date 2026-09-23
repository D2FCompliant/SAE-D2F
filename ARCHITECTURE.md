# Architecture

## Product boundary

D2F Evidence Archive owns its API, D1 database, R2 bucket, credentials, versions, and release lifecycle. D2F Gestion and third parties communicate only through versioned HTTPS APIs and, in later releases, canonical events and signed webhooks.

## Runtime components

- `src/index.ts`: routing and versioned/compatibility adapters;
- `src/auth.ts`: tenant- and legal-entity-scoped credential authentication;
- `src/archive-service.ts`: shared deposit, retrieval, and verification application service;
- `src/lifecycle-service.ts`: legal hold, destruction request, export job and job reads;
- `src/audit.ts`: SHA-256 chained append-only events;
- D1: metadata, lifecycle, policy, idempotency, audit and jobs;
- R2: originals and evidence manifests.

The compatibility and v1 deposit routes use the same `depositArchive` service.

## Deposit state machine

`RECEIVED → PRESERVED` is implemented. A failed storage/metadata finalization becomes `ERROR`. `UNDER_LEGAL_HOLD` and `DESTRUCTION_PENDING` are explicit. Direct transition to `DESTROYED` is not exposed.

D1 and R2 do not share a transaction. The idempotency reservation and `RECEIVED` row are created before object storage. A reconciliation worker is required before production to recover `ERROR` and stale `in_progress` deposits and locate orphans.

## Provider posture

R2 and D1 are accessed through bindings, never the Cloudflare REST API. Storage capability is surfaced at runtime. `application-only` means API-level append-only controls and cryptographic verification exist, but infrastructure WORM qualification is not asserted.

## Future boundaries

Queues/Workflows will process verification, export, destruction and webhook delivery. RFC 3161 and signing will be ports backed by external trust/KMS providers. These extensions must not change stored originals or the v1 receipt contract.
