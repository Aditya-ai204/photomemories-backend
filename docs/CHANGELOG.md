# Changelog

All notable changes to the PhotoMemories AI Backend system will be documented in this file.
Authoritative Specification: `PhotoMemories_Backend_PRD_V2.pdf`

## [Phase 4: Step 6 - Phase 4 Verification, Full Regression Audit & Sign-off] - 2026-09-26

### Verified & Audited
- **Comprehensive Audit of Phase 4 Endpoints & Services**:
  - `GET /api/admin/events/pending`: Verified admin RBAC, FIFO sorting, photographer attribution, plan details, and `amount_paid`.
  - `POST /api/admin/events/:eventId/mark-ready`: Verified admin RBAC, request body validation (`invitation_html`, `landing_page_html`), state machine verification (`pending` only), DB update, `admin_logs` insertion, and non-blocking photographer email dispatch.
  - `GET /api/admin/events`: Verified admin RBAC, query filters (`status`, `photographer_id`), pagination, whitelisted sorting, and photographer attribution.
  - `POST /api/events/:eventId/upload-photos`: Verified photographer RBAC, IDOR defense, state check (`ready_for_upload` | `live`), file size/type validation, direct Cloudinary buffer streaming, atomic DB transaction, counter updates, auto-transition to `live` with `went_live_at`, and Cloudinary failure rollback.
  - `GET /api/events/:eventId/photos`: Verified photographer RBAC, IDOR defense, and metadata query sorted by `upload_date DESC`.
  - `DELETE /api/photos/:photoId`: Verified photographer RBAC, event join IDOR defense, Cloudinary asset deletion with matching resource type (`image` vs `video`), atomic DB row deletion, and safe counter decrements using `GREATEST(0, count - 1)`.
- **Security Audit**: 100% parameterized SQL queries, zero credential leaks, memory-only multipart processing, strict role authorization (`admin` vs `photographer`), and bulletproof IDOR protection.
- **Verification Results**:
  - Automated tests: **257 passed, 0 failed, 0 skipped across 18 test suites**.
  - TypeScript typecheck: **PASS (0 errors, Code 0)**.
  - Production build: **PASS (Code 0)**.
- **Sign-off**: Phase 4 completed with 0 PRD defects and 0 regressions. Ready for Phase 5.

---

## [Phase 4: Step 5 - Photo Management Endpoints] - 2026-09-26

### Added
- **Photo Management Controller (`src/controllers/photoController.ts`)**:
  - `getEventPhotos`:
    - Enforces authentication and photographer role (`requireAuth` + `requireRole('photographer')`).
    - Validates route parameter `eventId` (must be a positive integer, returns 400 `INVALID_EVENT_ID` otherwise).
    - Verifies event existence: returns 404 `EVENT_NOT_FOUND` if event does not exist.
    - Enforces IDOR security: verifies caller owns the event (`event.photographer_id === req.user.userId`), returning 403 `FORBIDDEN` otherwise.
    - Queries photos ordered by `upload_date DESC, id DESC` to ensure deterministic ordering.
    - Returns HTTP 200 `{ success: true, photos: [...] }` matching PRD Pages 16–17.
  - `deletePhoto`:
    - Enforces authentication and photographer role (`requireAuth` + `requireRole('photographer')`).
    - Validates route parameter `photoId` (must be a positive integer, returns 400 `INVALID_PHOTO_ID` otherwise).
    - Lookups photo joined with `events` table to verify existence and check photographer ownership (`e.photographer_id === req.user.userId`). Returns 404 `PHOTO_NOT_FOUND` or 403 `FORBIDDEN` (IDOR defense).
    - Validates eventId consistency if invoked via sub-resource route (`/events/:eventId/photos/:photoId`), rejecting mismatched events with 400 `EVENT_MISMATCH`.
    - Deletes asset from Cloudinary via `deleteFromCloudinary` with appropriate resource type (`photo` -> `'image'`, `video` -> `'video'`).
    - Atomically executes PostgreSQL transaction (`BEGIN` / `COMMIT` / `ROLLBACK`):
      - Deletes row from `photos` table.
      - Decrements `events.photo_count` or `events.video_count` safely using `GREATEST(0, count - 1)`.
    - Returns HTTP 200 `{ success: true, message: "Photo deleted successfully" }` matching PRD Page 17.
- **Photo Routes (`src/routes/photoRoutes.ts` & `src/routes/eventRoutes.ts`)**:
  - Created `src/routes/photoRoutes.ts` mounting `DELETE /api/photos/:photoId`.
  - Registered `router.get('/:eventId/photos')` and `router.delete('/:eventId/photos/:photoId')` in `src/routes/eventRoutes.ts`.
  - Mounted `photoRoutes` at `/api/photos` in `src/app.ts`.
