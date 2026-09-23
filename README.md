# D2F Evidence Archive

D2F Evidence Archive is an independent Electronic Archiving System designed for evidential preservation. It is not embedded in D2F Gestion or D2F Enterprise Platform, uses no shared database, and makes no certification or automatic legal-proof claim.

Current release: `0.3.1` (client and D2F operator consoles, not qualified for evidential production).

## Implemented foundation

- Cloudflare Worker API with D1 metadata and R2 objects;
- D2F Gestion compatibility routes `GET /health` and raw `POST /archives`;
- formal `/api/v1` deposit, reads, evidence, verification, legal hold, controlled destruction request, export job and job status routes;
- SHA-256 object and canonical manifest hashes;
- append-only chained audit rows protected by database triggers;
- tenant/legal-entity scoping derived from API credentials;
- Bearer and `x-api-key` authentication with hashed, revocable credentials;
- idempotent deposit receipts;
- integrity tests for altered, missing, and unchanged evidence.
- tenant-scoped, versioned retention policies with a mandatory 120-month minimum and calendar-based expiry;
- responsive document-management console at `/console` with server-enforced, scope-based profiles;
- separate D2F operator console at `/admin` for tenant onboarding, 10-year policy provisioning, subscriptions and one-time credential issuance;
- tenant/legal-entity isolated document search, download, evidence, verification, legal hold, export and controlled destruction request;
- compatibility for the D2F Gestion connector paths `/archives/{id}/verify` and `/archives/{id}/evidence`.

The environment reports `evidentialProductionReady: false` until retention-locked storage and an external RFC 3161 timestamp provider are configured and verified.

## Node 22

The repository requires Node `>=22.12 <23`. Use Node 22 for every command.

```bash
npm ci
npm run types
npm run check
```

`npm run check` performs TypeScript validation, the Workers integration suite, and a Wrangler production dry-run.

## Local run

```bash
npm run db:migrate:local
npm run dev
```

Create local API credentials by hashing the secret with SHA-256 and inserting only the hash into `api_credentials`. Never commit `.dev.vars`, raw credentials, tokens, or signing keys.

## Documentation

- [Architecture gap analysis](docs/ARCHITECTURE-GAP-ANALYSIS.md)
- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Evidence model](EVIDENCE-MODEL.md)
- [Retention model](RETENTION-MODEL.md)
- [API](API.md) and [OpenAPI](OPENAPI.yaml)
- [D2F Business integration](INTEGRATION-D2F-BUSINESS.md)
- [D2F Platform integration](INTEGRATION-D2F-PLATFORM.md)
- [Operations](OPERATIONS.md), [backup/restore](BACKUP-RESTORE.md), and [disaster recovery](DISASTER-RECOVERY.md)
- [Conformity mapping](CONFORMITY-MAPPING.md)

## Production status

No production deployment is represented by this repository yet. `https://gestion.d2fcompliant.org` is the confirmed D2F Gestion integration target, not the independent SAE production endpoint. A dedicated SAE domain, Cloudflare resources, Support case, qualified storage posture, external TSA/KMS and release authorization remain required.
