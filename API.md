# API

The formal API is described by `OPENAPI.yaml` and served at `GET /api/v1/openapi.json` from the Worker source contract.

Authentication uses `Authorization: Bearer <token>` or `x-api-key`. Mutation calls require the documented scope. The modern deposit requires `Idempotency-Key` with at least 16 characters. Responses include `x-correlation-id`.

Compatibility:

- `GET /health`
- `POST /archives` with raw body and `x-d2f-document-id` / `x-d2f-document-number`

Versioned routes:

- health, deposit, archive/status/metadata;
- object listing and authorized original retrieval;
- evidence manifest metadata and verification;
- legal hold apply/release;
- destruction request;
- export job request and job status.

The export and destruction endpoints currently queue lifecycle records. They do not claim that an export package or physical destruction has completed.
