import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { sha256 } from "../src/crypto";

const DEMO_TOKEN = "d2f_test_demo_0123456789abcdefghijklmnopqrstuvwxyz";
const OTHER_TOKEN = "d2f_test_other_0123456789abcdefghijklmnopqrstuvwxyz";
const READ_ONLY_TOKEN = "d2f_test_readonly_0123456789abcdefghijklmnop";
const scopes = JSON.stringify([
  "archives:write", "archives:read", "evidence:read", "evidence:verify",
  "archives:legal-hold", "archives:destruction-request", "archives:export", "jobs:read",
]);

async function seedCredential(id: string, token: string, tenantId = "tenant-demo", legalEntityId = "legal-demo", credentialScopes = scopes) {
  await env.DB.prepare(`INSERT INTO api_credentials
    (id, tenant_id, legal_entity_id, application_id, environment, display_name, key_sha256,
     key_prefix, scopes_json, created_at)
    VALUES (?, ?, ?, 'test-client', 'test', 'Test credential', ?, 'd2f_test', ?, ?)`)
    .bind(id, tenantId, legalEntityId, await sha256(token), credentialScopes, new Date().toISOString()).run();
}

function request(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`https://archive.example.test${path}`, init), env);
}

function deposit(body = "%PDF-1.7\nD2F evidence", headers: Record<string, string> = {}) {
  return request("/archives", {
    method: "POST",
    headers: {
      authorization: `Bearer ${DEMO_TOKEN}`,
      "content-type": "application/pdf",
      "x-d2f-document-id": "invoice-001",
      "x-d2f-document-number": "F-2026-001",
      ...headers,
    },
    body,
  });
}

beforeEach(async () => {
  await reset();
  const testEnv = env as Env & { TEST_MIGRATIONS: D1Migration[] };
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
  await seedCredential("credential-demo", DEMO_TOKEN);
});

describe("D2F compatibility contract", () => {
  it("exposes health without authentication and reports non-qualified storage", async () => {
    const response = await request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      version: "0.2.0",
      storageImmutability: "application-only",
      evidentialProductionReady: false,
    });
  });

  it("accepts a raw archive and returns the existing D2F receipt fields", async () => {
    const response = await deposit();
    expect(response.status).toBe(201);
    const receipt = await response.json<Record<string, string>>();
    expect(receipt.id).toBe(receipt.archive_id);
    expect(receipt.status).toBe("preserved");
    expect(receipt.object_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    const archive = await env.DB.prepare("SELECT status, source_document_id, source_document_number FROM archives WHERE id = ?")
      .bind(receipt.archive_id).first<Record<string, string>>();
    expect(archive).toMatchObject({ status: "PRESERVED", source_document_id: "invoice-001", source_document_number: "F-2026-001" });
  });

  it("replays the same compatibility deposit without creating a duplicate", async () => {
    const first = await deposit();
    const firstReceipt = await first.json<Record<string, string>>();
    const second = await deposit();
    const secondReceipt = await second.json<Record<string, string>>();
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotency-replayed")).toBe("true");
    expect(secondReceipt.archive_id).toBe(firstReceipt.archive_id);
    const count = await env.DB.prepare("SELECT count(*) AS total FROM archives").first<{ total: number }>();
    expect(count?.total).toBe(1);
  });

  it("supports the unversioned evidence and verification paths configured by D2F Gestion", async () => {
    const receipt = await (await deposit()).json<Record<string, string>>();
    const headers = { authorization: `Bearer ${DEMO_TOKEN}` };
    const evidence = await request(`/archives/${receipt.archive_id}/evidence`, { headers });
    expect(evidence.status).toBe(200);
    expect(await evidence.json()).toMatchObject({ hash_algorithm: "SHA-256" });
    const verification = await request(`/archives/${receipt.archive_id}/verify`, { method: "POST", headers });
    expect(await verification.json()).toMatchObject({ valid: true, archiveId: receipt.archive_id });
  });
});

