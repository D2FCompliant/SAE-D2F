# Release procedure

1. Associate an existing D2F Support case.
2. Confirm clean intended Git diff and Node 22.
3. Run types, tests, dependency audit, migration validation and production dry-run.
4. Update version and `CHANGELOG.md`.
5. Commit and tag the exact release (`vX.Y.Z`).
6. Back up production metadata and confirm rollback compatibility.
7. Apply migrations and deploy the tested commit to the dedicated SAE environment.
8. Verify HTTPS, health/version, raw D2F deposit, idempotent replay, retrieval and integrity.
9. Update Support with version, full commit, deployment ID, migration, checks and rollback.

Do not use `https://gestion.d2fcompliant.org` as the SAE deployment: it is the independent D2F Gestion integration source.
