# Current Project State

Project: PhotoMemories AI Backend  
Authoritative Specification: `PhotoMemories_Backend_PRD_V2.pdf` (Verified in Workspace)  
Last Updated: 2026-09-24

---

## 1. Executive Summary
- **Current Lifecycle Phase**: Phase 5 (Public Event & Guest Gallery) — **STEP 1 COMPLETED (ANALYSIS ONLY)**.
- **Build Status**:
  - TypeScript compilation (`tsc --noEmit` & `tsc` build): **0 errors (Code 0)**.
  - Automated tests (`vitest run`): **257 passed, 0 failed, 0 skipped across 18 test suites**.
- **Phase 5 Status**:
  - Step 1: Requirements, architecture & subdomain resolution analysis COMPLETED.
    - Deep-dive inspection of physical `PhotoMemories_Backend_PRD_V2.pdf` (Pages 19–21, 26, 2–4).
    - Subdomain resolution architecture formulated (`Host`/`X-Subdomain` header + `events.unique_slug` mapping).
    - Public security rules defined (strict contact PII redaction, 404 on `pending`/`archived` events, rate limiting active, zero JWT requirements).
    - Plan-based media access rules defined (`base`: photos only; `medium`: photos+videos; `pro`: all).
    - Step 2–5 implementation sequence established.
  - Step 2: Public Landing Page Endpoint (`GET /api/public/event/:slug`) & Subdomain Info (`GET /api/public/photographer/:subdomain`) pending user instruction.


---

## 2. Implemented Components

| Component | Files | PRD Reference | Status |
|---|---|---|---|
| **Configuration** | `src/config/env.ts`, `.env.example` | Pages 28–29 | Complete & Validated (Zod) |
| **Cryptography (Data at Rest)** | `src/utils/crypto.ts` | Pages 23–24 | Complete & Verified (AES-256-GCM) |
| **Password Utility** | `src/utils/password.ts` | Page 23 | Complete & Verified (bcrypt cost 10) |
| **JWT Utility** | `src/utils/jwt.ts` | Pages 24, 28 | Complete & Verified (24h access / 7d refresh) |
| **Cookie Transport Utility** | `src/utils/cookies.ts` | Pages 24, 30 | Complete & Verified (httpOnly, secure, maxAge) |
| **Authentication Middleware** | `src/middleware/auth.ts` | Pages 24, 30 | Complete & Verified (`requireAuth`) |
| **Role Authorization Middleware** | `src/middleware/auth.ts` | Pages 6, 11–19 | Complete & Verified (`requireRole`) |
| **Subdomain Service** | `src/services/subdomainService.ts` | Pages 4, 6, 11–12, 20, 22, 25, 26 | Complete & Verified (Auto-gen, collision handling, persistence) |
| **Email Notification Service** | `src/services/emailService.ts` | Pages 3, 11–12, 23, 26, 28 | Complete & Verified (Nodemailer, verification & reset links) |
| **Authentication Controller & Schemas** | `src/controllers/authController.ts` | Pages 11–12, 22, 25 | Complete & Verified (6 endpoints, Zod validation) |
| **Authentication Routes** | `src/routes/authRoutes.ts` | Pages 11–12 | Complete & Mounted under `/api/auth` |
| **Event Slug Generation Service** | `src/services/eventSlugService.ts` | Pages 7–8, 12, 15, 16, 21 | Complete & Verified (Slug formatting, year append, collision handling) |
| **Payment & Signature Service** | `src/services/paymentService.ts` | Pages 7–8, 12–13, 27–29 | Complete & Verified (ADR-002 pricing, Razorpay order creation, constant-time HMAC-SHA256 verification) |
| **Event Request Controller & Routes** | `src/controllers/eventController.ts`, `src/routes/eventRoutes.ts` | Pages 12–13 | Complete & Verified (`POST /api/events/request`, Zod validation, AES contact encryption, Razorpay integration, 201 response) |
| **Photographer Event Controller & Routes** | `src/controllers/photographerController.ts`, `src/routes/photographerRoutes.ts` | Pages 14–15 | Complete & Verified (`GET /api/photographer/events`, `GET /api/photographer/events/:eventId`, SQL IDOR defense, AES contact decryption) |
| **Payment Webhook Controller & Routes** | `src/controllers/paymentController.ts`, `src/routes/paymentRoutes.ts` | Pages 7–8, 13 | Complete & Verified (`POST /api/payments/webhook`, HMAC-SHA256 signature verification, idempotency, event status update, non-blocking email dispatch) |
| **Admin Event Controller & Routes** | `src/controllers/adminController.ts`, `src/routes/adminRoutes.ts` | Pages 17–19 | Complete & Verified (`GET /api/admin/events/pending`, `GET /api/admin/events`, `POST /api/admin/events/:eventId/mark-ready`, admin RBAC, HTML storage, state machine, photographer email, audit logs) |
| **Cloudinary Storage Service** | `src/services/cloudinaryService.ts` | Pages 5, 9, 15–16, 28–29 | Complete & Verified (Stream upload, thumbnail generation, rollback asset cleanup) |
| **Upload Middleware** | `src/middleware/upload.ts` | Pages 15–16 | Complete & Verified (Multer memory storage, photo/video MIME validation, file size safeguards) |
| **Photo Upload & Management Controller & Routes** | `src/controllers/photoController.ts`, `src/routes/eventRoutes.ts`, `src/routes/photoRoutes.ts` | Pages 9, 15–17 | Complete & Verified (`POST /api/events/:eventId/upload-photos`, `GET /api/events/:eventId/photos`, `DELETE /api/photos/:photoId`, ownership check, IDOR defense, atomic DB transactions, counter updates, auto-live transition, Cloudinary rollback/destruction) |
| **Logger** | `src/utils/logger.ts` | Section 45 | Complete & Sanitized |
| **Database Pool** | `src/database/index.ts` | Pages 5, 28 | Complete (pg Pool with SSL support) |
| **Migration Runner** | `src/database/migrator.ts` | Section 9 | Complete (`schema_migrations` tracking) |
| **Initial DDL Schema** | `src/database/migrations/001_initial_schema.sql` | Pages 6–11, 26 | Complete (7 PRD entities, exact field names) |
| **Security Headers** | `src/middleware/security.ts` | Page 22 | Complete (Helmet: HSTS, CSP, X-Frame-Options: DENY) |
| **CORS Bridge** | `src/middleware/security.ts` | Pages 4, 22, 30 | Complete (Frontend URL + `*.photomemories.ai`, credentials: true) |
| **Rate Limiter** | `src/middleware/security.ts` | Page 22 | Complete (100 req / 15 min / IP, 429 JSON response) |
| **Error Handling** | `src/middleware/errorHandler.ts` | Page 30 | Complete (`{ success: false, error: ..., code: ... }`) |
| **Express App** | `src/app.ts`, `src/server.ts` | Pages 4–5 | Complete (With internal `/healthz` probe, `/api/auth`, `/api/events`, `/api/photographer`, `/api/payments`, `/api/admin`, `/api/photos`) |
| **Automated Tests** | `tests/unit/*.ts`, `tests/integration/*.ts` | Pages 7, 11–19, 23, 24, 26, 30 | Complete (257/257 tests passing across 18 suites) |

