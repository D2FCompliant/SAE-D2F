CREATE TABLE operator_credentials (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  key_sha256 TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE tenant_subscriptions (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  plan_code TEXT NOT NULL,
  billing_mode TEXT NOT NULL CHECK (billing_mode IN ('quote','fixed','usage','hybrid')),
  currency TEXT NOT NULL,
  base_price_minor INTEGER,
  included_storage_bytes INTEGER,
  overage_price_minor_per_gb INTEGER,
  billing_status TEXT NOT NULL CHECK (billing_status IN ('quote','trial','active','past_due','suspended','cancelled')),
  effective_from TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX operator_credentials_active_idx
  ON operator_credentials(revoked_at, expires_at);
