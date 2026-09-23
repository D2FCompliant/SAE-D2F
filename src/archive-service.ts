import { buildAuditStatement } from "./audit";
import { sha256, stableJson, uuid } from "./crypto";
import { ApiError, type DepositInput, type Principal, type Receipt } from "./types";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/xml",
  "text/xml",
  "application/json",
  "application/octet-stream",
]);

type IdempotencyRow = {
  request_hash: string;
  archive_id: string;
  status: string;
  response_json: string | null;
};

type RetentionPolicyRow = {
  id: string;
  version: number;
  jurisdiction: string;
  document_category: string;
  start_event: string;
  duration_months: number;
  legal_basis: string;
};

type ArchiveRow = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  source_system: string;
  source_document_id: string | null;
  source_document_number: string | null;
  document_type: string;
  mime_type: string;
  original_filename: string | null;
  deposited_at: string;
  preservation_started_at: string | null;
  retention_policy_id: string | null;
  retention_policy_version: number | null;
  retention_expires_at: string | null;
  legal_hold_count: number;
  status: string;
  classification: string;
  confidentiality: string;
  personal_data_classification: string;
  correlation_id: string;
  created_by: string;
};

export type ArchiveListFilters = {
  page: number;
  pageSize: number;
  query: string | null;
  status: string | null;
};

const ARCHIVE_STATUSES = new Set([
  "RECEIVED", "VALIDATING", "VALIDATED", "SEALED", "PRESERVED", "UNDER_LEGAL_HOLD",
  "RETENTION_EXPIRED", "DESTRUCTION_PENDING", "DESTROYED", "ERROR",
]);

function parseReceipt(value: string): Receipt {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new ApiError(500, "INVALID_RECEIPT", "Stored idempotency receipt is invalid.");
  return parsed as Receipt;
}

function addCalendarMonths(value: string, months: number): string {
  const source = new Date(value);
  const targetMonth = source.getUTCMonth() + months;
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    Math.min(source.getUTCDate(), lastDay),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  )).toISOString();
}

async function resolveRetentionPolicy(env: Env, principal: Principal, documentType: string): Promise<RetentionPolicyRow> {
  const policy = await env.DB.prepare(`SELECT id, version, jurisdiction, document_category,
      start_event, duration_months, legal_basis
    FROM retention_policies
    WHERE tenant_id = ? AND status = 'active' AND (document_category = ? OR document_category = '*')
    ORDER BY CASE WHEN document_category = ? THEN 0 ELSE 1 END, version DESC
    LIMIT 1`)
    .bind(principal.tenantId, documentType, documentType)
    .first<RetentionPolicyRow>();
  if (!policy) throw new ApiError(409, "RETENTION_POLICY_NOT_FOUND", "No active retention policy applies to this document.");
  if (policy.start_event !== "deposit") {
    throw new ApiError(409, "RETENTION_START_EVENT_UNSUPPORTED", "The configured retention start event is not supported by this release.");
  }
  if (!Number.isSafeInteger(policy.duration_months) || policy.duration_months < 120) {
    throw new ApiError(409, "RETENTION_POLICY_TOO_SHORT", "The active retention policy must preserve the document for at least 120 months.");
  }
  return policy;
}