- **Integration Tests (`tests/integration/photoManagement.test.ts`)**:
  - 18 integration tests covering 401 unauthenticated, 403 admin role rejection, 400 invalid IDs, 404 not found, 403 IDOR prevention for both GET and DELETE, 200 empty photos list, 200 sorted photos list, 200 photo deletion with Cloudinary destroy and `photo_count` decrement, 200 video deletion with `video_count` decrement, 500 DB transaction rollback, and sub-resource route validation.
  - Total test suite now: **257 tests passing across 18 test suites (0 failed, 0 skipped)**.

---

## [Phase 4: Step 4 - Cloudinary Upload Service & Photo/Video Upload] - 2026-09-26

### Added
- **Cloudinary Service (`src/services/cloudinaryService.ts`)**:
  - `uploadBufferToCloudinary`: Streams in-memory file buffers directly to Cloudinary using `upload_stream`. Generates high-quality 300x300 square cropped thumbnail URLs for photos and video poster frames.
  - `deleteFromCloudinary`: Deletes assets from Cloudinary by `public_id` and resource type (`image` or `video`) for rollbacks and deletions.
- **Upload Middleware (`src/middleware/upload.ts`)**:
  - Configures `multer` memory storage (zero untrusted disk persistence).
  - Enforces strict MIME-type validation for `photos` (JPEG, PNG, WEBP, HEIC/HEIF) and `videos` (MP4, MOV, WEBM, MKV).
  - Enforces production engineering size safeguards (25MB max per photo, 100MB max per video, 50 photos max, 10 videos max per batch).
  - Converts Multer errors (`LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, `LIMIT_UNEXPECTED_FILE`) to standardized `AppError` payloads (HTTP 400).
- **Photo Upload Controller (`src/controllers/photoController.ts`)**:
  - `uploadEventPhotos`:
    - Enforces authentication and photographer role (`requireAuth` + `requireRole('photographer')`).
    - Validates route parameter `eventId` (must be positive integer, returns 400 `INVALID_EVENT_ID` otherwise).
    - Validates file presence: returns 400 `NO_FILES_PROVIDED` if neither photos nor videos are supplied.
    - Verifies event existence: returns 404 `EVENT_NOT_FOUND` if event does not exist.
    - Enforces IDOR security: verifies caller owns the event (`event.photographer_id === req.user.userId`), returning 403 `FORBIDDEN` otherwise.
    - Enforces state machine: verifies status is `'ready_for_upload'` or `'live'`, rejecting `'pending'` or `'archived'` events with 400 `INVALID_EVENT_STATE`.
    - Uploads assets to Cloudinary under folder `photomemories/events/{eventId}/{photos|videos}`.
    - Executes atomic database transaction (`BEGIN` / `COMMIT` / `ROLLBACK`):
      - Inserts record into `photos` table (`event_id`, `uploaded_by`, `cloudinary_id`, `cloudinary_url`, `cloudinary_thumb_url`, `file_type`).
      - Updates `events.photo_count` and `events.video_count`.
      - Automatically transitions event status from `'ready_for_upload'` to `'live'` upon first upload and sets `went_live_at = CURRENT_TIMESTAMP` (PRD Page 16).
    - Implements automated Cloudinary rollback: if Cloudinary upload fails midway or database transaction rolls back, all newly uploaded Cloudinary assets are cleaned up immediately to prevent orphaned media.
    - Returns HTTP 201 response strictly matching PRD Page 16: `{ success: true, uploaded_count: number, event_status: "live", event_url: "photographer.photomemories.ai/event/slug" }`.
- **Event Routes (`src/routes/eventRoutes.ts`)**:
  - Registered `POST /:eventId/upload-photos` with `requireAuth`, `requireRole('photographer')`, `uploadPhotosAndVideosMiddleware`, and `uploadEventPhotos`.
- **Unit & Integration Tests**:
  - `tests/unit/cloudinaryService.test.ts`: 6 unit tests covering image upload, video upload, stream error handling, thumbnail fallback, asset deletion, and destroy error handling.
  - `tests/integration/photoUpload.test.ts`: 16 integration tests covering 401 unauthenticated, 403 non-photographer role, 400 invalid event ID, 400 missing files, 400 invalid photo/video MIME types, 400 unexpected fields, 404 nonexistent event, 403 IDOR event ownership defense, 400 pending status rejection, 400 archived status rejection, 201 first upload auto-gallery transition (`ready_for_upload` -> `live`), 201 subsequent upload preserving `live`, 502 Cloudinary upload failure rollback, and 500 DB transaction failure rollback.
  - Total test suite now: **239 tests passing across 17 test suites (0 failed, 0 skipped)**.

---

## [Phase 4: Step 3 - Admin Mark Ready Endpoint] - 2026-09-25


### Added
- **Admin Mark Ready Controller (`src/controllers/adminController.ts`)**:
  - `markEventReady` & `markReadySchema`:
    - Enforces authentication and `admin` role via middleware (`requireAuth` + `requireRole('admin')`).
    - Validates route parameter `eventId` (must be a positive integer, returns 400 `INVALID_EVENT_ID` otherwise).
    - Validates request body with Zod schema: `invitation_html` and `landing_page_html` must be non-empty strings (returns 400 `VALIDATION_ERROR` otherwise). Supports optional `admin_notes`.
    - Verifies event existence: returns 404 `EVENT_NOT_FOUND` if event does not exist.
    - Enforces event state machine: returns 400 `INVALID_EVENT_STATE` if event is not in `pending` status.
    - Updates `events` record: sets `status = 'ready_for_upload'`, `invitation_html = $1`, `landing_page_html = $2`, `ready_at = CURRENT_TIMESTAMP`, `admin_notes = COALESCE($3, admin_notes)`.
    - Inserts audit record into `admin_logs` table (`admin_id`, `action = 'mark_ready'`, `entity_type = 'event'`, `entity_id = eventId`, `reason`).
    - Dispatches photographer email notification (`sendPhotographerAlbumReadyEmail`) asynchronously and non-blocking: "Album ready! Upload your photos for [event_name]".
    - Returns HTTP 200 response strictly matching PRD Pages 18–19: `{ success: true, event_id: number, status: "ready_for_upload" }`.
- **Email Service (`src/services/emailService.ts`)**:
  - `sendPhotographerAlbumReadyEmail`:
    - Subject: `Album ready! Upload your photos for [event_name]`.
    - Informs photographer that admin/Krish has finished designing the invitation card and landing page, and their album is now ready for uploading photos and videos.
- **Admin Routes (`src/routes/adminRoutes.ts`)**:
  - Registered `POST /events/:eventId/mark-ready`.
- **Integration Tests (`tests/integration/adminMarkReady.test.ts`)**:
  - 14 comprehensive integration tests covering unauthenticated rejection (401), photographer role rejection (403), non-numeric event ID (400), zero/negative event ID (400), missing invitation HTML (400), empty invitation HTML (400), missing landing page HTML (400), empty landing page HTML (400), nonexistent event (404), event already in `ready_for_upload` status (400), event already in `live` status (400), successful mark-ready transition with DB update and audit log (200), optional `admin_notes` handling, and DB error handling (500).
  - Total test suite now: **217 tests passing across 15 test suites (0 failed, 0 skipped)**.

---

## [Phase 4: Step 2 - Admin Event Listing Endpoints] - 2026-09-25


### Added
- **Admin Controller (`src/controllers/adminController.ts`)**:
  - `getPendingEvents`:
    - Enforces authentication and `admin` role (`requireAuth` + `requireRole('admin')`).
    - Queries database for events with `status = 'pending'`, joining `users` to attach `photographer_name` and `photographer_email`.
    - Returns plan details, amount paid, and ISO `requested_at` timestamp.
    - Matches exact PRD Pages 17–18 payload: `{ success: true, pending_events: [...] }`.
  - `getAllAdminEvents`:
    - Enforces authentication and `admin` role (`requireAuth` + `requireRole('admin')`).
    - Queries all events across all photographers with photographer attribution (`photographer_id`, `photographer_name`, `photographer_email`) and revenue fields (`amount_paid`, `payment_status`).
    - Supports status filtering (`pending`, `ready_for_upload`, `live`, `archived`) with 400 validation on invalid status.
    - Supports `photographer_id` filtering with 400 validation on non-positive integers.
    - Implements safe sorting via SQL injection-proof whitelist mapping.
    - Implements pagination (`page`, `limit` / `pageSize` with boundary limits).
    - Matches PRD Page 19 specifications: `{ success: true, events: [...], pagination: { page, limit, total, total_pages } }`.
- **Admin Routes (`src/routes/adminRoutes.ts`)**:
  - Registered `GET /events/pending` and `GET /events`.
  - Applied `requireAuth` and `requireRole('admin')` to all admin routes.
  - Mounted under `/api/admin` in `src/app.ts`.
- **Integration Tests (`tests/integration/adminPendingEvents.test.ts`)**:
  - 17 comprehensive integration tests covering pending events retrieval, unauthenticated rejection (401), photographer role rejection (403), non-admin rejection (403), status = 'pending' enforcement, photographer metadata, plan info, amount paid, requested timestamp, empty results, sensitive field shielding, all events retrieval, status filtering, invalid status rejection (400), photographer_id filtering, invalid photographer_id rejection (400), combined filters, pagination, whitelisted sorting, and empty pagination states.
  - Total test suite now: **203 tests passing across 14 test suites (0 failed, 0 skipped)**.

---

## [Phase 3: Step 7 - Final Verification, Audit & Sign-off] - 2026-09-25

### Verified & Audited
- **Authoritative PRD Audit**:
  - Audited all Phase 3 endpoints and services directly against physical `PhotoMemories_Backend_PRD_V2.pdf` (Pages 7–8, 12–15, 23–24, 27–29).
  - Validated 100% compliance across `POST /api/events/request`, `GET /api/photographer/events`, `GET /api/photographer/events/:eventId`, and `POST /api/payments/webhook`.
  - Confirmed RBAC (`requireAuth` + `requireRole('photographer')`) on photographer endpoints and server-to-server HMAC signature auth on webhook.
  - Confirmed strict SQL ownership filtering (`WHERE photographer_id = $1`) preventing IDOR attacks.
  - Confirmed AES-256-GCM contact encryption/decryption at rest using authoritative `src/utils/crypto.ts`.
  - Confirmed Razorpay order creation in paise, constant-time HMAC-SHA256 signature verification, and webhook idempotency.
  - Confirmed zero secret exposure in error responses, JSON payloads, and logs.
  - Confirmed non-blocking email dispatch to photographer ("Admin will create your pages") and admin Krish ("New request from photographer X").
- **Automated Verification**:
  - Full test suite passed: **186 tests passed, 0 failed, 0 skipped** across all 13 test suites.
  - TypeScript typecheck passed: `tsc --noEmit` exited with code 0 (0 errors).
  - Production build passed: `tsc` exited with code 0 (clean output in `dist/`).
- **Phase 3 Signed Off**: Phase 3 is fully implemented and signed off without unresolved defects.

---

## [Phase 3: Step 6 - Payment Webhook Endpoint] - 2026-09-24

### Added
- **Payment Webhook Controller (`src/controllers/paymentController.ts`)**:
  - `handlePaymentWebhook`:
    - Enforces cryptographic HMAC-SHA256 signature verification over the incoming raw request body using `verifyRazorpaySignature` from `src/services/paymentService.ts` and `RAZORPAY_KEY_SECRET` (or `RAZORPAY_WEBHOOK_SECRET`).
    - Validates presence of `x-razorpay-signature` header, returning 400 `MISSING_SIGNATURE` if missing.
    - Constant-time verification prevents timing attacks and rejects forged/tampered signatures with 400 `INVALID_SIGNATURE`.
    - Operates as an asynchronous server-to-server callback without requiring user JWT authentication.
    - Resolves event identifier from webhook payload notes (`slug`, `event_slug`, `event_id`).
    - Queries database for event record and associated photographer details (`events` JOIN `users`).
    - Implements idempotency: if event already has `payment_status = 'completed'`, returns 200 OK with `already_processed: true` without redundant DB writes or duplicate email notifications.
    - Updates event in PostgreSQL database: `payment_status = 'completed'` and `amount_paid`.
    - Dispatches email notification to photographer: "Admin will create your pages" (`sendPhotographerPaymentConfirmationEmail` in `src/services/emailService.ts`).
    - Dispatches email notification to admin (Krish): "New request from photographer X" (`sendAdminPaymentNotificationEmail` in `src/services/emailService.ts`).
    - Non-blocking email dispatch: SMTP/network failures log errors safely without rolling back the completed payment transaction or crashing the webhook response.
    - Redacts credentials, secrets, and raw signatures from all logs.
- **Payment Routes (`src/routes/paymentRoutes.ts`)**:
  - Registered public route `POST /webhook` without `requireAuth`.
  - Mounted under `/api/payments` in `src/app.ts`.
- **Raw Body Buffer Capture (`src/app.ts`, `src/types/index.ts`)**:
  - Extended Express `Request` type with `rawBody?: string;`.
  - Configured `verify` callback in `express.json` to capture raw body string for accurate HMAC-SHA256 signature verification.
- **Integration Tests (`tests/integration/paymentWebhook.test.ts`)**:
  - 13 comprehensive integration tests covering missing signature (400), whitespace signature (400), invalid/tampered signature (400), secret leakage prevention, server-to-server callback without JWT token, missing event reference (400), nonexistent event (404), successful webhook processing via slug lookup (200), successful webhook processing via event_id lookup (200), realistic nested Razorpay webhook payload with paise-to-rupee conversion (200), idempotency on duplicate deliveries (200 already_processed), resilient/non-blocking email failure handling, and database error handling (500).
  - Total test suite now: **186 tests passing across 13 test suites (0 failed, 0 skipped)**.

---

## [Phase 3: Step 5 - Photographer Event Endpoints] - 2026-09-24

### Added
- **Photographer Controller (`src/controllers/photographerController.ts`)**:
  - `getPhotographerEvents`:
    - Enforces authentication and photographer role (`req.user.userId`).
    - Enforces strict object-level authorization directly in SQL (`WHERE photographer_id = $1`) so photographers cannot view other photographers' events.
    - Implements pagination (`page`, `limit` / `pageSize` with boundary limits).
    - Implements safe sorting via SQL injection-proof whitelist mapping (`created_at`, `event_date`, `ready_at`, `event_name`, `status`, `photo_count`).
    - Implements status filtering (`pending`, `ready_for_upload`, `live`, `archived`) with 400 `INVALID_STATUS` validation.
    - Shields sensitive contact data (`client_email`, `client_phone`) from list view.
    - Returns structured `{ success: true, events: [...], pagination: { page, limit, total, total_pages } }` matching PRD Page 14.
  - `getPhotographerEventById`:
    - Enforces authentication and photographer role.
    - Validates positive integer `eventId` parameter with 400 `INVALID_ID`.
    - Enforces strict ownership directly in SQL (`WHERE id = $1 AND photographer_id = $2`), preventing IDOR attacks and returning 404 `NOT_FOUND` for nonexistent or unauthorized events.
    - Decrypts sensitive contact details at rest (`client_email`, `client_phone`) using authoritative AES-256-GCM cipher utility (`decryptData` from `src/utils/crypto.ts`) per PRD Pages 7, 23–24.
    - Queries and attaches associated photos from `photos` table.
    - Returns exact PRD Page 15 structured payload `{ success: true, event: { id, event_name, couple_names, event_date, theme, location, client_email, client_phone, status, plan, invitation_html, landing_page_html, unique_slug, description, photo_count, video_count, view_count, amount_paid, payment_status, ready_at, went_live_at, created_at, photos: [...] } }`.
- **Photographer Routes (`src/routes/photographerRoutes.ts`)**:
  - Mounted `GET /events` and `GET /events/:eventId` protected by `requireAuth` and `requireRole('photographer')`.
  - Mounted under `/api/photographer` in `src/app.ts`.
- **Integration Tests (`tests/integration/photographerEvents.test.ts`)**:
  - 18 comprehensive integration tests covering list retrieval, unauthenticated requests (401), non-photographer role (403), cross-photographer data isolation, pagination, sorting, status filtering, invalid status rejection (400), empty results, contact shielding in list view, single event retrieval, contact decryption, nonexistent events (404), unauthorized event access (404/IDOR defense), exact PRD Page 15 payload structure, and malformed event ID handling (400).
  - Total test suite now: **173 tests passing across 12 test suites (0 failed, 0 skipped)**.

---

## [Phase 3: Step 4 - Event Request Endpoint] - 2026-09-24

### Added
- **Validation Schema (`src/controllers/eventController.ts`)**:
  - `createEventRequestSchema`: Validates required fields (`event_name`, `couple_names`, `event_date`, `theme`, `location`, `client_email`, `client_phone`, `plan`, `amount`) and optional `description`.
- **Event Controller (`src/controllers/eventController.ts`)**:
  - `createEventRequest`:
    - Enforces authentication (`req.user.userId`).
    - Validates request body using Zod.
    - Validates plan amount against configured plan pricing (`validatePlanAmount`) per ADR-002.
    - Encrypts sensitive contact details (`client_email`, `client_phone`) using AES-256-GCM (`encryptData` from `src/utils/crypto.ts`) per PRD Pages 7, 23–24.
    - Generates unique event slug using `generateUniqueEventSlug` from `src/services/eventSlugService.ts`.
    - Creates Razorpay payment order using `createRazorpayOrder` from `src/services/paymentService.ts`.
    - Persists event record in `events` table with `status = 'pending'`, `payment_status = 'pending'`, and parameterized SQL.
    - Responds with HTTP 201 `{ success: true, event_id, payment_url, plan }` per PRD Page 13.
    - Sanitizes log output to eliminate any sensitive contact data or secret exposure.
- **Event Routes (`src/routes/eventRoutes.ts`)**:
  - Registered `POST /request` protected by `requireAuth` and `requireRole('photographer')`.
  - Mounted under `/api/events` in `src/app.ts`.
- **Integration Tests (`tests/integration/eventRequest.test.ts`)**:
  - 11 comprehensive integration tests covering successful event creation (201), unauthenticated requests (401), non-photographer role (403), missing required fields (400), invalid plan (400), mismatched plan amount (400), AES-256-GCM encryption at rest, unique slug persistence, Razorpay order creation in paise, status pending initialization, Razorpay API failure handling (502), and database failure handling (500).
  - Total test suite now: **155 tests passing across 11 test suites (0 failed, 0 skipped)**.

---

## [Phase 3: Step 3 - Payment Intent Service & HMAC-SHA256 Signature Verification] - 2026-09-24

### Added
- **Dependency**: Installed official `razorpay` SDK (`^2.9.8`) with built-in TypeScript declarations.
- **Payment Service (`src/services/paymentService.ts`)**:
  - Implemented `isValidPlan` and `validatePlan` enforcing strict plan validation (`base`, `medium`, `pro`) with case-insensitivity and 400 `INVALID_PLAN` AppError.
  - Implemented configurable plan pricing model per **ADR-002**:
    - `DEFAULT_PLAN_PRICING` with `pro` defaulting to ₹25,000 (PRD Page 13 example) and sensible defaults for `base` (₹5,000) and `medium` (₹15,000).
    - `configurePlanPricing`, `resetPlanPricing`, `getPlanPrice`, `getAllPlanPrices`, and `validatePlanAmount`.
  - Implemented currency subunit conversion (`convertAmountToSmallestUnit`) converting INR amounts to paise (1 INR = 100 paise) with validation against non-positive, zero, NaN, or non-finite inputs.
  - Implemented `getRazorpayClient` instantiating Razorpay client with `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` with credential validation and zero secret leakage.
  - Implemented `createRazorpayOrder` creating payment orders with plan validation, price verification, currency conversion, error sanitization, and structured `RazorpayOrderResult` return object.
  - Implemented HMAC-SHA256 cryptographic utilities:
    - `generateRazorpaySignature`: Computes hex HMAC-SHA256 digest using `RAZORPAY_KEY_SECRET`.
    - `verifyRazorpaySignature`: Validates signatures against payloads using constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks, safely rejecting malformed/tampered signatures.
    - `verifyRazorpayPaymentSignature`: Helper verifying `${orderId}|${paymentId}` checkout signatures.
  - Implemented `sanitizePaymentErrorMessage`: Strips sensitive keys, key secrets, and Razorpay IDs before logging or throwing.
- **Unit Tests (`tests/unit/paymentService.test.ts`)**:
  - Added 27 unit tests covering all 16 required test scenarios: plan resolution, invalid plan rejection, configurable pricing, subunit conversion, Pro default pricing, mocked order creation, API failure handling, missing credentials, invalid credentials, HMAC generation, valid signature acceptance, forged signature rejection, tampered payload rejection, wrong secret rejection, malformed signature rejection, payment callback signature verification, and zero secret leakage.
  - Total test suite now: **144 tests passing across 10 test suites (0 failed, 0 skipped)**.

---

## [Phase 3: Step 2 - Event Slug Generation Service] - 2026-09-23

### Added
- **Event Slug Service (`src/services/eventSlugService.ts`)**:
  - Implemented `sanitizeEventSlugPart` formatting alphanumeric hyphen-separated slugs (lowercase, trimmed, hyphen-deduplicated).
  - Implemented `extractEventYear` parsing calendar years from date strings/objects.
  - Implemented `buildBaseEventSlug` prioritizing `couple_names` over `event_name` and appending event year (e.g. `aarav-priya-2024`).
  - Implemented `isEventSlugAvailable` checking uniqueness against `events.unique_slug` via parameterized query.
  - Implemented `generateUniqueEventSlug` resolving collisions deterministically (`slug`, `slug-1`, `slug-2`, ...).
- **Unit Tests (`tests/unit/eventSlug.test.ts`)**:
  - Added 22 unit tests covering formatting, prioritization, year extraction, length bounds, and collision handling.

---

## [Phase 2: Step 5 - Comprehensive Audit & Sign-off] - 2026-09-23

### Completed
- **Full PRD V2 Authentication Audit**:
  - Reconciled all 6 authentication endpoints, password utility (bcrypt cost 10), JWT utilities (24h/7d expiry, type discrimination), cookie transport, auth middleware (`requireAuth`), role authorization (`requireRole`), subdomain generation/assignment, and email service against `PhotoMemories_Backend_PRD_V2.pdf`.
  - Audited security controls: parameterization, password/hash masking, token isolation, account enumeration protections, and CORS/cookie compatibility confirmed.
  - Verified 95/95 test passing across 8 suites, 0 failed, 0 skipped.
  - Confirmed TypeScript typecheck (`tsc --noEmit`) and production build (`tsc`) exit with Code 0.
  - Formally signed off Phase 2 as complete and verified. Ready for Phase 3 (Event Management).

---

## [Phase 2: Step 4 - Authentication Endpoints & Controllers] - 2026-09-23

### Added
- **Validation Schemas (`src/controllers/authController.ts`)**:
  - `signupSchema`: Validates email, min 8-character password, required name, optional company_name and phone.
  - `loginSchema`: Validates email and required password.
  - `verifyEmailSchema`: Validates required verification token.
  - `forgotPasswordSchema`: Validates required target email.
  - `resetPasswordSchema`: Validates required token and min 8-character new password.
- **Authentication Controller (`src/controllers/authController.ts`)**:
  - `signup`: Handles registration, checks existing email, hashes password, auto-generates photographer subdomain, records user, triggers verification email, signs JWTs, sets httpOnly cookies, and returns `{ success: true, user, token, subdomain }` with 201 status per PRD Pages 11–12.
  - `login`: Validates credentials, verifies bcrypt hash, checks account active status, updates `last_login`, signs JWTs, sets httpOnly cookies, and returns `{ success: true, user, token }` with 200 status per PRD Page 12.
  - `logout`: Protected endpoint clearing access and refresh cookies, returning `{ success: true }`.
  - `verifyEmail`: Validates token, marks `email_verified = true`, clears `verification_token`, returning `{ success: true }`.
  - `forgotPassword`: Generates secure reset token with 1-hour expiration (`password_reset_expires`), dispatches email, and responds with generic success to prevent account enumeration.
  - `resetPassword`: Validates token & expiration, hashes new password with bcrypt, updates user, invalidates reset token, returning `{ success: true }`.
- **Authentication Routes (`src/routes/authRoutes.ts`)**:
  - Registered 6 endpoints and mounted router under `/api/auth` in `src/app.ts`.
- **Integration Tests (`tests/integration/auth.test.ts`)**:
  - 18 comprehensive integration tests covering successful execution, validation failure, duplicate email, invalid credentials, inactive account, protected logout, email verification, account enumeration protection, and expired token rejection.

---

## [Phase 2: Step 3 - Subdomain Auto-Generation & Email Notification Service] - 2026-09-23

### Added
- **Subdomain Service (`src/services/subdomainService.ts`)**:
  - Implemented `sanitizeSubdomain` converting business names into RFC 1035/1123 DNS-compatible slugs (3–63 chars).
  - Implemented `isValidSubdomainFormat` and `isReservedSubdomain` safeguarding critical infrastructure routes (`api`, `admin`, `auth`, etc.).
  - Implemented `formatFullDomain` generating `${subdomain}.photomemories.ai` FQDN per PRD Pages 4, 20.
  - Implemented `isSubdomainAvailable` verifying availability across both `users` and `subdomains` tables.
  - Implemented `generateUniqueSubdomain` with deterministic collision resolution (`-1`, `-2`, etc.).
  - Implemented `assignSubdomain` recording into `subdomains` table and updating `users.subdomain` per PRD Pages 22, 26.
- **Email Notification Service (`src/services/emailService.ts`)**:
  - Implemented `generateSecureToken` producing 64-character (32-byte) hex cryptographically secure tokens.
  - Implemented `buildVerificationUrl` and `buildPasswordResetUrl` matching `FRONTEND_URL`.
  - Implemented `sendVerificationEmail` for user registration verification per PRD Pages 11–12.
  - Implemented `sendPasswordResetEmail` with 1-hour expiration warning (`PASSWORD_RESET_EXPIRY_MS`).
  - Configured Nodemailer transporter with test-safe `jsonTransport` in test mode (`sentEmailsLog`), avoiding external SMTP calls.
- **Unit Tests (`tests/unit/subdomainService.test.ts` & `tests/unit/emailService.test.ts`)**:
  - 24 unit tests covering sanitization, length boundaries, format regex, reserved name handling, collision resolution, database persistence, secure token generation, URL construction, email formatting, and test logs.

---

## [Phase 2: Step 2 - Cookie Transport & Authentication Middleware] - 2026-09-23

### Added
- **Cookie Transport Utility (`src/utils/cookies.ts`)**:
  - Implemented `setAuthCookies` and `clearAuthCookies` per PRD Pages 24, 30.
  - Configured `httpOnly: true`, root path `'/'`, 24h expiration (`ACCESS_TOKEN_MAX_AGE_MS`) for access tokens, and 7d expiration (`REFRESH_TOKEN_MAX_AGE_MS`) for refresh tokens.
  - Implemented environment-aware `secure` and `sameSite` configuration supporting cross-domain production (Vercel to Railway) and local development.
- **Authentication & Role Middleware (`src/middleware/auth.ts`)**:
  - Implemented `requireAuth` reading access tokens from httpOnly cookies with Bearer header fallback, verifying tokens using `verifyAccessToken()`, and attaching `req.user`.
  - Implemented `requireRole(...allowedRoles)` verifying role claims ('photographer' | 'admin') and rejecting unauthorized callers with standardized 403 `AppError`.
- **Express Request Typing (`src/types/index.ts`)**:
  - Extended Express global `Request` namespace to include `user?: DecodedAccessToken`.
- **Unit Tests (`tests/unit/authMiddleware.test.ts`)**:
  - 18 unit tests covering cookie setting, expiration, clear behavior, valid authentication via cookie, Bearer header fallback, missing token rejection, invalid signature, expired tokens, refresh token rejection, and role-based authorization.

---

## [Phase 2: Step 1 - Authentication Cryptographic & Token Utilities] - 2026-09-23

### Added
- **Password Utility (`src/utils/password.ts`)**:
  - Implemented `hashPassword` using `bcrypt` with salt cost factor 10 per PRD Page 23.
  - Implemented `comparePassword` with timing-safe comparison and error shielding.
  - Strict input validation preventing blank/empty string passes.
- **JWT Token Utility (`src/utils/jwt.ts`)**:
  - Implemented `signAccessToken` (default 24h expiration via `JWT_EXPIRY` & `JWT_SECRET`) per PRD Pages 24, 28.
  - Implemented `signRefreshToken` (default 7d expiration via `JWT_REFRESH_EXPIRY` & `JWT_REFRESH_SECRET`) per PRD Pages 24, 28.
  - Implemented `verifyAccessToken` and `verifyRefreshToken` validating cryptographic signature and enforcing token type discriminator.
  - Strict TypeScript definitions: `AccessTokenPayload`, `RefreshTokenPayload`, `DecodedAccessToken`, `DecodedRefreshToken`.
- **Unit Tests (`tests/unit/auth.test.ts`)**:
  - 17 unit tests verifying salt rounds, hashing, verification, salt variance, input validation, token sign/verify round-trips, expiration ranges, wrong secrets, wrong token types, and tamper rejections.

---

## [Phase 1: Foundation] - 2026-09-22

### Added
- **Project Structure & TypeScript**: Configured `package.json` with scripts and dependencies; established strict `tsconfig.json` targeting ES2022.
- **Authoritative Environment Configuration**: Created `.env.example` with all 17 PRD variables and implemented `src/config/env.ts` with Zod runtime schema validation.
- **AES-256-GCM Cryptographic Utility**: Created `src/utils/crypto.ts` implementing encryption and decryption in PRD format `${iv}:${authTag}:${encrypted}` with tamper detection.
- **Sanitized Structured Logger**: Created `src/utils/logger.ts` with automatic redaction of passwords, tokens, API keys, and encryption secrets.
- **PostgreSQL Connection Pool**: Created `src/database/index.ts` wrapping `pg.Pool` with SSL handling and query logging.
- **Reproducible Migration Framework**: Created `src/database/migrator.ts` and `src/database/migrations/001_initial_schema.sql` declaring all 7 PRD entities (`users`, `events`, `photos`, `subscriptions`, `analytics`, `admin_logs`, `subdomains`) with exact column names and indexes.
- **Security Middleware**: Created `src/middleware/security.ts` configuring Helmet (HSTS, CSP, X-Frame-Options: DENY), CORS bridge with credentials, and Rate Limiting (100 req / 15 min / IP).
- **Standardized Error Handling**: Created `src/middleware/errorHandler.ts` returning `{ success: false, error: string, code: string }` and HTTP status codes (200, 201, 400, 401, 403, 404, 500) and 404 catch-all.
- **Application Entrypoints**: Created `src/app.ts` assembling middleware and operational `/healthz` probe, and `src/server.ts` with graceful shutdown.
- **Automated Test Suite**: Created unit and integration tests across `tests/unit/config.test.ts`, `tests/unit/crypto.test.ts`, and `tests/integration/app.test.ts` (18 passing tests).
- **Documentation Suite**: Established `docs/` with `DECISIONS.md`, `CURRENT_STATE.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`, `NEXT_ACTIONS.md`, and `HANDOFF.md`.
