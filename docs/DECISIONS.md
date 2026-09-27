# Architecture Decision Records (ADRs)

Project: PhotoMemories AI Backend  
Authoritative Specification: `PhotoMemories_Backend_PRD_V2.pdf` (Verified Present in Workspace)

---

## ADR-001: Physical PRD V2 Inspection as the Sole Authoritative Specification

- **Status**: Accepted
- **Context**: The physical file `PhotoMemories_Backend_PRD_V2.pdf` was placed at the workspace root and read directly (all 32 pages).
- **Decision**: All database schemas, API contracts, workflows, and security requirements are derived strictly from direct reading of `PhotoMemories_Backend_PRD_V2.pdf`. Any assumption not present in the PDF is rejected.
- **Impact**: Establishes 100% fidelity with the physical specification document.

---

## ADR-002: Plan Pricing Matrix Configuration

- **Status**: Accepted
- **Context**: On Page 12–13 of the PRD, the example request shows `plan: "pro"` and `amount: 25000`. The PRD does not declare commercial price points for `base` or `medium`.
- **Decision**: Do NOT hard-code ₹10,000 for Base, ₹18,000 for Medium, or ₹25,000 as a definitive Pro price. Plan pricing is classified as an **unresolved product configuration**. The backend will enforce server-side price validation using a configurable pricing module (via environment or config), but no official price matrix is assumed or hard-coded into product rules.
- **Impact**: Prevents client-side price tampering without inventing business pricing.

---

## ADR-003: Strict Plan Entitlement Scope (Gallery Media Access)

- **Status**: Accepted
- **Context**: Page 20 of the PRD explicitly defines plan filtering:
  - `Base`: photos only
  - `Medium`: photos + videos
  - `Pro`: all (photos + videos)
- **Decision**: Enforce ONLY this documented access rule. All invented plan attributes (storage quotas, upload limits, custom domain privileges) are completely removed.
- **Impact**: Zero scope creep; public gallery endpoint strictly filters media records by `file_type` according to the event's plan.

---

## ADR-004: Payment Provider Scope (Razorpay Focus)

- **Status**: Accepted
- **Context**: Page 28–29 of the PRD defines `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the environment variables.
- **Decision**: Implement payment processing for Razorpay (order creation and HMAC-SHA256 signature-verified webhook `POST /api/payments/webhook`). Do not build a full Stripe implementation.
- **Impact**: Meets PRD payment webhook requirements with zero speculative code.

---

## ADR-005: Operational Infrastructure Endpoint (`GET /healthz`)

- **Status**: Accepted
- **Context**: Railway/Render requires container liveness probes, but no health check is part of the PhotoMemories product API inventory.
- **Decision**: Provide `GET /healthz` as an internal operational infrastructure endpoint only. It is NOT mounted under `/api` and is NOT listed in the product API inventory.
- **Impact**: Clear isolation between hosting infrastructure needs and product contracts.

---

## ADR-006: Client Contact Information Encryption at Rest

- **Status**: Accepted
- **Context**: Pages 23–24 of the PRD explicitly provide the reference implementation for AES-256-GCM encryption of `client_email`, `client_phone`, and sensitive details.
- **Decision**: Follow the PRD implementation:
  - Encrypt: `crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv)`
  - Format: `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
  - Decrypt: Parse parts, set auth tag, decrypt to UTF-8.
- **Impact**: Direct adherence to PRD cryptographic specifications.

---

## ADR-007: Exact Analytics & Subdomains Table Schema Conformance

- **Status**: Accepted
- **Context**: PRD Page 10 defines `analytics` with `user_ip VARCHAR(45)` and `action_date DATE NOT NULL`, and Page 26 defines `subdomains` with `subdomain_name VARCHAR(100) UNIQUE`.
- **Decision**:
  - `analytics` table strictly uses `user_ip` (not `ip`), includes `action_date DATE NOT NULL`, and references `event_id` (no `event_slug` column in the database).
  - `subdomains` table strictly uses `subdomain_name` (not `subdomain`).
  - In `POST /api/analytics/track`, the incoming `event_slug` in the request body will be resolved to `event_id` prior to database insertion.
- **Impact**: Database schema conforms 100% to PRD DDL definitions.
