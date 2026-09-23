import { sha256, stableJson, uuid } from "./crypto";
import type { Principal } from "./types";

type AuditInput = {
  eventType: string;
  subjectType: string;
  subjectId: string;
  correlationId: string;
  result: string;
  payload: Readonly<Record<string, unknown>>;
  sourceIp: string | null;
};

export async function buildAuditStatement(env: Env, principal: Principal, input: AuditInput): Promise<D1PreparedStatement> {
  const previous = await env.DB.prepare("SELECT event_hash FROM audit_events WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1")
    .bind(principal.tenantId).first<{ event_hash: string }>();
  const occurredAt = new Date().toISOString();
  const id = uuid();
  const previousHash = previous?.event_hash ?? "GENESIS";
  const payloadJson = stableJson(input.payload);
  const eventHash = await sha256(stableJson({
    id,
    tenantId: principal.tenantId,
    legalEntityId: principal.legalEntityId,
    eventType: input.eventType,
    occurredAt,
    actorType: "service",
    actorId: principal.applicationId,
    correlationId: input.correlationId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    result: input.result,
    applicationVersion: env.APP_VERSION,
    payload: input.payload,
    previousHash,
  }));
  return env.DB.prepare(`
    INSERT INTO audit_events
      (id, tenant_id, legal_entity_id, event_type, occurred_at, actor_type, actor_id, source_ip,
       correlation_id, subject_type, subject_id, result, application_version, payload_json,
       previous_hash, hash_algorithm, event_hash)
    VALUES (?, ?, ?, ?, ?, 'service', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SHA-256', ?)
  `).bind(
    id, principal.tenantId, principal.legalEntityId, input.eventType, occurredAt,
    principal.applicationId, input.sourceIp, input.correlationId, input.subjectType,
    input.subjectId, input.result, env.APP_VERSION, payloadJson, previousHash, eventHash,
  );
}
