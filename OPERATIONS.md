# Operations

## Health

`GET /health` and `/api/v1/health` expose version, environment, evidence schema, storage immutability and evidential-production readiness without secrets.

## Quality gate

Run under Node 22:

```bash
npm ci
npm run types
npm run check
npm audit
```

## Deployment prerequisites

- dedicated D1 database and R2 bucket per environment;
- migrations applied and backed up;
- secrets provisioned outside Git;
- dedicated SAE hostname and TLS;
- production `STORAGE_IMMUTABILITY` backed by verified provider controls;
- external timestamp provider/KMS operational;
- Support case, release commit/tag, rollback reference and smoke plan.

No test environment may point at production resources. Deploy the exact tested commit. Verify the dedicated SAE domain and then perform a safe integration smoke test from D2F Gestion `.org`.
