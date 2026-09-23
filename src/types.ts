export type Principal = {
  credentialId: string;
  tenantId: string;
  legalEntityId: string;
  applicationId: string;
  scopes: readonly string[];
};

export type DepositInput = {
  bytes: Uint8Array;
  mimeType: string;
  originalFilename: string | null;
  sourceSystem: string;
  sourceDocumentId: string | null;
  sourceDocumentNumber: string | null;
  documentType: string;
  idempotencyKey: string;
  correlationId: string;
  classification: string;
  confidentiality: string;
  personalDataClassification: string;
};

export type Receipt = {
  id: string;
  archive_id: string;
  status: "preserved";
  deposited_at: string;
  object_hash: string;
  manifest_hash: string;
  hash_algorithm: "SHA-256";
  evidence_schema_version: string;
  timestamp_evidence: {
    type: "internal-dev" | "rfc3161";
    qualified: boolean;
    token: string;
  };
  tenant_id: string;
  legal_entity_id: string;
  correlation_id: string;
  application_version: string;
  storage_immutability: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
