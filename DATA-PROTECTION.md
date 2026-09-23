# Data protection

Archives record confidentiality and personal-data classification. Access is tenant/legal-entity scoped and original reads require authorization. Document content is excluded from logs.

Production must document processing purpose, lawful basis, residency, DPA responsibilities, retention conflicts, data-subject request handling, access review and breach response.

An erasure request must never silently bypass statutory retention or legal hold. The request must be modelled and resolved through an authorized workflow. Release `0.1.0` deliberately exposes no direct archive deletion.
