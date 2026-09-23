# Evidence model

An archive is metadata and lifecycle state. An archived object is an independently hashed immutable binary. The database is an index and control plane; it is not itself the evidence.

At deposit, the service records SHA-256, byte length, MIME type, archive/object IDs, tenant, legal entity, source, correlation ID, deposit time, application version, evidence schema version and storage reference.

The canonical JSON manifest is serialized with recursively sorted object keys. `manifest_hash` is the SHA-256 of the exact stored manifest bytes. The original is never silently transformed. Future normalized objects must be separate objects with transformation evidence linking input and output hashes.

The current timestamp token is `internal-dev` and explicitly non-qualified. It is a deterministic development integrity marker, not an RFC 3161 or qualified timestamp.

Verification retrieves every registered object and manifest, recomputes length/hash, reports missing or altered components, and never repairs evidence silently.
