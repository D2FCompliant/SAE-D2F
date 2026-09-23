# Conformity mapping

This is an engineering control map, not a certification statement.

| Area | Status | Evidence / responsibility |
| --- | --- | --- |
| Original preservation and separate metadata | Implemented | R2 original plus D1 object record; no overwrite API. |
| SHA-256 object and manifest verification | Implemented | Deposit and verification service; alteration/missing-object tests. |
| Append-only audit chain | Partially implemented | Hash chain and D1 update/delete triggers; concurrent chain serialization and external anchoring remain. |
| Idempotent deposit | Implemented | Tenant/key reservation, request hash conflict detection, replay tests. |
| Tenant/legal-entity isolation | Implemented foundation | Credential-derived scope and cross-tenant regression test; full RBAC/penetration test remains. |
| Retention policy version model | Partially implemented | Schema exists; automatic policy selection/start-event calculation remains. |
| Legal hold | Implemented foundation | Apply/release and destruction blocking; human RBAC/approval UI remains. |
| Controlled destruction | Partially implemented | Eligibility and request/job record; approval, physical execution and certificate remain. |
| RFC 3161 timestamp | Planned | External provider responsibility; current token is non-qualified development evidence. |
| Infrastructure WORM | External provider responsibility | Retention lock must be configured, independently assessed and monitored. |
| Export/independent verifier | Planned | Job contract exists; package and `d2f-archive-verify` remain. |
| Signed webhooks/D2F events | Planned | Contract alignment documented; delivery not implemented. |
| GDPR organizational process | Organizational requirement | Controller/processor governance, DPA and request handling. |
| Backup/DR evidence | Planned / organizational | Procedures documented; automation and exercise evidence remain. |
| NF 461 / NF Z42-013 certification | Certification not obtained | No certification claim is permitted. |
