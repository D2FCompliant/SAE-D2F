import { sha256 } from "./crypto";
import { ApiError } from "./types";

export type OperatorPrincipal = {
  credentialId: string;
  displayName: string;
  scopes: readonly string[];
};

type OperatorCredentialRow = {
  id: string;
  display_name: string;
  scopes_json: string;
  expires_at: string | null;
  revoked_at: string | null;
};

function credentialFrom(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return request.headers.get("x-api-key")?.trim() ?? "";
}

export async function authenticateOperator(request: Request, env: Env, requiredScope?: string): Promise<OperatorPrincipal> {
  const credential = credentialFrom(request);
  if (credential.length < 32) throw new ApiError(401, "OPERATOR_AUTHENTICATION_REQUIRED", "A valid D2F operator credential is required.");
  const row = await env.DB.prepare(`SELECT id, display_name, scopes_json, expires_at, revoked_at
    FROM operator_credentials WHERE key_sha256 = ?`)
    .bind(await sha256(credential)).first<OperatorCredentialRow>();
  if (!row || row.revoked_at) throw new ApiError(401, "INVALID_OPERATOR_CREDENTIAL", "The D2F operator credential is invalid or revoked.");
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw new ApiError(401, "EXPIRED_OPERATOR_CREDENTIAL", "The D2F operator credential has expired.");
  let scopes: readonly string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.scopes_json);
    scopes = Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch {
    throw new ApiError(500, "INVALID_OPERATOR_CONFIGURATION", "The operator credential scope configuration is invalid.");
  }
  if (requiredScope && !scopes.includes(requiredScope)) throw new ApiError(403, "INSUFFICIENT_OPERATOR_SCOPE", `The operator credential requires the ${requiredScope} scope.`);
  await env.DB.prepare("UPDATE operator_credentials SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  return { credentialId: row.id, displayName: row.display_name, scopes };
}
