# D2F Evidence Archive — architecture gap analysis

Date: 2026-09-23

Status: baseline before implementation
D2F Gestion reference URL: `https://gestion.d2fcompliant.org`

## Scope and evidence inspected

The target directory was empty and was not a Git repository. It contained no application, database, deployment, tests, Support record, or release metadata.

The following D2F Gestion reference checkout was inspected read-only because it is the most recent local copy found:

- path: `/Users/patricegleizes/Documents/Codex/2026-08-11/re/d2f-platform-src`;
- branch: `main`;
- commit: `0089d08f9f1096ab0d0f3a7dd0563a92aebc0f46`;
- package version: `3.48.2`;
- note: its `origin` points to an older local checkout and it is 184 commits ahead, so it is a contract reference, not an unquestioned deployment source of truth.

The live D2F Gestion URL returned HTTPS 200 on 2026-09-23 and is served through Cloudflare/Vinext.

Inspected contract sources:

- `lib/integrations.ts`;
- `lib/integration-api.ts`;
- `lib/integration-webhooks.ts`;
- `platform/README.md`;
- `platform/architecture-baseline.md`;
- `platform/platform-manifest.json`;
- `platform/contracts/openapi/gestion-platform.v1.yaml`;
- `platform/contracts/openapi/integration-hub.v1.yaml`;
- `platform/contracts/events/event-envelope.v1.schema.json`;
- `supabase/migrations/20260716110000_integrations_and_transmissions.sql`;
- existing Integration Hub, GED, webhook, platform-contract, and Support migrations/tests.

## Verified D2F compatibility boundary

D2F Gestion already recognises the integration type `archive`. Its archive connector:

- calls `GET /health` using the configured connector base URL;
- calls `POST /archives` with the document as the raw HTTP request body;
- supplies `content-type`, `x-d2f-document-id`, and `x-d2f-document-number`;
- authenticates with either `Authorization: Bearer <secret>` or a configurable API-key header;
- accepts a response identifier from `id`, `remote_id`, or `archive_id`;
- persists the returned `status` and full receipt in `d2f_transmissions`;
- requires HTTPS and rejects local/private connector URLs.

The compatibility routes must therefore remain thin adapters over the same application service as `/api/v1/archives`; they must not form a second archive engine.

The canonical D2F event envelope v1 requires `eventId`, `eventType`, `eventVersion`, `eventCategory`, dates, producer, subject, tenant/legal-entity context, actor, trace, contract, security, payload, and metadata. SAE event contracts will extend this envelope rather than create a competing transport.

The Integration Hub already uses OAuth2 client credentials, scoped service accounts, idempotency keys, HMAC-SHA256 webhook signatures over `timestamp.rawBody`, exponential retry, and dead-letter delivery state. SAE must align with these conventions.

## Gap matrix

| Capability | Existing in target | Reusable D2F contract | Gap / required implementation |
| --- | --- | --- | --- |
| Independent repository and lifecycle | No | None | Create dedicated Git repository, CI, versioning, migrations, release process, and environments. |
| Archive connector compatibility | No | `archive`, `/health`, `/archives`, raw body and D2F headers | Implement unchanged and cover by contract tests. |
| Versioned public API | No | D2F `/api/v1`, OAuth2 and idempotency conventions | Implement OpenAPI 3.1 and all required archive lifecycle routes. |
| Tenant and legal-entity isolation | No | D2F tenant/context vocabulary | Derive scope from authenticated principal; never trust browser tenant identifiers. |
| Evidential storage | No | D2F evidence vocabulary only | Store originals separately from metadata and manifestations; never overwrite originals. |
| Cryptographic evidence | No | SHA-256 and canonical envelope conventions | Add algorithm-versioned object hashes, canonical manifest hashes, chained audit entries, verification, and renewal records. |
| Timestamping | No | None | Define RFC 3161 provider port. Internal dev timestamps must be labelled non-qualified. |
| Immutability/WORM | No | None | Separate application append-only, cryptographic integrity, and provider retention lock. Reject evidential-production readiness when provider capabilities are absent. |
| Retention/legal hold | No | GED connector advertises retention/legal hold | Version policies at deposit; prevent early destruction and destruction under hold. |
| Controlled destruction | No | None | Request, approve, eligibility check, execute, and issue destruction evidence. No direct delete route. |
| Audit | No | D2F append-only/audit concepts | Add tenant-scoped chained audit with immutable database controls and verifiable export. |
| Webhooks | No | D2F HMAC-SHA256 raw-body convention | Add one-time secrets, retry history, replay, backoff, and dead letter. |
| Export and independent verifier | No | None | Produce portable packages and a verifier that needs neither SAE nor D2F database access. |
| UI | No | D2F visual/product conventions only | Build dashboard, archive search/detail, Evidence Center, and integration administration. |
| Observability | No | Correlation IDs and structured integration errors | Add structured logs, metrics, traces, readiness and dependency health without document content. |
| Support traceability | No local record | D2F Support exists in Gestion | A D2F Support case ID is still required before production release; no parallel ticket store will be invented. |
| Certification | None | None | Track conformity evidence without claiming NF 461/NF Z42-013 certification. |

