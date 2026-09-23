# Webhooks

Signed webhook delivery is planned, not implemented in `0.1.0`.

The contract will align with D2F Integration Hub: exact raw JSON body, `eventId`, timestamp, delivery ID, correlation ID and retry number; HMAC-SHA256 over `timestamp.rawBody`; one-time secret disclosure; exponential backoff; delivery history; replay authorization; idempotent receivers; and dead-letter status.

Webhook secrets must be encrypted separately, never displayed after creation, and never logged.
