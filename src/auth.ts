import { sha256 } from "./crypto";
import { ApiError, type Principal } from "./types";

type CredentialRow = {
  id: string;
  tenant_id: string;
  legal_entity_id: string | null;
  application_id: string;
  scopes_json: string;
  expires_at: string | null;
  revoked_at: string | null;
  tenant_status: string;
  legal_status: string | null;
};

function extractCredential(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return request.headers.get("x-api-key")?.trim() ?? "";
}

export async function authenticate(request: Request, env: Env, requiredScope?: string): Promise<Principal> {
  const credential = extractCredential(request);
  if (credential.length < 24) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "A valid Bearer token or x-api-key is required.");
  const row = await env.DB.prepare(`
    SELECT c.id, c.tenant_id, c.legal_entity_id, c.application_id, c.scopes_json,
           c.expires_at, c.revoked_at, t.status AS tenant_status, le.status AS legal_status
      FROM api_credentials c
      JOIN tenants t ON t.id = c.tenant_id
 LEFT JOIN legal_entities le ON le.id = c.legal_entity_id AND le.tenant_id = c.tenant_id
     WHERE c.key_sha256 = ?
  `).bind(await sha256(credential)).first<CredentialRow>();
  if (!row || row.revoked_at || row.tenant_status !== "active" || (row.legal_entity_id && row.legal_status !== "active")) {
    throw new ApiError(401, "INVALID_CREDENTIAL", "The API credential is invalid, revoked, or inactive.");
  }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw new ApiError(401, "EXPIRED_CREDENTIAL", "The API credential has expired.");
  let scopes: readonly string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.scopes_json);
    scopes = Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch {
    throw new ApiError(500, "INVALID_CREDENTIAL_CONFIGURATION", "The API credential scope configuration is invalid.");
  }
  if (requiredScope && !scopes.includes(requiredScope)) throw new ApiError(403, "INSUFFICIENT_SCOPE", `The credential requires the ${requiredScope} scope.`);
  if (!row.legal_entity_id) throw new ApiError(403, "LEGAL_ENTITY_REQUIRED", "The credential is not scoped to a legal entity.");
  await env.DB.prepare("UPDATE api_credentials SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  return { credentialId: row.id, tenantId: row.tenant_id, legalEntityId: row.legal_entity_id, applicationId: row.application_id, scopes };
}

export function describePrincipal(principal: Principal): Record<string, unknown> {
  const has = (scope: string) => principal.scopes.includes(scope);
  let profile = "Consultation";
  if (has("archives:write")) profile = "Archiviste";
  if (has("archives:legal-hold")) profile = "Juridique & conformité";
  if (has("archives:write") && has("archives:legal-hold") && has("archives:destruction-request")) profile = "Administrateur SAE";
  return {
    applicationId: principal.applicationId,
    tenantId: principal.tenantId,
    legalEntityId: principal.legalEntityId,
    profile,
    scopes: principal.scopes,
    capabilities: {
      read: has("archives:read"),
      deposit: has("archives:write"),
      readEvidence: has("evidence:read"),
      verify: has("evidence:verify"),
      legalHold: has("archives:legal-hold"),
      export: has("archives:export"),
      requestDestruction: has("archives:destruction-request"),
    },
  };
}
