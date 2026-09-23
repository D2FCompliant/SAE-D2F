# Integration with D2F Business Suite / Gestion

Reference SaaS: `https://gestion.d2fcompliant.org`.

Configure the existing integration type `archive` with the independent SAE HTTPS base URL, health path `/health`, submit path `/archives`, and either Bearer or API-key authentication.

The connector sends the document as the raw body with `x-d2f-document-id` and `x-d2f-document-number`. SAE returns `id`, `archive_id`, and `status: preserved`, plus hashes and evidence metadata. Compatibility requests without an explicit idempotency key derive one from the D2F document ID, or from the content hash when the ID is absent.

No D2F Gestion table is accessed by SAE. D2F stores its own transmission receipt; SAE stores its own archive and evidence.
