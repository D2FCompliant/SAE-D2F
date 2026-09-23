# Retention model

Retention policies are identified and versioned by tenant, jurisdiction, document category, start event, duration and legal basis. The exact policy version applied at deposit must remain linked to that archive.

No universal ten-year rule is hard-coded. Release `0.1.0` contains the schema but does not yet select/apply a policy automatically; archives without an expiry are therefore ineligible for destruction.

Legal hold is additive. Each active hold is separately recorded. Any active hold blocks destruction. Releasing one hold does not release other holds.

Destruction is never a direct delete. The current API creates an authorization/job record only after verifying retention expiry and absence of legal hold. Approval, physical deletion, independent evidence cleanup rules, and the destruction certificate are future workflow steps and are not represented as completed in `0.1.0`.
