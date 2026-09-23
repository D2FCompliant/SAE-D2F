# Integration with D2F Enterprise Platform

SAE adopts the D2F Canonical Event Envelope v1 concepts: event identity/version/category, producer, subject, tenant/legal-entity context, actor, trace/correlation, contract, security, payload and metadata.

Planned event schemas are `ArchiveDepositRequested`, `ArchiveAccepted`, `ArchiveSealed`, `ArchivePreserved`, `ArchiveVerificationFailed`, `ArchiveExportCreated`, `ArchiveLegalHoldApplied`, and `ArchiveDestroyed`.

Release `0.1.0` does not publish those events externally. Event schemas, outbox delivery, OAuth2 client credentials and connector-manifest registration are required before claiming Enterprise Platform integration complete.
