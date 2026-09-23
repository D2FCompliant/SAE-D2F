import { buildAuditStatement } from "./audit";
import { sha256 } from "./crypto";
import type { OperatorPrincipal } from "./operator-auth";
import { ApiError, type Principal } from "./types";

const CLIENT_SCOPES = [
  "archives:write", "archives:read", "evidence:read", "evidence:verify",
  "archives:legal-hold", "archives:destruction-request", "archives:export", "jobs:read",
];

function clean(value: unknown, maximum = 180): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function token(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `d2f_sae_prd_${body}`;
}

function auditPrincipal(operator: OperatorPrincipal, tenantId: string, legalEntityId: string): Principal {
  return { credentialId: operator.credentialId, tenantId, legalEntityId, applicationId: `operator:${operator.displayName}`, scopes: operator.scopes };
}

export async function listManagedTenants(env: Env): Promise<Record<string, unknown>[]> {
  const result = await env.DB.prepare(`SELECT t.id, t.organisation_name, t.country, t.data_residency, t.status, t.created_at,
      (SELECT le.id FROM legal_entities le WHERE le.tenant_id = t.id ORDER BY le.created_at LIMIT 1) AS legal_entity_id,
      (SELECT le.legal_name FROM legal_entities le WHERE le.tenant_id = t.id ORDER BY le.created_at LIMIT 1) AS legal_name,
      (SELECT le.status FROM legal_entities le WHERE le.tenant_id = t.id ORDER BY le.created_at LIMIT 1) AS legal_entity_status,
      s.plan_code, s.billing_mode, s.currency, s.base_price_minor, s.included_storage_bytes,
      s.overage_price_minor_per_gb, s.billing_status,
      (SELECT COUNT(*) FROM archives a WHERE a.tenant_id = t.id) AS archive_count,
      (SELECT COALESCE(SUM(ao.length_bytes), 0) FROM archive_objects ao WHERE ao.tenant_id = t.id AND ao.role = 'original') AS storage_bytes,
      (SELECT COUNT(*) FROM api_credentials c WHERE c.tenant_id = t.id AND c.revoked_at IS NULL) AS active_credential_count
    FROM tenants t
    LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
    WHERE t.status <> 'closed'
    ORDER BY t.created_at DESC`).all<Record<string, unknown>>();
  return result.results;
}

