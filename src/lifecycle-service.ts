import { buildAuditStatement } from "./audit";
import { getArchive } from "./archive-service";
import { uuid } from "./crypto";
import { ApiError, type Principal } from "./types";

type LegalHoldInput = { reason: string; authority: string };

export async function applyLegalHold(
  env: Env,
  principal: Principal,
  archiveId: string,
  input: LegalHoldInput,
  correlationId: string,
  sourceIp: string | null,
): Promise<Record<string, unknown>> {
  const archive = await getArchive(env, principal, archiveId);
  if (archive.status === "DESTROYED") throw new ApiError(409, "ARCHIVE_DESTROYED", "A destroyed archive cannot be placed under legal hold.");
  const reason = input.reason.trim().slice(0, 500);
  const authority = input.authority.trim().slice(0, 200);
  if (!reason || !authority) throw new ApiError(400, "LEGAL_HOLD_JUSTIFICATION_REQUIRED", "Legal hold reason and authority are required.");
  const id = uuid();
  const now = new Date().toISOString();
  const audit = await buildAuditStatement(env, principal, {
    eventType: "ArchiveLegalHoldApplied",
    subjectType: "Archive",
    subjectId: archiveId,
    correlationId,
    result: "success",
    payload: { legalHoldId: id, reason, authority },
    sourceIp,
  });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO legal_holds
      (id, archive_id, tenant_id, reason, authority, applied_by, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, archiveId, principal.tenantId, reason, authority, principal.applicationId, now),
    env.DB.prepare("UPDATE archives SET legal_hold_count = legal_hold_count + 1, status = 'UNDER_LEGAL_HOLD', updated_at = ? WHERE id = ? AND tenant_id = ? AND legal_entity_id = ?")
      .bind(now, archiveId, principal.tenantId, principal.legalEntityId),
    audit,
  ]);
  return { archiveId, legalHoldId: id, status: "UNDER_LEGAL_HOLD", appliedAt: now };
}

export async function releaseLegalHold(
  env: Env,
  principal: Principal,
  archiveId: string,
  correlationId: string,
  sourceIp: string | null,
): Promise<Record<string, unknown>> {
  const archive = await getArchive(env, principal, archiveId);
  const active = await env.DB.prepare("SELECT id FROM legal_holds WHERE archive_id = ? AND tenant_id = ? AND released_at IS NULL ORDER BY applied_at DESC LIMIT 1")
    .bind(archiveId, principal.tenantId).first<{ id: string }>();
  if (!active) throw new ApiError(409, "NO_ACTIVE_LEGAL_HOLD", "The archive has no active legal hold.");
  const now = new Date().toISOString();
  const remaining = Math.max(0, archive.legal_hold_count - 1);
  const nextStatus = remaining > 0 ? "UNDER_LEGAL_HOLD" : "PRESERVED";
  const audit = await buildAuditStatement(env, principal, {
    eventType: "ArchiveLegalHoldReleased",
    subjectType: "Archive",
    subjectId: archiveId,
    correlationId,
    result: "success",
    payload: { legalHoldId: active.id, remaining },
    sourceIp,
  });
  await env.DB.batch([
    env.DB.prepare("UPDATE legal_holds SET released_by = ?, released_at = ? WHERE id = ? AND tenant_id = ? AND released_at IS NULL")
      .bind(principal.applicationId, now, active.id, principal.tenantId),
    env.DB.prepare("UPDATE archives SET legal_hold_count = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND legal_entity_id = ?")
      .bind(remaining, nextStatus, now, archiveId, principal.tenantId, principal.legalEntityId),
    audit,
  ]);
  return { archiveId, legalHoldId: active.id, status: nextStatus, releasedAt: now, remainingLegalHolds: remaining };
}

export async function requestDestruction(
  env: Env,
  principal: Principal,
  archiveId: string,
  reasonValue: unknown,
  correlationId: string,
  sourceIp: string | null,
): Promise<Record<string, unknown>> {
  const archive = await getArchive(env, principal, archiveId);
  if (archive.legal_hold_count > 0) throw new ApiError(409, "LEGAL_HOLD_ACTIVE", "Legal hold prevents destruction.");
  if (!archive.retention_expires_at) throw new ApiError(409, "RETENTION_UNDEFINED", "Destruction is refused because no retention expiry is recorded.");
  if (Date.parse(archive.retention_expires_at) > Date.now()) throw new ApiError(409, "RETENTION_NOT_EXPIRED", "Destruction before retention expiry is refused.");
  if (["DESTRUCTION_PENDING", "DESTROYED"].includes(archive.status)) throw new ApiError(409, "DESTRUCTION_STATE_CONFLICT", "The archive is already pending destruction or destroyed.");
  const reason = String(reasonValue ?? "").trim().slice(0, 500);
  if (!reason) throw new ApiError(400, "DESTRUCTION_REASON_REQUIRED", "A destruction reason is required.");
  const id = uuid();
  const jobId = uuid();
  const now = new Date().toISOString();
  const audit = await buildAuditStatement(env, principal, {
    eventType: "ArchiveDestructionRequested",
    subjectType: "Archive",
    subjectId: archiveId,
    correlationId,
    result: "pending_authorization",
    payload: { destructionRequestId: id, jobId, reason },
    sourceIp,
  });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO destruction_requests
      (id, archive_id, tenant_id, reason, requested_by, requested_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'requested')`)
      .bind(id, archiveId, principal.tenantId, reason, principal.applicationId, now),
    env.DB.prepare(`INSERT INTO jobs
      (id, tenant_id, archive_id, job_type, status, request_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'destruction', 'queued', ?, ?, ?, ?)`)
      .bind(jobId, principal.tenantId, archiveId, JSON.stringify({ destructionRequestId: id }), principal.applicationId, now, now),
    env.DB.prepare("UPDATE archives SET status = 'DESTRUCTION_PENDING', updated_at = ? WHERE id = ? AND tenant_id = ? AND legal_entity_id = ?")
      .bind(now, archiveId, principal.tenantId, principal.legalEntityId),
    audit,
  ]);
  return { archiveId, destructionRequestId: id, jobId, status: "requested", requestedAt: now };
}

export async function requestExport(env: Env, principal: Principal, archiveId: string): Promise<Record<string, unknown>> {
  await getArchive(env, principal, archiveId);
  const id = uuid();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO jobs
    (id, tenant_id, archive_id, job_type, status, request_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'export', 'queued', '{}', ?, ?, ?)`)
    .bind(id, principal.tenantId, archiveId, principal.applicationId, now, now).run();
  return { archiveId, jobId: id, status: "queued", createdAt: now };
}

export async function getJob(env: Env, principal: Principal, jobId: string): Promise<Record<string, unknown>> {
  const job = await env.DB.prepare(`SELECT j.id, j.archive_id, j.job_type, j.status, j.result_json,
      j.error_message, j.created_at, j.updated_at
    FROM jobs j
    LEFT JOIN archives a ON a.id = j.archive_id AND a.tenant_id = j.tenant_id
    WHERE j.id = ? AND j.tenant_id = ? AND (j.archive_id IS NULL OR a.legal_entity_id = ?)`)
    .bind(jobId, principal.tenantId, principal.legalEntityId).first<Record<string, unknown>>();
  if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "The job was not found.");
  return job;
}
