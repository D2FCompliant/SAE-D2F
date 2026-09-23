# Retention model

Retention policies are identified and versioned by tenant, jurisdiction, document category, start event, duration and legal basis. The exact policy version applied at deposit must remain linked to that archive.

D2F applies a minimum preservation period of 120 calendar months for supported accounting and invoicing archives. The policy remains tenant-scoped, jurisdiction-aware and versioned so a longer or more specific rule can be selected without changing historical archives.

At deposit, release `0.2.0` selects the newest active policy matching the document category, falling back to the tenant wildcard policy. Only the `deposit` start event is supported in this release. A missing policy, an unsupported start event or a duration shorter than 120 months rejects the deposit. The selected policy version and calculated expiry are recorded in both the archive metadata and evidence manifest.

Production tenant provisioning must create the tenant, legal entity, versioned retention policy and hashed credential explicitly. No demonstration tenant or credential is inserted by production migrations.

The production R2 bucket `d2f-evidence-archive-eu` is protected for all prefixes by the rule `d2f-minimum-10-years`, with a provider-enforced duration of 3653 days. This infrastructure lock complements the application policy; legal holds and longer tenant policies may extend retention but never shorten that minimum.

Legal hold is additive. Each active hold is separately recorded. Any active hold blocks destruction. Releasing one hold does not release other holds.

Destruction is never a direct delete. The current API creates an authorization/job record only after verifying retention expiry and absence of legal hold. Approval, physical deletion, independent evidence cleanup rules, and the destruction certificate are future workflow steps and are not represented as completed in `0.2.0`.
