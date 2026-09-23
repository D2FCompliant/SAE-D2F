import { ApiError, type DepositInput } from "./types";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers: { ...jsonHeaders, ...headers } });
}

export function errorResponse(error: unknown, correlationId: string): Response {
  if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message, correlationId, details: error.details ?? null } }, error.status);
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(JSON.stringify({ message: "request failed", error: message, correlationId }));
  return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", correlationId } }, 500);
}

function bounded(value: string | null, maximum: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximum) : null;
}

export async function parseDeposit(request: Request, env: Env, compatibility: boolean, correlationId: string): Promise<DepositInput> {
  const mimeType = (request.headers.get("content-type") ?? "application/octet-stream").split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
  const lengthHeader = request.headers.get("content-length");
  const maximum = Number(env.MAX_ARCHIVE_BYTES);
  if (lengthHeader && Number(lengthHeader) > maximum) throw new ApiError(413, "ARCHIVE_TOO_LARGE", `The deposited object exceeds ${maximum} bytes.`);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximum) throw new ApiError(413, "ARCHIVE_TOO_LARGE", `The deposited object exceeds ${maximum} bytes.`);
  const documentId = bounded(request.headers.get("x-d2f-document-id"), 200);
  const suppliedKey = bounded(request.headers.get("idempotency-key"), 200);
  if (!compatibility && (!suppliedKey || suppliedKey.length < 16)) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key must contain at least 16 characters.");
  return {
    bytes,
    mimeType,
    originalFilename: bounded(request.headers.get("x-original-filename"), 255),
    sourceSystem: bounded(request.headers.get("x-source-system"), 100) ?? (compatibility ? "D2F_GESTION" : "THIRD_PARTY"),
    sourceDocumentId: documentId,
    sourceDocumentNumber: bounded(request.headers.get("x-d2f-document-number"), 200),
    documentType: bounded(request.headers.get("x-document-type"), 100) ?? "document",
    idempotencyKey: suppliedKey ?? `compat:${documentId ?? "content"}`,
    correlationId,
    classification: bounded(request.headers.get("x-classification"), 50) ?? "internal",
    confidentiality: bounded(request.headers.get("x-confidentiality"), 50) ?? "confidential",
    personalDataClassification: bounded(request.headers.get("x-personal-data-classification"), 50) ?? "unknown",
  };
}

export function correlationId(request: Request): string {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && /^[0-9a-f-]{36}$/i.test(supplied) ? supplied : crypto.randomUUID();
}

export function sourceIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip");
}

export async function parseSmallJson(request: Request): Promise<Readonly<Record<string, unknown>>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 16_384) throw new ApiError(413, "REQUEST_TOO_LARGE", "The JSON request exceeds 16384 bytes.");
  const text = await request.text();
  if (text.length > 16_384) throw new ApiError(413, "REQUEST_TOO_LARGE", "The JSON request exceeds 16384 bytes.");
  if (!text) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError(400, "INVALID_JSON_OBJECT", "The request body must be a JSON object.");
  return parsed as Readonly<Record<string, unknown>>;
}
