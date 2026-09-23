CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  organisation_name TEXT NOT NULL,
  country TEXT NOT NULL,
  data_residency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TEXT NOT NULL
);

CREATE TABLE legal_entities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  legal_name TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, id)
);

CREATE TABLE api_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  legal_entity_id TEXT REFERENCES legal_entities(id),
  application_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  display_name TEXT NOT NULL,
  key_sha256 TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE retention_policies (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  version INTEGER NOT NULL,
  jurisdiction TEXT NOT NULL,
  document_category TEXT NOT NULL,
  start_event TEXT NOT NULL,
  duration_months INTEGER NOT NULL CHECK (duration_months >= 0),
  legal_basis TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id, version)
);

CREATE TABLE archives (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  legal_entity_id TEXT NOT NULL REFERENCES legal_entities(id),
  source_system TEXT NOT NULL,
  source_document_id TEXT,
  source_document_number TEXT,
  document_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  original_filename TEXT,
  document_created_at TEXT,
  deposited_at TEXT NOT NULL,
  preservation_started_at TEXT,
  retention_policy_id TEXT,
  retention_policy_version INTEGER,
  retention_expires_at TEXT,
  legal_hold_count INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('RECEIVED','VALIDATING','VALIDATED','SEALED','PRESERVED','UNDER_LEGAL_HOLD','RETENTION_EXPIRED','DESTRUCTION_PENDING','DESTROYED','ERROR')),
  classification TEXT NOT NULL,
  confidentiality TEXT NOT NULL,
  personal_data_classification TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX archives_tenant_deposited_idx ON archives(tenant_id, deposited_at DESC);
CREATE INDEX archives_tenant_source_idx ON archives(tenant_id, source_system, source_document_id);
CREATE INDEX archives_tenant_number_idx ON archives(tenant_id, source_document_number);

CREATE TABLE archive_objects (
  id TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL REFERENCES archives(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  role TEXT NOT NULL CHECK (role IN ('original','structured','representation','attachment','metadata','technical_evidence')),
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  original_filename TEXT,
  length_bytes INTEGER NOT NULL CHECK (length_bytes >= 0),
  hash_algorithm TEXT NOT NULL,
  hash_value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE evidence_manifests (
  id TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL UNIQUE REFERENCES archives(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  schema_version TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  previous_evidence_hash TEXT,
  timestamp_type TEXT NOT NULL,
  timestamp_token TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE idempotency_records (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  archive_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE TABLE audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  legal_entity_id TEXT,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  source_ip TEXT,
  correlation_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  result TEXT NOT NULL,
  application_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE
);

CREATE UNIQUE INDEX audit_events_chain_idx ON audit_events(tenant_id, previous_hash);

CREATE TABLE legal_holds (
  id TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL REFERENCES archives(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reason TEXT NOT NULL,
  authority TEXT NOT NULL,
  applied_by TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  released_by TEXT,
  released_at TEXT
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  archive_id TEXT REFERENCES archives(id),
  job_type TEXT NOT NULL CHECK (job_type IN ('verification','export','destruction','evidence_renewal')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  request_json TEXT NOT NULL,
  result_json TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE destruction_requests (
  id TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL REFERENCES archives(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','approved','rejected','executed','failed')),
  approved_by TEXT,
  approved_at TEXT,
  certificate_object_key TEXT
);

CREATE TRIGGER archive_objects_no_update BEFORE UPDATE ON archive_objects BEGIN
  SELECT RAISE(ABORT, 'archive objects are immutable');
END;
CREATE TRIGGER archive_objects_no_delete BEFORE DELETE ON archive_objects BEGIN
  SELECT RAISE(ABORT, 'archive objects cannot be deleted directly');
END;
CREATE TRIGGER evidence_manifests_no_update BEFORE UPDATE ON evidence_manifests BEGIN
  SELECT RAISE(ABORT, 'evidence manifests are immutable');
END;
CREATE TRIGGER evidence_manifests_no_delete BEFORE DELETE ON evidence_manifests BEGIN
  SELECT RAISE(ABORT, 'evidence manifests cannot be deleted directly');
END;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;

-- Local/test bootstrap only. Production provisioning must create isolated tenants and hashed credentials separately.
INSERT INTO tenants (id, organisation_name, country, data_residency, status, created_at)
VALUES ('tenant-demo', 'D2F Demo', 'FR', 'EU', 'active', '2026-09-23T00:00:00.000Z');
INSERT INTO legal_entities (id, tenant_id, legal_name, country, status, created_at)
VALUES ('legal-demo', 'tenant-demo', 'D2F Demo France', 'FR', 'active', '2026-09-23T00:00:00.000Z');
