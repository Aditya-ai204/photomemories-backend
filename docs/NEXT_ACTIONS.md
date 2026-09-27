# Next Actions

Project: PhotoMemories AI Backend  
Authoritative Specification: `PhotoMemories_Backend_PRD_V2.pdf`  
Last Updated: 2026-09-24

---

## Completed Phases
- [x] **Phase 1: Foundation** (Config, Crypto, DB pool, Migration runner, Security headers, Rate Limiting, CORS, Error handling, Health probe, 18 tests)
- [x] **Phase 2: Authentication & User Management**
  - [x] Step 1: Password & JWT utilities (bcrypt cost 10, 24h access / 7d refresh)
  - [x] Step 2: Cookie transport & Authentication/Role middleware (`requireAuth`, `requireRole`)
  - [x] Step 3: Subdomain auto-generation & Nodemailer email service
  - [x] Step 4: Authentication endpoints & controllers (`/api/auth/*`)
  - [x] Step 5: End-to-end verification, security audit, and Phase 2 sign-off (95 tests passing)
- [x] **Phase 3: Event Management & Photographer Requests**
  - [x] Step 1: Requirements, architecture, dependency & implementation-plan analysis
  - [x] Step 2: Event slug generation service (`src/services/eventSlugService.ts`, 22 unit tests)
  - [x] Step 3: Payment intent service & ADR-002 pricing model (`src/services/paymentService.ts`, 27 unit tests)
  - [x] Step 4: Event request endpoint (`POST /api/events/request`, `src/controllers/eventController.ts`, `src/routes/eventRoutes.ts`, 11 integration tests)
  - [x] Step 5: Photographer event endpoints (`GET /api/photographer/events`, `GET /api/photographer/events/:eventId`, `src/controllers/photographerController.ts`, `src/routes/photographerRoutes.ts`, 18 integration tests)
  - [x] Step 6: Payment webhook endpoint (`POST /api/payments/webhook`, `src/controllers/paymentController.ts`, `src/routes/paymentRoutes.ts`, 13 integration tests)

  - [x] Step 7: Phase 3 Verification, Audit & Sign-off (186 tests passing, typecheck PASS, build PASS, 0 defects)

- [x] **Phase 4: Admin & Photo Upload** (COMPLETED, AUDITED & SIGNED OFF)
  - [x] Step 1: Requirements, architecture & implementation analysis
  - [x] Step 2: Admin event listing endpoints (`GET /api/admin/events/pending`, `GET /api/admin/events`, `src/controllers/adminController.ts`, `src/routes/adminRoutes.ts`, 17 integration tests)
  - [x] Step 3: Admin Mark Ready Endpoint (`POST /api/admin/events/:eventId/mark-ready`, `src/controllers/adminController.ts`, `src/routes/adminRoutes.ts`, `tests/integration/adminMarkReady.test.ts`, 14 integration tests)
  - [x] Step 4: Cloudinary Upload Service & Photo Upload Endpoint (`POST /api/events/:eventId/upload-photos`, `src/services/cloudinaryService.ts`, `src/middleware/upload.ts`, `src/controllers/photoController.ts`, `src/routes/eventRoutes.ts`, 22 unit & integration tests)
  - [x] Step 5: Photo Management Endpoints (`GET /api/events/:eventId/photos`, `DELETE /api/photos/:photoId`, `src/controllers/photoController.ts`, `src/routes/photoRoutes.ts`, `src/routes/eventRoutes.ts`, 18 integration tests)
  - [x] Step 6: Phase 4 Verification, Full Regression Audit & Sign-off (257/257 tests passing, typecheck PASS, build PASS, 0 PRD defects)

---

## Phase 5: Public Event & Guest Gallery (In Progress)
- [x] **Step 1: Requirements, Architecture & Subdomain Resolution Analysis** (COMPLETED)
  - Deep-dive inspection of physical `PhotoMemories_Backend_PRD_V2.pdf` (Pages 19–21, 26, 2–4).
  - Subdomain resolution architecture formulated (`Host`/`X-Subdomain` header + `events.unique_slug` mapping).
  - Public security rules defined (strict contact PII redaction, 404 on `pending`/`archived` events, rate limiting active, zero JWT requirements).
  - Plan-based media access rules defined (`base`: photos only; `medium`: photos+videos; `pro`: all).
  - Step 2–5 implementation sequence established.
- [ ] **Step 2: Public Landing Page Endpoint** (`GET /api/public/event/:slug` & `GET /api/public/photographer/:subdomain`) [NEXT EXACT ACTION]
- [ ] **Step 3: Public Photos & Invitation Endpoints** (`GET /api/public/event/:slug/gallery`, `GET /api/public/event/:slug/photos`, `GET /api/public/event/:slug/invitation`)
- [ ] **Step 4: Guest QR Resolution & Public Analytics Tracking** (`POST /api/analytics/track`, QR link validation)
- [ ] **Step 5: Phase 5 Verification, Security Audit & Final System Sign-off**


