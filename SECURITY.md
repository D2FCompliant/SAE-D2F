# Security

## Implemented

- Tenant and legal entity come from the authenticated credential, not request data.
- Credential secrets are stored only as SHA-256 hashes and may be revoked or expired.
- Bearer and `x-api-key` are supported; authorization scopes are enforced per route.
- Original object keys are tenant-prefixed and metadata queries include tenant/legal-entity scope.
- Accepted MIME types and a 20 MiB request bound are enforced before persistence.
- No document content is logged; error responses include correlation IDs.
- Original objects, manifests, and audit entries have database-level no-update/no-delete triggers.
- IDs use Web Crypto UUIDs and hashes use Web Crypto SHA-256.

## Required before production

- OAuth2 client-credentials token service and credential rotation UI;
- rate limiting, brute-force controls and Cloudflare API Shield/WAF policy;
- malware quarantine provider and file signature inspection;
- KMS/HSM-backed signing and key separation;
- external RFC 3161 TSA validation;
- retention-locked storage configuration and independent qualification evidence;
- penetration testing, dependency scanning in CI, alerting and incident runbooks;
- administrator separation and MFA-ready human identity/RBAC.

Report security issues through the existing D2F Support process. Do not include document payloads or secrets in reports.
