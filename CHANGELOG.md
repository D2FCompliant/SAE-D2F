# Changelog

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
