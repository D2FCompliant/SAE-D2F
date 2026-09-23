# Backup and restore

Before production, schedule encrypted D1 exports and provider-supported R2 inventory/replication into an independently controlled recovery location. Backups must preserve object bytes, custom metadata, manifests, audit chains and migration state.

A restore is valid only after database/object reconciliation and full cryptographic verification. Restoring metadata without objects, or objects without their manifest/audit context, is a failed restore.

Release `0.1.0` documents this control but does not provision automated backups.