describe("document console and profiles", () => {
  it("serves the console with a restrictive browser security policy", async () => {
    const response = await request("/console");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(await response.text()).toContain("Documents archivés");
  });

  it("derives an administrator profile from enforced scopes", async () => {
    const response = await request("/api/v1/session", { headers: { authorization: `Bearer ${DEMO_TOKEN}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      profile: "Administrateur SAE",
      tenantId: "tenant-demo",
      legalEntityId: "legal-demo",
      capabilities: { read: true, deposit: true, legalHold: true, requestDestruction: true },
    });
  });

  it("lists and filters only archives belonging to the credential legal entity", async () => {
    await deposit("%PDF first", { "x-d2f-document-id": "invoice-filter-1", "x-d2f-document-number": "FACT-UNIQUE-42" });
    await env.DB.prepare("INSERT INTO legal_entities (id, tenant_id, legal_name, country, status, created_at) VALUES ('legal-second','tenant-demo','Second entity','FR','active',?)")
      .bind(new Date().toISOString()).run();
    await seedCredential("credential-readonly", READ_ONLY_TOKEN, "tenant-demo", "legal-second", JSON.stringify(["archives:read"]));
    const own = await request("/api/v1/archives?q=FACT-UNIQUE&status=PRESERVED", { headers: { authorization: `Bearer ${DEMO_TOKEN}` } });
    expect(await own.json()).toMatchObject({
      pagination: { total: 1 },
      summary: { total: 1, preserved: 1, legalHolds: 0 },
      items: [{ source_document_number: "FACT-UNIQUE-42" }],
    });
    const otherEntity = await request("/api/v1/archives", { headers: { authorization: `Bearer ${READ_ONLY_TOKEN}` } });
    expect(await otherEntity.json()).toMatchObject({ pagination: { total: 0 }, items: [] });
  });

  it("keeps read-only profiles unable to mutate archives", async () => {
    await seedCredential("credential-readonly", READ_ONLY_TOKEN, "tenant-demo", "legal-demo", JSON.stringify(["archives:read"]));
    const session = await request("/api/v1/session", { headers: { authorization: `Bearer ${READ_ONLY_TOKEN}` } });
    expect(await session.json()).toMatchObject({ profile: "Consultation", capabilities: { read: true, deposit: false, verify: false } });
    const denied = await request("/api/v1/archives", {
      method: "POST",
      headers: { authorization: `Bearer ${READ_ONLY_TOKEN}`, "content-type": "application/pdf", "idempotency-key": "readonly-cannot-deposit-001" },
      body: "%PDF",
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "INSUFFICIENT_SCOPE" } });
  });

  it("isolates lifecycle jobs between legal entities in the same tenant", async () => {
    const receipt = await (await deposit()).json<Record<string, string>>();
    const exported = await request(`/api/v1/archives/${receipt.archive_id}/export`, {
      method: "POST",
      headers: { authorization: `Bearer ${DEMO_TOKEN}` },
    });
    const job = await exported.json<Record<string, string>>();
    await env.DB.prepare("INSERT INTO legal_entities (id, tenant_id, legal_name, country, status, created_at) VALUES ('legal-second','tenant-demo','Second entity','FR','active',?)")
      .bind(new Date().toISOString()).run();
    await seedCredential("credential-readonly", READ_ONLY_TOKEN, "tenant-demo", "legal-second", JSON.stringify(["archives:read", "jobs:read"]));
    const denied = await request(`/api/v1/jobs/${job.jobId}`, { headers: { authorization: `Bearer ${READ_ONLY_TOKEN}` } });
    expect(denied.status).toBe(404);
  });
});

describe("integrity and security", () => {
  it("requires authentication", async () => {
    const response = await request("/archives", { method: "POST", headers: { "content-type": "application/pdf" }, body: "%PDF" });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTHENTICATION_REQUIRED" } });
  });

  it("rejects a revoked credential", async () => {
    await env.DB.prepare("UPDATE api_credentials SET revoked_at = ? WHERE id = 'credential-demo'").bind(new Date().toISOString()).run();
    const response = await deposit();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_CREDENTIAL" } });
  });

  it("isolates archives across tenants", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tenants (id, organisation_name, country, data_residency, status, created_at) VALUES ('tenant-other','Other','FR','EU','active',?)").bind(new Date().toISOString()),
      env.DB.prepare("INSERT INTO legal_entities (id, tenant_id, legal_name, country, status, created_at) VALUES ('legal-other','tenant-other','Other France','FR','active',?)").bind(new Date().toISOString()),
    ]);
    await seedCredential("credential-other", OTHER_TOKEN, "tenant-other", "legal-other");
    const created = await deposit();
    const receipt = await created.json<Record<string, string>>();
    const response = await request(`/api/v1/archives/${receipt.archive_id}`, { headers: { authorization: `Bearer ${OTHER_TOKEN}` } });
    expect(response.status).toBe(404);
  });

  it("detects an altered original object", async () => {
    const created = await deposit();
    const receipt = await created.json<Record<string, string>>();
    const object = await env.DB.prepare("SELECT storage_key FROM archive_objects WHERE archive_id = ?").bind(receipt.archive_id).first<{ storage_key: string }>();
    expect(object).not.toBeNull();
    await env.ARCHIVE_OBJECTS.put(object!.storage_key, "altered");
    const response = await request(`/api/v1/archives/${receipt.archive_id}/verify`, { method: "POST", headers: { authorization: `Bearer ${DEMO_TOKEN}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ valid: false, manifestValid: true, objects: [{ valid: false }] });
  });

  it("detects an altered manifest", async () => {
    const created = await deposit();
    const receipt = await created.json<Record<string, string>>();
    const manifest = await env.DB.prepare("SELECT storage_key FROM evidence_manifests WHERE archive_id = ?").bind(receipt.archive_id).first<{ storage_key: string }>();
    await env.ARCHIVE_OBJECTS.put(manifest!.storage_key, "{}");
    const response = await request(`/api/v1/archives/${receipt.archive_id}/verify`, { method: "POST", headers: { authorization: `Bearer ${DEMO_TOKEN}` } });
    expect(await response.json()).toMatchObject({ valid: false, manifestValid: false });
  });

  it("detects a missing original object", async () => {
    const created = await deposit();
    const receipt = await created.json<Record<string, string>>();
    const object = await env.DB.prepare("SELECT storage_key FROM archive_objects WHERE archive_id = ?").bind(receipt.archive_id).first<{ storage_key: string }>();
    await env.ARCHIVE_OBJECTS.delete(object!.storage_key);
    const response = await request(`/api/v1/archives/${receipt.archive_id}/verify`, { method: "POST", headers: { authorization: `Bearer ${DEMO_TOKEN}` } });
    expect(await response.json()).toMatchObject({ valid: false, objects: [{ valid: false, reason: "missing" }] });
  });

  it("prevents mutation of audit evidence at the database boundary", async () => {
    await deposit();
    await expect(env.DB.prepare("UPDATE audit_events SET result = 'tampered'").run()).rejects.toThrow(/append-only/);
  });
});

describe("formal v1 idempotency", () => {
  it("requires a sufficiently long idempotency key", async () => {
    const response = await request("/api/v1/archives", {
      method: "POST",
      headers: { authorization: `Bearer ${DEMO_TOKEN}`, "content-type": "application/pdf", "idempotency-key": "short" },
      body: "%PDF",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } });
  });

  it("rejects reuse of a key with a different payload", async () => {
    const key = "formal-idempotency-key-0001";
    const first = await deposit("first", { "idempotency-key": key });
    expect(first.status).toBe(201);
    const second = await deposit("second", { "idempotency-key": key });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
});

describe("retention lifecycle", () => {
  it("legal hold blocks destruction and release restores preservation", async () => {
    const created = await deposit();
    const receipt = await created.json<Record<string, string>>();
    await env.DB.prepare("UPDATE archives SET retention_expires_at = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", receipt.archive_id).run();
    const hold = await request(`/api/v1/archives/${receipt.archive_id}/legal-hold`, {
      method: "POST",
      headers: { authorization: `Bearer ${DEMO_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Litigation", authority: "Legal department" }),
    });
    expect(hold.status).toBe(201);
    const blocked = await request(`/api/v1/archives/${receipt.archive_id}/destruction-request`, {
      method: "POST",
      headers: { authorization: `Bearer ${DEMO_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Retention elapsed" }),
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: "LEGAL_HOLD_ACTIVE" } });
    const released = await request(`/api/v1/archives/${receipt.archive_id}/legal-hold`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${DEMO_TOKEN}` },
    });
    expect(await released.json()).toMatchObject({ status: "PRESERVED", remainingLegalHolds: 0 });
  });

  it("refuses destruction before retention expiry", async () => {
    const created = await deposit();
    const receipt = await created.json<Record<string, string>>();
    await env.DB.prepare("UPDATE archives SET retention_expires_at = ? WHERE id = ?")
      .bind("2099-01-01T00:00:00.000Z", receipt.archive_id).run();
    const response = await request(`/api/v1/archives/${receipt.archive_id}/destruction-request`, {
      method: "POST",
      headers: { authorization: `Bearer ${DEMO_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Too early" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "RETENTION_NOT_EXPIRED" } });
  });
});
