# Changelog

## 0.3.2 — 2026-09-23

### Fixed

- Client creation retains the form reference across asynchronous requests instead of failing after persistence.
- Repeated creation of the same organisation and legal entity is idempotent and no longer creates duplicate tenants.

Support: D2F-20260923-961248.
Rollback: 0.3.1 / bffd83748c376b569a5cde87993e893d4454f23b.

## 0.3.1 — 2026-09-23

### Fixed

- The operator login card is hidden after successful authentication and returns only after logout.

Support: D2F-20260923-961248.
Rollback: 0.3.0 / 3303846562c4a68f5c2334846959d98dfb9b68f2.

## 0.3.0 — 2026-09-23

### Added

- Separate D2F operator console at `/admin`, linked to the tenant archive console and Enterprise Platform.
- Tenant and legal-entity onboarding with an automatic 120-month retention policy.
- Quote/trial subscription assignment without hard-coded commercial pricing.
- Cryptographically generated tenant credentials displayed once and stored only as SHA-256 hashes.
- Operator-only tenant suspension and credential lifecycle APIs.

Support: D2F-20260923-961248.
Production: not deployed.

## 0.2.0 — 2026-09-23

### Added

- Responsive document-management console with authenticated tenant/legal-entity isolation.
- Scope-derived Consultation, Archiviste, Juridique & conformité, and Administrateur SAE profiles.
- Paginated document register, filtering, authorized download, deposit, evidence, verification, legal hold, export and destruction-request actions.
- D2F Gestion compatibility routes for the configurable unversioned verification and evidence paths.
- Automatic application of a versioned tenant retention policy with a mandatory 120-month minimum.
- EU R2 storage protected for all prefixes by a provider-enforced 3653-day bucket lock.
- Production migrations no longer provision demonstration tenants or credentials.

### Security

- Lifecycle job reads are now isolated by tenant and legal entity, matching archive access controls.

Support: D2F-20260923-961248.
Production: not deployed.

## 0.1.0 — 2026-09-23

### Added

- Independent Cloudflare Worker/D1/R2 foundation for D2F Evidence Archive.
- D2F Gestion raw archive compatibility and versioned API.
- Tenant-scoped hashed credentials, idempotency, SHA-256 manifest, append-only audit and verification.
- Legal-hold and controlled destruction-request guards.
- Worker integration regression tests and operational/conformity documentation.

Support: pending existing D2F Support case assignment.
Production: not deployed.
