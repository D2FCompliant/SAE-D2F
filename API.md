# API

The formal API is described by `OPENAPI.yaml` and served at `GET /api/v1/openapi.json` from the Worker source contract.

Authentication uses `Authorization: Bearer <token>` or `x-api-key`. Mutation calls require the documented scope. The modern deposit requires `Idempotency-Key` with at least 16 characters. Responses include `x-correlation-id`.

Compatibility:

- `GET /health`
- `POST /archives` with raw body and `x-d2f-document-id` / `x-d2f-document-number`

Versioned routes:

- health, authenticated session/capabilities, deposit, paginated archive register, archive/status/metadata;
- object listing and authorized original retrieval;
- evidence manifest metadata and verification;
- legal hold apply/release;
- destruction request;
- export job request and job status.

The export and destruction endpoints currently queue lifecycle records. They do not claim that an export package or physical destruction has completed.

The D2F Gestion compatibility surface also accepts `GET /archives/{id}/evidence` and `POST /archives/{id}/verify`, matching the configurable connector paths shown in Gestion.

## Console profiles

`GET /api/v1/session` derives the displayed profile and capabilities from the authenticated credential scopes. The API remains the authorization boundary:

- `archives:read`: consultation and tenant/legal-entity scoped search;
- `archives:write`: document deposit;
- `evidence:read` and `evidence:verify`: evidence and integrity controls;
- `archives:legal-hold`: apply or release legal holds;
- `archives:export`: request portable exports;
- `archives:destruction-request`: request, but never directly execute, controlled destruction.
