# Known Issues & Unresolved Ambiguities

Project: PhotoMemories AI Backend  
Authoritative Specification: `PhotoMemories_Backend_PRD_V2.pdf` (Verified Present in Workspace)  
Last Updated: 2026-09-22

---

## Issue-001: Missing Physical PRD Document in Workspace
- **Module**: Project Management / Governance
- **Status**: **RESOLVED**
- **Resolution**: `PhotoMemories_Backend_PRD_V2.pdf` was placed at `C:\Users\admin\.gemini\antigravity\scratch\photomemories-backend\PhotoMemories_Backend_PRD_V2.pdf` and directly verified and inspected across all 32 pages.

---

## Issue-002: Official Plan Pricing Matrix Undefined
- **Module**: Subscriptions & Payments (`/api/events/request`)
- **Description**: PRD Page 12–13 provides an illustrative request body with `plan: "pro"` and `amount: 25000`, but does not define commercial price points for `base` or `medium`.
- **Impact**: The backend cannot hardcode official commercial pricing without inventing requirements.
- **Current Status**: Open / Requires Project Owner Input.
- **Mitigation**: Backend will maintain configurable pricing mappings (via environment variables or configuration layer) and reject client-tampered amounts matching whatever configuration is supplied, but will not present speculative numbers as authoritative product requirements.

---

## Issue-003: Operational Health Check Distinction
- **Module**: Infrastructure / Deployment
- **Status**: **RESOLVED** via ADR-005.
- **Resolution**: Kept strictly as `GET /healthz` (an internal infrastructure probe outside `/api`), completely excluded from the PRD product API documentation.
