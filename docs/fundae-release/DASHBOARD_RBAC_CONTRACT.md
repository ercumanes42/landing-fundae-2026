# Dashboard authentication and RBAC contract

Status: implemented locally and OFF. G5 remains `PENDING`; no principal or SQL was applied live.

## HTTP identity boundary

- `DATA_BRAIN_AUTH_CREDENTIALS` is a server-only JSON v1 store. It contains normalized usernames and up to two overlapping rotation credentials per identity; each credential stores only a 16-32 byte random salt and a 32-byte PBKDF2-HMAC-SHA256 digest.
- PBKDF2 requires at least 600,000 iterations. Duplicate usernames, key IDs, salt/digest collisions, malformed windows, inactive identities and unknown store versions fail closed.
- Password verification performs two KDF operations for both known and unknown identities and compares fixed-size bytes without early exit. Wrong user and wrong password return the same response.
- `DATA_BRAIN_AUTH_PEPPER` is an independent server secret. The HTTP identity becomes `HMAC-SHA256(pepper, "dashboard-actor-v1\0" + normalized_username)`; raw usernames, passwords and Authorization headers never reach PostgreSQL or logs.
- The deprecated single-user `DATA_BRAIN_ADMIN_USER` / `DATA_BRAIN_ADMIN_PASSWORD` path is not used. `DATA_BRAIN_LEGACY_BASIC_ENABLED` must be exactly `false`; any other value fails closed.
- Credential rotation adds a second digest, provisions the unchanged actor hash, verifies both credentials, then removes the expired digest. A maximum of two prevents unbounded KDF amplification.

The transport remains HTTP Basic only as a browser-compatible carrier over TLS; it does not select a role. TLS, no-store responses and secret-manager-only environment delivery are mandatory.

## Authorization authority

`dashboard_principals` is the sole role authority. The credential store contains no role. The server passes only `actor_hash`; audited RPCs resolve `admin`, `operator`, `auditor` or `read_only` in PostgreSQL and deny missing/inactive principals.

| Role | Aggregates | Operational samples | Lead/journey samples | Audit sample |
|---|---:|---:|---:|---:|
| `admin` | yes | max 100 | max 100 | yes |
| `operator` | yes | max 100 | no | no |
| `auditor` | yes | max 50 | max 50 | yes |
| `read_only` | yes | no | no | no |

Provisioning is a controlled SQL operation after review: compute the actor hash offline with the same pepper, insert only the hash and role, and never persist username or credential material in PostgreSQL.

## Rate limiting and audit

- The proxy has a bounded per-instance failure limiter and emits only pseudonymous success/failure events. It never logs supplied usernames, passwords, headers or credential digests.
- The in-memory limiter is defense in depth, not an authoritative distributed control in serverless deployments. Production readiness requires `DATA_BRAIN_AUTH_EDGE_RATE_LIMITED=true`, a trusted edge-owned client-IP header and a distributed WAF/edge rule on every non-public path.
- Authentication failures do not disclose whether identity, password, store or rotation entry was wrong. Configuration faults are distinguishable only in server logs.

## Data and database boundary

`dashboard_get_summary` aggregates in PostgreSQL for at most 366 days. `dashboard_get_sample` returns bounded, allowlisted, pseudonymized rows (limit 100; auditor 50). Browser responses contain no lead payload, email, phone, Graph ImmutableId, Message-ID or capability. RBAC/audit tables have forced RLS and no direct grants; audited RPCs are the only service-role entry points.

## Gates

1. Keep all outbound switches false.
2. Store valid v1 credentials and pepper in an approved secret manager; no plaintext in files or Vercel logs.
3. Keep legacy mode false and configure distributed edge rate limiting before production.
4. Provision each actor hash/role under four-eyes review; verify admin/operator/auditor/read_only denials.
5. Apply SQL only in authorized staging, then run grants/RLS checks, advisors and representative `EXPLAIN (ANALYZE, BUFFERS)`.
6. Canary authentication, rotation and revocation before G5 can pass.

Rollback: block dashboard traffic at the edge, deactivate principals and revoke RPC execute. Preserve the append-only audit log.