export async function depositArchive(env: Env, principal: Principal, input: DepositInput, sourceIp: string | null): Promise<{ receipt: Receipt; replayed: boolean }> {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "This media type is not accepted.");
  if (input.bytes.byteLength === 0) throw new ApiError(400, "EMPTY_ARCHIVE", "The deposited object is empty.");
  const maximum = Number(env.MAX_ARCHIVE_BYTES);
  if (!Number.isSafeInteger(maximum) || input.bytes.byteLength > maximum) throw new ApiError(413, "ARCHIVE_TOO_LARGE", `The deposited object exceeds ${maximum} bytes.`);

  const objectHash = await sha256(input.bytes);
  const effectiveIdempotencyKey = input.idempotencyKey === "compat:content" ? `compat:${objectHash}` : input.idempotencyKey;
  const requestHash = await sha256(stableJson({
    objectHash,
    mimeType: input.mimeType,
    sourceSystem: input.sourceSystem,
    sourceDocumentId: input.sourceDocumentId,
    sourceDocumentNumber: input.sourceDocumentNumber,
    documentType: input.documentType,
  }));
  const existing = await env.DB.prepare("SELECT request_hash, archive_id, status, response_json FROM idempotency_records WHERE tenant_id = ? AND idempotency_key = ?")
    .bind(principal.tenantId, effectiveIdempotencyKey).first<IdempotencyRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different deposit.");
    if (existing.status === "completed" && existing.response_json) return { receipt: parseReceipt(existing.response_json), replayed: true };
    throw new ApiError(409, "DEPOSIT_IN_PROGRESS", "A deposit with this idempotency key is already in progress.", { archiveId: existing.archive_id });
  }

  const archiveId = uuid();
  const objectId = uuid();
  const manifestId = uuid();
  const depositedAt = new Date().toISOString();
  const retentionPolicy = await resolveRetentionPolicy(env, principal, input.documentType);
  const retentionExpiresAt = addCalendarMonths(depositedAt, retentionPolicy.duration_months);
  const originalKey = `${principal.tenantId}/${archiveId}/original/${objectId}`;
  const manifestKey = `${principal.tenantId}/${archiveId}/evidence/manifest.v1.json`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO idempotency_records
      (tenant_id, idempotency_key, request_hash, archive_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`)
      .bind(principal.tenantId, effectiveIdempotencyKey, requestHash, archiveId, depositedAt, depositedAt),
    env.DB.prepare(`INSERT INTO archives
      (id, tenant_id, legal_entity_id, source_system, source_document_id, source_document_number,
       document_type, mime_type, original_filename, deposited_at, retention_policy_id,
       retention_policy_version, retention_expires_at, status, classification,
       confidentiality, personal_data_classification, correlation_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        archiveId, principal.tenantId, principal.legalEntityId, input.sourceSystem,
        input.sourceDocumentId, input.sourceDocumentNumber, input.documentType, input.mimeType,
        input.originalFilename, depositedAt, retentionPolicy.id, retentionPolicy.version,
        retentionExpiresAt, input.classification, input.confidentiality,
        input.personalDataClassification, input.correlationId, principal.applicationId,
        depositedAt, depositedAt,
      ),
  ]);

  try {
    await env.ARCHIVE_OBJECTS.put(originalKey, input.bytes, {
      httpMetadata: { contentType: input.mimeType },
      customMetadata: {
        archiveId,
        objectId,
        tenantId: principal.tenantId,
        hashAlgorithm: "SHA-256",
        hashValue: objectHash,
      },
      onlyIf: { etagDoesNotMatch: "*" },
    });

    const timestampToken = await sha256(`internal-dev:${depositedAt}:${objectHash}`);
    const manifestCore = {
      schemaVersion: env.EVIDENCE_SCHEMA_VERSION,
      archiveId,
      objects: [{
        objectId,
        role: "original",
        hashAlgorithm: "SHA-256",
        hashValue: objectHash,
        length: input.bytes.byteLength,
        mimeType: input.mimeType,
        storageReference: originalKey,
      }],
      algorithm: "SHA-256",
      depositedAt,
      sourceIdentity: input.sourceSystem,
      depositorIdentity: principal.applicationId,
      tenantId: principal.tenantId,
      legalEntityId: principal.legalEntityId,
      retentionPolicy: {
        id: retentionPolicy.id,
        version: retentionPolicy.version,
        jurisdiction: retentionPolicy.jurisdiction,
        documentCategory: retentionPolicy.document_category,
        startEvent: retentionPolicy.start_event,
        durationMonths: retentionPolicy.duration_months,
        legalBasis: retentionPolicy.legal_basis,
        expiresAt: retentionExpiresAt,
      },
      applicationVersion: env.APP_VERSION,
      evidenceSchemaVersion: env.EVIDENCE_SCHEMA_VERSION,
      correlationId: input.correlationId,
      previousEvidenceLink: null,
      timestampEvidence: { type: env.TIMESTAMP_PROVIDER, qualified: false, token: timestampToken },
      storageImmutability: env.STORAGE_IMMUTABILITY,
    };
    const manifestJson = stableJson(manifestCore);
    const manifestHash = await sha256(manifestJson);
    await env.ARCHIVE_OBJECTS.put(manifestKey, manifestJson, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { archiveId, tenantId: principal.tenantId, hashAlgorithm: "SHA-256", hashValue: manifestHash },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    const receipt: Receipt = {
      id: archiveId,
      archive_id: archiveId,
      status: "preserved",
      deposited_at: depositedAt,
      object_hash: objectHash,
      manifest_hash: manifestHash,
      hash_algorithm: "SHA-256",
      evidence_schema_version: env.EVIDENCE_SCHEMA_VERSION,
      timestamp_evidence: { type: String(env.TIMESTAMP_PROVIDER) === "rfc3161" ? "rfc3161" : "internal-dev", qualified: false, token: timestampToken },
      tenant_id: principal.tenantId,
      legal_entity_id: principal.legalEntityId,
      correlation_id: input.correlationId,
      application_version: env.APP_VERSION,
      storage_immutability: env.STORAGE_IMMUTABILITY,
    };
    const audit = await buildAuditStatement(env, principal, {
      eventType: "ArchivePreserved",
      subjectType: "Archive",
      subjectId: archiveId,
      correlationId: input.correlationId,
      result: "success",
      payload: {
        objectId,
        objectHash,
        manifestHash,
        length: input.bytes.byteLength,
        mimeType: input.mimeType,
        retentionPolicyId: retentionPolicy.id,
        retentionPolicyVersion: retentionPolicy.version,
        retentionExpiresAt,
      },
      sourceIp,
    });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO archive_objects
        (id, archive_id, tenant_id, role, storage_key, mime_type, original_filename, length_bytes,
         hash_algorithm, hash_value, created_at)
        VALUES (?, ?, ?, 'original', ?, ?, ?, ?, 'SHA-256', ?, ?)`)
        .bind(objectId, archiveId, principal.tenantId, originalKey, input.mimeType, input.originalFilename, input.bytes.byteLength, objectHash, depositedAt),
      env.DB.prepare(`INSERT INTO evidence_manifests
        (id, archive_id, tenant_id, schema_version, hash_algorithm, manifest_hash, storage_key,
         previous_evidence_hash, timestamp_type, timestamp_token, created_at)
        VALUES (?, ?, ?, ?, 'SHA-256', ?, ?, NULL, ?, ?, ?)`)
        .bind(manifestId, archiveId, principal.tenantId, env.EVIDENCE_SCHEMA_VERSION, manifestHash, manifestKey, env.TIMESTAMP_PROVIDER, timestampToken, depositedAt),
      audit,
      env.DB.prepare("UPDATE archives SET status = 'PRESERVED', preservation_started_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .bind(depositedAt, depositedAt, archiveId, principal.tenantId),
      env.DB.prepare("UPDATE idempotency_records SET status = 'completed', response_json = ?, updated_at = ? WHERE tenant_id = ? AND idempotency_key = ?")
        .bind(JSON.stringify(receipt), depositedAt, principal.tenantId, effectiveIdempotencyKey),
    ]);
    return { receipt, replayed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Deposit failed";
    await env.DB.batch([
      env.DB.prepare("UPDATE archives SET status = 'ERROR', error_code = 'DEPOSIT_FAILED', error_message = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
        .bind(message, new Date().toISOString(), archiveId, principal.tenantId),
      env.DB.prepare("UPDATE idempotency_records SET status = 'failed', updated_at = ? WHERE tenant_id = ? AND idempotency_key = ?")
        .bind(new Date().toISOString(), principal.tenantId, effectiveIdempotencyKey),
    ]);
    throw error;
  }
}

export async function getArchive(env: Env, principal: Principal, archiveId: string): Promise<ArchiveRow> {
  const row = await env.DB.prepare("SELECT * FROM archives WHERE id = ? AND tenant_id = ? AND legal_entity_id = ?")
    .bind(archiveId, principal.tenantId, principal.legalEntityId).first<ArchiveRow>();
  if (!row) throw new ApiError(404, "ARCHIVE_NOT_FOUND", "The archive was not found.");
  return row;
}

export async function listArchives(env: Env, principal: Principal, filters: ArchiveListFilters): Promise<Record<string, unknown>> {
  const where = ["tenant_id = ?", "legal_entity_id = ?"];
  const bindings: unknown[] = [principal.tenantId, principal.legalEntityId];
  if (filters.status) {
    if (!ARCHIVE_STATUSES.has(filters.status)) throw new ApiError(400, "INVALID_ARCHIVE_STATUS", "The requested archive status is invalid.");
    where.push("status = ?");
    bindings.push(filters.status);
  }
  if (filters.query) {
    const escaped = filters.query.replace(/[\\%_]/g, "\\$&");
    where.push("(source_document_number LIKE ? ESCAPE '\\' OR source_document_id LIKE ? ESCAPE '\\' OR original_filename LIKE ? ESCAPE '\\')");
    const pattern = `%${escaped}%`;
    bindings.push(pattern, pattern, pattern);
  }
  const whereSql = where.join(" AND ");
  const count = await env.DB.prepare(`SELECT count(*) AS total FROM archives WHERE ${whereSql}`)
    .bind(...bindings).first<{ total: number }>();
  const summary = await env.DB.prepare(`SELECT count(*) AS total,
      SUM(CASE WHEN status = 'PRESERVED' THEN 1 ELSE 0 END) AS preserved,
      SUM(CASE WHEN legal_hold_count > 0 THEN 1 ELSE 0 END) AS legal_holds
    FROM archives WHERE tenant_id = ? AND legal_entity_id = ?`)
    .bind(principal.tenantId, principal.legalEntityId)
    .first<{ total: number; preserved: number | null; legal_holds: number | null }>();
  const offset = (filters.page - 1) * filters.pageSize;
  const result = await env.DB.prepare(`SELECT id, source_system, source_document_id, source_document_number,
      document_type, mime_type, original_filename, deposited_at, retention_expires_at,
      legal_hold_count, status, classification, confidentiality, created_by
    FROM archives WHERE ${whereSql}
    ORDER BY deposited_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, filters.pageSize, offset).all<Record<string, unknown>>();
  const total = count?.total ?? 0;
  return {
    items: result.results,
    summary: {
      total: summary?.total ?? 0,
      preserved: summary?.preserved ?? 0,
      legalHolds: summary?.legal_holds ?? 0,
    },
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    },
  };
}