---

## 3. Database Schema Verification Status

| Entity | PRD Page | DDL Status | Fields & Index Confirmation |
|---|---|---|---|
| `users` | Page 6 | Migration Created | `id`, `email`, `password_hash`, `name`, `role`, `company_name`, `phone`, `subdomain`, `city`, `created_at`, `updated_at`, `last_login`, `is_active`, `email_verified`, `verification_token`, `password_reset_token`, `password_reset_expires`. Indexes: `idx_users_email`, `idx_users_subdomain`. |
| `events` | Pages 7–8 | Migration Created | `id`, `photographer_id`, `event_name`, `couple_names`, `event_date`, `theme`, `location`, `client_email`, `client_phone`, `plan`, `status`, `unique_slug`, `description`, `invitation_html`, `landing_page_html`, `photo_count`, `video_count`, `view_count`, `amount_paid`, `payment_status`, `created_at`, `ready_at`, `went_live_at`, `admin_notes`. Indexes: `idx_events_photographer`, `idx_events_slug`, `idx_events_status`. |
| `photos` | Page 9 | Migration Created | `id`, `event_id`, `uploaded_by`, `cloudinary_id`, `cloudinary_url`, `cloudinary_thumb_url`, `file_type`, `upload_date`, `created_at`. Indexes: `idx_photos_event`, `idx_photos_uploaded_by`. |
| `subscriptions` | Page 10 | Migration Created | `id`, `photographer_id`, `event_id`, `plan`, `amount`, `features`, `purchased_at`, `expires_at`. |
| `analytics` | Pages 10–11 | Migration Created | `id`, `event_id`, `action`, `action_date` (DATE NOT NULL), `user_ip`, `user_agent`, `referrer`, `created_at`. Index: `idx_analytics_event`. |
| `admin_logs` | Page 11 | Migration Created | `id`, `admin_id`, `action`, `entity_type`, `entity_id`, `reason`, `created_at`. |
| `subdomains` | Page 26 | Migration Created | `id`, `photographer_id`, `subdomain_name`, `created_at`, `is_active`. |