## Proposed independent architecture

The first implementation target is a Cloudflare Worker running on the current compatibility date, with:

- D1 for relational metadata, idempotency, policy versions, jobs, and append-only audit rows;
- R2 for original objects, representations, evidence manifests, reports, and export packages;
- a storage capability interface so a retention-locked/WORM-capable provider can replace or complement R2;
- Web Crypto for SHA-256 and HMAC-SHA256;
- an RFC 3161 timestamp-provider interface with an explicitly non-qualified development provider;
- queues/workflows in a later deployment lot for periodic verification, export generation, destruction, and webhook delivery;
- generated Worker binding types, structured observability, and no source-controlled secrets.

Cloudflare R2 bucket locks can contribute infrastructure retention controls, but the deployed environment must be assessed and configured explicitly. The application will not claim WORM or evidential-production qualification merely because an R2 object exists or an application endpoint forbids mutation.

## Consistency model

D1 and object storage do not share a transaction. Deposit therefore uses a recoverable state machine:

1. authenticate and derive tenant/legal entity;
2. reserve the idempotency key and archive ID;
3. register `RECEIVED`;
4. stream the immutable original to object storage while hashing;
5. persist object metadata and the evidence manifest;
6. append the audit/event evidence;
7. transition to `SEALED`, then `PRESERVED` only when required durability capabilities are satisfied;
8. return an idempotent receipt.

Failures remain visible as `ERROR`; retries reconcile the reserved archive instead of creating duplicates. Periodic reconciliation must detect orphaned database rows and objects.

## Security decisions

- Bearer/API-key compatibility is limited to scoped service credentials stored as hashes.
- OAuth2 client credentials is the modern API target.
- Raw secrets are returned only once and never logged.
- Every query and object key is tenant-scoped server-side.
- File size and MIME allowlists are enforced before persistence; malware scanning is a pluggable quarantine gate.
- Original object reads are authorized and audited.
- No document content is emitted to logs.
- Signing and timestamp keys are external secret/KMS concerns, separate from archived application data.

## Incremental delivery plan

1. **Foundation 0.1.0** — repository, migration, domain model, raw/v1 deposit, hash manifest, chained audit, idempotency, verification, D2F compatibility tests, OpenAPI, and operational documentation.
2. **Lifecycle 0.2.0** — retention policy versioning, legal hold, controlled destruction, jobs, and evidence reports.
3. **Portability 0.3.0** — export package and independent `d2f-archive-verify` CLI.
4. **Integration 0.4.0** — OAuth2 service accounts, D2F canonical events, signed webhooks, retries/dead letters, and Platform connector manifest.
5. **Console 0.5.0** — D2F-styled tenant UI, Evidence Center, integrations, RBAC, and operational dashboards.
6. **Production qualification 1.0.0** — external TSA/KMS, retention-locked storage, malware service, DR evidence, performance/security testing, Support record, dedicated production URL, and conformity assessment. Certification remains a separate external outcome.

## Release blockers discovered

- The SAE target had no remote repository or deployment project.
- No dedicated SAE production URL was supplied. `https://gestion.d2fcompliant.org` is the confirmed D2F Gestion reference URL and cannot also be used as the independent SAE endpoint without violating product independence.
- No D1/R2 production resource IDs, Cloudflare deployment authorization, external TSA, KMS/HSM, malware provider, or WORM qualification evidence is available.
- No existing D2F Support case ID was provided or safely discoverable from source alone.
- The locally newest D2F checkout has remote/topology ambiguity; its contracts are usable evidence, but production parity should be confirmed through the published API/manifest before a 1.0 release.

These blockers do not prevent local implementation and tests. They prevent an honest production or certification claim.