export async function listObjects(env: Env, principal: Principal, archiveId: string): Promise<readonly Record<string, unknown>[]> {
  await getArchive(env, principal, archiveId);
  const result = await env.DB.prepare(`SELECT id, role, mime_type, original_filename, length_bytes,
    hash_algorithm, hash_value, created_at FROM archive_objects WHERE archive_id = ? AND tenant_id = ? ORDER BY created_at`)
    .bind(archiveId, principal.tenantId).all<Record<string, unknown>>();
  return result.results;
}

export async function getObject(env: Env, principal: Principal, archiveId: string, objectId: string): Promise<Response> {
  await getArchive(env, principal, archiveId);
  const row = await env.DB.prepare("SELECT storage_key, mime_type, original_filename, hash_value FROM archive_objects WHERE id = ? AND archive_id = ? AND tenant_id = ?")
    .bind(objectId, archiveId, principal.tenantId).first<{ storage_key: string; mime_type: string; original_filename: string | null; hash_value: string }>();
  if (!row) throw new ApiError(404, "OBJECT_NOT_FOUND", "The archived object was not found.");
  const object = await env.ARCHIVE_OBJECTS.get(row.storage_key);
  if (!object) throw new ApiError(500, "OBJECT_MISSING", "The archived object is missing from storage.");
  const headers = new Headers({ "content-type": row.mime_type, "x-content-sha256": row.hash_value, "cache-control": "private, no-store" });
  if (row.original_filename) headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.original_filename)}`);
  return new Response(object.body, { headers });
}

export async function getEvidence(env: Env, principal: Principal, archiveId: string): Promise<Record<string, unknown>> {
  await getArchive(env, principal, archiveId);
  const manifest = await env.DB.prepare("SELECT schema_version, hash_algorithm, manifest_hash, storage_key, timestamp_type, timestamp_token, created_at FROM evidence_manifests WHERE archive_id = ? AND tenant_id = ?")
    .bind(archiveId, principal.tenantId).first<Record<string, unknown>>();
  if (!manifest) throw new ApiError(500, "EVIDENCE_MISSING", "The evidence manifest is missing.");
  return manifest;
}

export async function verifyArchive(env: Env, principal: Principal, archiveId: string): Promise<Record<string, unknown>> {
  const archive = await getArchive(env, principal, archiveId);
  const objects = await env.DB.prepare("SELECT id, storage_key, hash_value, length_bytes FROM archive_objects WHERE archive_id = ? AND tenant_id = ?")
    .bind(archiveId, principal.tenantId).all<{ id: string; storage_key: string; hash_value: string; length_bytes: number }>();
  const manifest = await env.DB.prepare("SELECT storage_key, manifest_hash FROM evidence_manifests WHERE archive_id = ? AND tenant_id = ?")
    .bind(archiveId, principal.tenantId).first<{ storage_key: string; manifest_hash: string }>();
  const checks: Record<string, unknown>[] = [];
  for (const row of objects.results) {
    const stored = await env.ARCHIVE_OBJECTS.get(row.storage_key);
    if (!stored) {
      checks.push({ objectId: row.id, valid: false, reason: "missing" });
      continue;
    }
    const bytes = new Uint8Array(await stored.arrayBuffer());
    const actualHash = await sha256(bytes);
    checks.push({ objectId: row.id, valid: actualHash === row.hash_value && bytes.byteLength === row.length_bytes, expectedHash: row.hash_value, actualHash, expectedLength: row.length_bytes, actualLength: bytes.byteLength });
  }
  let manifestValid = false;
  if (manifest) {
    const stored = await env.ARCHIVE_OBJECTS.get(manifest.storage_key);
    manifestValid = Boolean(stored && await sha256(await stored.arrayBuffer()) === manifest.manifest_hash);
  }
  const valid = manifestValid && checks.length > 0 && checks.every((check) => check.valid === true);
  const verifiedAt = new Date().toISOString();
  return { archiveId, status: archive.status, valid, verifiedAt, manifestValid, objects: checks };
}
