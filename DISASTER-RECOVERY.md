# Disaster recovery

Production must define RPO/RTO, regional/provider failure scenarios, notification ownership, credential/key recovery, last-known-good release, and evidence-preserving failover.

Recovery sequence: contain writes, identify authoritative backup, restore metadata and objects into an isolated environment, apply migrations, verify all manifest/object hashes and audit chains, reconcile incomplete deposits/jobs, obtain approval, switch traffic, and record the event in D2F Support.

No RPO/RTO or successful DR exercise is claimed for `0.1.0`.