export async function createManagedTenant(env: Env, operator: OperatorPrincipal, input: Record<string, unknown>, correlationId: string, sourceIp: string | null) {
  const organisationName = clean(input.organisationName);
  const legalName = clean(input.legalName) || organisationName;
  const country = clean(input.country, 2).toUpperCase();
  const planCode = clean(input.planCode, 80) || "d2f-sae-quote";
  if (organisationName.length < 2 || legalName.length < 2 || !/^[A-Z]{2}$/.test(country)) throw new ApiError(400, "INVALID_TENANT", "Organisation, legal entity and ISO country are required.");
  const existing = await env.DB.prepare(`SELECT t.id AS tenant_id, le.id AS legal_entity_id, rp.id AS policy_id,
      rp.duration_months, s.billing_status
    FROM tenants t
    JOIN legal_entities le ON le.tenant_id = t.id
    JOIN retention_policies rp ON rp.tenant_id = t.id AND rp.status = 'active'
    LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
    WHERE lower(t.organisation_name) = lower(?) AND lower(le.legal_name) = lower(?) AND t.country = ?
    ORDER BY t.created_at LIMIT 1`)
    .bind(organisationName, legalName, country)
    .first<{ tenant_id: string; legal_entity_id: string; policy_id: string; duration_months: number; billing_status: string | null }>();
  if (existing) return {
    tenantId: existing.tenant_id, legalEntityId: existing.legal_entity_id, policyId: existing.policy_id,
    retentionMonths: existing.duration_months, billingStatus: existing.billing_status ?? "quote", existing: true,
  };
  const tenantId = identifier("tenant");
  const legalEntityId = identifier("legal");
  const policyId = "d2f-minimum-10-years";
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tenants (id, organisation_name, country, data_residency, status, created_at)
      VALUES (?, ?, ?, 'EU', 'active', ?)`).bind(tenantId, organisationName, country, now),
    env.DB.prepare(`INSERT INTO legal_entities (id, tenant_id, legal_name, country, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)`).bind(legalEntityId, tenantId, legalName, country, now),
    env.DB.prepare(`INSERT INTO retention_policies
      (id, tenant_id, version, jurisdiction, document_category, start_event, duration_months, legal_basis, status, created_at)
      VALUES (?, ?, 1, ?, '*', 'deposit', 120, ?, 'active', ?)`)
      .bind(policyId, tenantId, country, `D2F SAE minimum 10-year retention policy for ${country}`, now),
    env.DB.prepare(`INSERT INTO tenant_subscriptions
      (tenant_id, plan_code, billing_mode, currency, billing_status, effective_from, updated_at)
      VALUES (?, ?, 'quote', 'EUR', 'quote', ?, ?)`).bind(tenantId, planCode, now, now),
  ]);
  await (await buildAuditStatement(env, auditPrincipal(operator, tenantId, legalEntityId), {
    eventType: "TENANT_PROVISIONED", subjectType: "tenant", subjectId: tenantId, result: "success",
    payload: { organisationName, legalName, country, planCode, retentionMonths: 120 }, correlationId, sourceIp,
  })).run();
  return { tenantId, legalEntityId, policyId, retentionMonths: 120, billingStatus: "quote" };
}

export async function issueTenantCredential(env: Env, operator: OperatorPrincipal, tenantId: string, input: Record<string, unknown>, correlationId: string, sourceIp: string | null) {
  const tenant = await env.DB.prepare(`SELECT t.id, t.status, le.id AS legal_entity_id
    FROM tenants t JOIN legal_entities le ON le.tenant_id = t.id
    WHERE t.id = ? AND le.status = 'active' ORDER BY le.created_at LIMIT 1`)
    .bind(tenantId).first<{ id: string; status: string; legal_entity_id: string }>();
  if (!tenant || tenant.status !== "active") throw new ApiError(409, "TENANT_NOT_ACTIVE", "The tenant is missing or inactive.");
  const rawToken = token();
  const id = identifier("credential");
  const displayName = clean(input.displayName) || "D2F Business Suite";
  const applicationId = clean(input.applicationId, 120) || "d2f-business-suite";
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO api_credentials
    (id, tenant_id, legal_entity_id, application_id, environment, display_name, key_sha256,
     key_prefix, scopes_json, created_at)
    VALUES (?, ?, ?, ?, 'production', ?, ?, ?, ?, ?)`)
    .bind(id, tenantId, tenant.legal_entity_id, applicationId, displayName, await sha256(rawToken), rawToken.slice(0, 20), JSON.stringify(CLIENT_SCOPES), now).run();
  await (await buildAuditStatement(env, auditPrincipal(operator, tenantId, tenant.legal_entity_id), {
    eventType: "CREDENTIAL_ISSUED", subjectType: "api_credential", subjectId: id, result: "success",
    payload: { displayName, applicationId, keyPrefix: rawToken.slice(0, 20), scopes: CLIENT_SCOPES }, correlationId, sourceIp,
  })).run();
  return { id, token: rawToken, keyPrefix: rawToken.slice(0, 20), displayName, applicationId, scopes: CLIENT_SCOPES };
}

export async function setTenantStatus(env: Env, operator: OperatorPrincipal, tenantId: string, status: string, correlationId: string, sourceIp: string | null) {
  if (!['active', 'suspended', 'closed'].includes(status)) throw new ApiError(400, "INVALID_TENANT_STATUS", "Only active, suspended or closed status is accepted.");
  const legal = await env.DB.prepare("SELECT id FROM legal_entities WHERE tenant_id = ? ORDER BY created_at LIMIT 1").bind(tenantId).first<{ id: string }>();
  if (!legal) throw new ApiError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  await env.DB.prepare("UPDATE tenants SET status = ? WHERE id = ?").bind(status, tenantId).run();
  await (await buildAuditStatement(env, auditPrincipal(operator, tenantId, legal.id), {
    eventType: "TENANT_STATUS_CHANGED", subjectType: "tenant", subjectId: tenantId, result: "success",
    payload: { status }, correlationId, sourceIp,
  })).run();
  return { tenantId, status };
}

export async function revokeTenantCredential(env: Env, operator: OperatorPrincipal, tenantId: string, credentialId: string, correlationId: string, sourceIp: string | null) {
  const row = await env.DB.prepare("SELECT id, legal_entity_id, revoked_at FROM api_credentials WHERE id = ? AND tenant_id = ?")
    .bind(credentialId, tenantId).first<{ id: string; legal_entity_id: string; revoked_at: string | null }>();
  if (!row) throw new ApiError(404, "CREDENTIAL_NOT_FOUND", "Credential not found.");
  const now = new Date().toISOString();
  if (!row.revoked_at) await env.DB.prepare("UPDATE api_credentials SET revoked_at = ? WHERE id = ? AND tenant_id = ?").bind(now, credentialId, tenantId).run();
  await (await buildAuditStatement(env, auditPrincipal(operator, tenantId, row.legal_entity_id), {
    eventType: "CREDENTIAL_REVOKED", subjectType: "api_credential", subjectId: credentialId, result: "success",
    payload: { revokedAt: row.revoked_at || now }, correlationId, sourceIp,
  })).run();
  return { tenantId, credentialId, revokedAt: row.revoked_at || now };
}
