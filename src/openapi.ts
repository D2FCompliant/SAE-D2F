export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "D2F Evidence Archive API",
    version: "0.2.0",
    description: "Electronic Archiving System designed for evidential preservation. No certification claim is made.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  paths: {
    "/health": { get: { operationId: "getHealth", security: [], responses: { "200": { description: "Service health and qualification posture" } } } },
    "/archives": {
      get: {
        operationId: "listArchives",
        parameters: [
          { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 200 } },
          { name: "status", in: "query", required: false, schema: { type: "string" } },
          { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
          { name: "pageSize", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: { "200": { description: "Tenant and legal-entity scoped archive register" } },
      },
      post: {
        operationId: "depositArchive",
        parameters: [
          { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 16, maxLength: 200 } },
          { name: "x-correlation-id", in: "header", required: false, schema: { type: "string", format: "uuid" } },
          { name: "x-d2f-document-id", in: "header", required: false, schema: { type: "string" } },
          { name: "x-d2f-document-number", in: "header", required: false, schema: { type: "string" } },
        ],
        requestBody: { required: true, content: {
          "application/pdf": { schema: { type: "string", format: "binary" } },
          "application/xml": { schema: { type: "string", format: "binary" } },
          "text/xml": { schema: { type: "string", format: "binary" } },
          "application/json": { schema: { type: "string", format: "binary" } },
          "application/octet-stream": { schema: { type: "string", format: "binary" } },
        } },
        responses: { "201": { description: "Archive preserved", content: { "application/json": { schema: { $ref: "#/components/schemas/Receipt" } } } }, "200": { description: "Idempotent replay" }, "409": { description: "Idempotency conflict" } },
      },
    },
    "/session": { get: { operationId: "getSession", responses: { "200": { description: "Authenticated profile and capabilities" } } } },
    "/archives/{archiveId}": { get: { operationId: "getArchive", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "200": { description: "Archive metadata" }, "404": { description: "Not found" } } } },
    "/archives/{archiveId}/status": { get: { operationId: "getArchiveStatus", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "200": { description: "Archive status" } } } },
    "/archives/{archiveId}/metadata": { get: { operationId: "getArchiveMetadata", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "200": { description: "Archive metadata" } } } },
    "/archives/{archiveId}/objects": { get: { operationId: "listArchiveObjects", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "200": { description: "Archived objects" } } } },
    "/archives/{archiveId}/objects/{objectId}": { get: { operationId: "getArchiveObject", parameters: [{ $ref: "#/components/parameters/ArchiveId" }, { name: "objectId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Original archived bytes" } } } },
    "/archives/{archiveId}/evidence": { get: { operationId: "getArchiveEvidence", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "200": { description: "Evidence manifest metadata" } } } },
    "/archives/{archiveId}/verify": { post: { operationId: "verifyArchive", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "200": { description: "Verification report" } } } },
    "/archives/{archiveId}/legal-hold": {
      post: { operationId: "applyLegalHold", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "201": { description: "Legal hold applied" }, "409": { description: "Lifecycle conflict" } } },
      delete: { operationId: "releaseLegalHold", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "200": { description: "Legal hold released" }, "409": { description: "No active legal hold" } } },
    },
    "/archives/{archiveId}/destruction-request": { post: { operationId: "requestDestruction", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "202": { description: "Destruction authorization workflow queued" }, "409": { description: "Retention or legal hold prevents destruction" } } } },
    "/archives/{archiveId}/export": { post: { operationId: "requestExport", parameters: [{ $ref: "#/components/parameters/ArchiveId" }], responses: { "202": { description: "Portable export job queued" } } } },
    "/jobs/{jobId}": { get: { operationId: "getJob", parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Job status" }, "404": { description: "Job not found" } } } },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
    },
    parameters: { ArchiveId: { name: "archiveId", in: "path", required: true, schema: { type: "string", format: "uuid" } } },
    schemas: {
      Receipt: {
        type: "object",
        required: ["id", "archive_id", "status", "object_hash", "manifest_hash", "correlation_id"],
        properties: {
          id: { type: "string", format: "uuid" },
          archive_id: { type: "string", format: "uuid" },
          status: { const: "preserved" },
          object_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          manifest_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          correlation_id: { type: "string", format: "uuid" },
        },
      },
    },
  },
} as const;
