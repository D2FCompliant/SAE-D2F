import { depositArchive, getArchive, getEvidence, getObject, listArchives, listObjects, verifyArchive } from "./archive-service";
import { authenticate, describePrincipal } from "./auth";
import { consoleResponse } from "./console";
import { correlationId, errorResponse, json, parseDeposit, parseSmallJson, sourceIp } from "./http";
import { applyLegalHold, getJob, releaseLegalHold, requestDestruction, requestExport } from "./lifecycle-service";
import { OPENAPI } from "./openapi";

function archiveMatch(pathname: string): { archiveId: string; suffix: string } | null {
  const match = /^(?:\/api\/v1)?\/archives\/([^/]+)(\/.*)?$/.exec(pathname);
  return match?.[1] ? { archiveId: decodeURIComponent(match[1]), suffix: match[2] ?? "" } : null;
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestCorrelationId = correlationId(request);
  const responseHeaders = { "x-correlation-id": requestCorrelationId };
  try {
    const consoleAsset = consoleResponse(url.pathname);
    if (request.method === "GET" && consoleAsset) return consoleAsset;
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/v1/health")) {
      return json({
        status: "ok",
        service: "D2F Evidence Archive",
        version: env.APP_VERSION,
        commit: env.GIT_COMMIT,
        environment: env.ENVIRONMENT,
        evidenceSchemaVersion: env.EVIDENCE_SCHEMA_VERSION,
        storageImmutability: env.STORAGE_IMMUTABILITY,
        evidentialProductionReady: String(env.STORAGE_IMMUTABILITY) === "retention-locked" && String(env.TIMESTAMP_PROVIDER) === "rfc3161",
      }, 200, responseHeaders);
    }
    if (request.method === "GET" && url.pathname === "/api/v1/openapi.json") return json(OPENAPI, 200, responseHeaders);
    if (request.method === "GET" && url.pathname === "/api/v1/session") {
      const principal = await authenticate(request, env, "archives:read");
      return json(describePrincipal(principal), 200, responseHeaders);
    }
    if (request.method === "GET" && (url.pathname === "/archives" || url.pathname === "/api/v1/archives")) {
      const principal = await authenticate(request, env, "archives:read");
      return json(await listArchives(env, principal, {
        page: positiveInteger(url.searchParams.get("page"), 1, 10_000),
        pageSize: positiveInteger(url.searchParams.get("pageSize"), 25, 100),
        query: url.searchParams.get("q")?.trim().slice(0, 200) || null,
        status: url.searchParams.get("status")?.trim() || null,
      }), 200, responseHeaders);
    }
    if (request.method === "POST" && (url.pathname === "/archives" || url.pathname === "/api/v1/archives")) {
      const principal = await authenticate(request, env, "archives:write");
      const compatibility = url.pathname === "/archives";
      const input = await parseDeposit(request, env, compatibility, requestCorrelationId);
      const result = await depositArchive(env, principal, input, sourceIp(request));
      return json(result.receipt, result.replayed ? 200 : 201, { ...responseHeaders, "idempotency-replayed": String(result.replayed) });
    }
    const match = archiveMatch(url.pathname);
    if (match && request.method === "GET" && match.suffix === "") {
      const principal = await authenticate(request, env, "archives:read");
      return json(await getArchive(env, principal, match.archiveId), 200, responseHeaders);
    }
    if (match && request.method === "GET" && match.suffix === "/status") {
      const principal = await authenticate(request, env, "archives:read");
      const archive = await getArchive(env, principal, match.archiveId);
      return json({ archiveId: archive.id, status: archive.status, legalHold: archive.legal_hold_count > 0, retentionExpiresAt: archive.retention_expires_at }, 200, responseHeaders);
    }
    if (match && request.method === "GET" && match.suffix === "/metadata") {
      const principal = await authenticate(request, env, "archives:read");
      return json(await getArchive(env, principal, match.archiveId), 200, responseHeaders);
    }
    if (match && request.method === "GET" && match.suffix === "/objects") {
      const principal = await authenticate(request, env, "archives:read");
      return json({ archiveId: match.archiveId, objects: await listObjects(env, principal, match.archiveId) }, 200, responseHeaders);
    }
    if (match && request.method === "GET" && match.suffix.startsWith("/objects/")) {
      const principal = await authenticate(request, env, "archives:read");
      return getObject(env, principal, match.archiveId, decodeURIComponent(match.suffix.slice("/objects/".length)));
    }
    if (match && request.method === "GET" && match.suffix === "/evidence") {
      const principal = await authenticate(request, env, "evidence:read");
      return json(await getEvidence(env, principal, match.archiveId), 200, responseHeaders);
    }
    if (match && request.method === "POST" && match.suffix === "/verify") {
      const principal = await authenticate(request, env, "evidence:verify");
      return json(await verifyArchive(env, principal, match.archiveId), 200, responseHeaders);
    }
    if (match && request.method === "POST" && match.suffix === "/legal-hold") {
      const principal = await authenticate(request, env, "archives:legal-hold");
      const body = await parseSmallJson(request);
      return json(await applyLegalHold(env, principal, match.archiveId, { reason: String(body.reason ?? ""), authority: String(body.authority ?? "") }, requestCorrelationId, sourceIp(request)), 201, responseHeaders);
    }
    if (match && request.method === "DELETE" && match.suffix === "/legal-hold") {
      const principal = await authenticate(request, env, "archives:legal-hold");
      return json(await releaseLegalHold(env, principal, match.archiveId, requestCorrelationId, sourceIp(request)), 200, responseHeaders);
    }
    if (match && request.method === "POST" && match.suffix === "/destruction-request") {
      const principal = await authenticate(request, env, "archives:destruction-request");
      const body = await parseSmallJson(request);
      return json(await requestDestruction(env, principal, match.archiveId, body.reason, requestCorrelationId, sourceIp(request)), 202, responseHeaders);
    }
    if (match && request.method === "POST" && match.suffix === "/export") {
      const principal = await authenticate(request, env, "archives:export");
      return json(await requestExport(env, principal, match.archiveId), 202, responseHeaders);
    }
    const jobMatch = /^\/api\/v1\/jobs\/([^/]+)$/.exec(url.pathname);
    if (jobMatch?.[1] && request.method === "GET") {
      const principal = await authenticate(request, env, "jobs:read");
      return json(await getJob(env, principal, decodeURIComponent(jobMatch[1])), 200, responseHeaders);
    }
    return json({ error: { code: "NOT_FOUND", message: "Route not found.", correlationId: requestCorrelationId } }, 404, responseHeaders);
  } catch (error) {
    return errorResponse(error, requestCorrelationId);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },
} satisfies ExportedHandler<Env>;
