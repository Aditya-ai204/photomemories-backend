import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../database';
import { AppError } from '../types';
import { logger } from '../utils/logger';
import { sendPhotographerAlbumReadyEmail } from '../services/emailService';

/**
 * Valid event statuses defined in PRD Pages 7-8
 */
export const VALID_EVENT_STATUSES = ['pending', 'ready_for_upload', 'live', 'archived'] as const;
export type EventStatus = (typeof VALID_EVENT_STATUSES)[number];

/**
 * Whitelist of allowed sort fields to prevent SQL injection
 */
const ALLOWED_ADMIN_SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  event_date: 'event_date',
  ready_at: 'ready_at',
  event_name: 'event_name',
  status: 'status',
  amount_paid: 'amount_paid',
  photo_count: 'photo_count',
};

export interface PendingEventItem {
  id: number;
  event_name: string;
  photographer_name: string;
  photographer_email: string;
  plan: string;
  amount_paid: number;
  requested_at: string;
}

export interface AdminEventListItem {
  id: number;
  event_name: string;
  couple_names: string | null;
  event_date: string;
  theme: string;
  location: string | null;
  status: string;
  plan: string;
  amount_paid: number;
  payment_status: string;
  photographer_id: number;
  photographer_name: string;
  photographer_email: string;
  photo_count: number;
  video_count: number;
  view_count: number;
  unique_slug: string;
  ready_at: string | null;
  went_live_at: string | null;
  created_at: string;
}

/**
 * GET /api/admin/events/pending
 * Auth: Required (Admin only)
 * Source: PRD Pages 17-18
 * 
 * Fetches all events with status = 'pending' awaiting design and preparation.
 * Includes photographer details, plan info, amount paid, and requested timestamp.
 */
export async function getPendingEvents(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await query<{
      id: number;
      event_name: string;
      photographer_name: string | null;
      photographer_email: string;
      plan: string;
      amount_paid: number | string | null;
      requested_at: Date | string;
    }>(
      `SELECT
        e.id,
        e.event_name,
        u.name AS photographer_name,
        u.email AS photographer_email,
        e.plan,
        e.amount_paid,
        e.created_at AS requested_at
      FROM events e
      JOIN users u ON e.photographer_id = u.id
      WHERE e.status = 'pending'
      ORDER BY e.created_at ASC`
    );

    const pendingEvents: PendingEventItem[] = result.rows.map((row) => ({
      id: row.id,
      event_name: row.event_name,
      photographer_name: row.photographer_name || 'Photographer',
      photographer_email: row.photographer_email,
      plan: row.plan || 'base',
      amount_paid: row.amount_paid !== null ? Number(row.amount_paid) : 0,
      requested_at:
        row.requested_at instanceof Date
          ? row.requested_at.toISOString()
          : String(row.requested_at),
    }));

    logger.info('Admin retrieved pending events', { count: pendingEvents.length });

    res.status(200).json({
      success: true,
      pending_events: pendingEvents,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/events
 * Auth: Required (Admin only)
 * Query: { status, photographer_id, page, limit, sortBy }
 * Source: PRD Page 19
 * 
 * Returns all events across all photographers with photographer attribution,
 * revenue data, status filtering, and pagination.
 */
export async function getAllAdminEvents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Parse and validate pagination parameters
    const pageParam = parseInt(String(req.query['page'] || '1'), 10);
    const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

    const limitParam = parseInt(String(req.query['limit'] || req.query['pageSize'] || '10'), 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? 10 : Math.min(limitParam, 100);
    const offset = (page - 1) * limit;

    // 2. Parse and validate status filter
    const statusParam = req.query['status'];
    let statusFilter: string | undefined;
    if (typeof statusParam === 'string' && statusParam.trim().length > 0) {
      const normalizedStatus = statusParam.trim().toLowerCase();
      if (!VALID_EVENT_STATUSES.includes(normalizedStatus as EventStatus)) {
        throw new AppError(
          `Invalid status filter: "${statusParam}". Valid statuses are: ${VALID_EVENT_STATUSES.join(', ')}`,
          400,
          'INVALID_STATUS'
        );
      }
      statusFilter = normalizedStatus;
    }

    // 3. Parse and validate photographer_id filter
    const photographerIdParam = req.query['photographer_id'];
    let photographerIdFilter: number | undefined;
    if (photographerIdParam !== undefined && photographerIdParam !== '') {
      const parsedId = parseInt(String(photographerIdParam), 10);
      if (isNaN(parsedId) || parsedId <= 0) {
        throw new AppError(
          `Invalid photographer_id filter: "${photographerIdParam}". Must be a positive integer.`,
          400,
          'INVALID_PHOTOGRAPHER_ID'
        );
      }
      photographerIdFilter = parsedId;
    }

    // 4. Parse and validate sort column (SQL injection defense via whitelist)
    const sortByParam = typeof req.query['sortBy'] === 'string' ? req.query['sortBy'].trim() : 'created_at';
    const sortColumn = ALLOWED_ADMIN_SORT_COLUMNS[sortByParam] || 'created_at';

    // 5. Build parameterized query
    const conditions: string[] = [];
    const queryParams: unknown[] = [];

    if (statusFilter) {
      queryParams.push(statusFilter);
      conditions.push(`e.status = $${queryParams.length}`);
    }

    if (photographerIdFilter) {
      queryParams.push(photographerIdFilter);
      conditions.push(`e.photographer_id = $${queryParams.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countResult = await query<{ total: string }>(
      `SELECT COUNT(*)::text as total FROM events e ${whereClause}`,
      queryParams
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);
    const totalPages = Math.ceil(total / limit);

    // Data query
    const dataParams = [...queryParams, limit, offset];
    const limitPlaceholder = `$${dataParams.length - 1}`;
    const offsetPlaceholder = `$${dataParams.length}`;

    const dataResult = await query<{
      id: number;
      event_name: string;
      couple_names: string | null;
      event_date: string;
      theme: string;
      location: string | null;
      status: string;
      plan: string;
      amount_paid: number | string | null;
      payment_status: string;
      photographer_id: number;
      photographer_name: string | null;
      photographer_email: string;
      photo_count: number;
      video_count: number;
      view_count: number;
      unique_slug: string;
      ready_at: Date | string | null;
      went_live_at: Date | string | null;
      created_at: Date | string;
    }>(
      `SELECT
        e.id,
        e.event_name,
        e.couple_names,
        e.event_date,
        e.theme,
        e.location,
        e.status,
        e.plan,
        e.amount_paid,
        e.payment_status,
        e.photographer_id,
        u.name AS photographer_name,
        u.email AS photographer_email,
        e.photo_count,
        e.video_count,
        e.view_count,
        e.unique_slug,
        e.ready_at,
        e.went_live_at,
        e.created_at
      FROM events e
      JOIN users u ON e.photographer_id = u.id
      ${whereClause}
      ORDER BY e.${sortColumn} DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      dataParams
    );

    const events: AdminEventListItem[] = dataResult.rows.map((row) => ({
      id: row.id,
      event_name: row.event_name,
      couple_names: row.couple_names,
      event_date: row.event_date,
      theme: row.theme,
      location: row.location,
      status: row.status,
      plan: row.plan || 'base',
      amount_paid: row.amount_paid !== null ? Number(row.amount_paid) : 0,
      payment_status: row.payment_status || 'pending',
      photographer_id: row.photographer_id,
      photographer_name: row.photographer_name || 'Photographer',
      photographer_email: row.photographer_email,
      photo_count: row.photo_count ?? 0,
      video_count: row.video_count ?? 0,
      view_count: row.view_count ?? 0,
      unique_slug: row.unique_slug,
      ready_at: row.ready_at ? (row.ready_at instanceof Date ? row.ready_at.toISOString() : String(row.ready_at)) : null,
      went_live_at: row.went_live_at ? (row.went_live_at instanceof Date ? row.went_live_at.toISOString() : String(row.went_live_at)) : null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));

    res.status(200).json({
      success: true,
      events,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Validation schema for marking an event ready
 * Source: PRD Page 18
 */
export const markReadySchema = z.object({
  invitation_html: z
    .string({
      required_error: 'invitation_html is required',
      invalid_type_error: 'invitation_html must be a string',
    })
    .min(1, 'invitation_html cannot be empty'),
  landing_page_html: z
    .string({
      required_error: 'landing_page_html is required',
      invalid_type_error: 'landing_page_html must be a string',
    })
    .min(1, 'landing_page_html cannot be empty'),
  admin_notes: z.string().optional(),
});

/**
 * POST /api/admin/events/:eventId/mark-ready
 * Auth: Required (Admin only)
 * Request Body: { invitation_html: string, landing_page_html: string, admin_notes?: string }
 * Source: PRD Pages 18-19
 * 
 * - Verifies event exists & is in "pending" status
 * - Stores HTML in database
 * - Updates status to "ready_for_upload"
 * - Updates ready_at timestamp
 * - Logs action in admin_logs
 * - Sends email to photographer: "Album ready! Upload your photos"
 * 
 * Response:
 * {
 *   "success": true,
 *   "event_id": 42,
 *   "status": "ready_for_upload"
 * }
 */
export async function markEventReady(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Validate eventId route parameter
    const eventIdParam = req.params['eventId'];
    const eventId = parseInt(String(eventIdParam), 10);
    if (isNaN(eventId) || eventId <= 0) {
      throw new AppError(
        `Invalid event ID: "${eventIdParam}". Must be a positive integer.`,
        400,
        'INVALID_EVENT_ID'
      );
    }

    // 2. Validate request body
    const parseResult = markReadySchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0];
      const errorMessage = firstIssue
        ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
        : 'Invalid request body';
      throw new AppError(errorMessage, 400, 'VALIDATION_ERROR');
    }
    const { invitation_html, landing_page_html, admin_notes } = parseResult.data;

    // 3. Verify event exists and is in 'pending' status
    const eventResult = await query<{
      id: number;
      event_name: string;
      status: string;
      photographer_id: number;
      photographer_email: string;
      photographer_name: string | null;
    }>(
      `SELECT
        e.id,
        e.event_name,
        e.status,
        e.photographer_id,
        u.email AS photographer_email,
        u.name AS photographer_name
      FROM events e
      JOIN users u ON e.photographer_id = u.id
      WHERE e.id = $1`,
      [eventId]
    );

    const event = eventResult.rows[0];
    if (!event) {
      throw new AppError(`Event #${eventId} not found.`, 404, 'EVENT_NOT_FOUND');
    }


    if (event.status !== 'pending') {
      throw new AppError(
        `Cannot mark event ready: event #${eventId} is currently in '${event.status}' status, expected 'pending'.`,
        400,
        'INVALID_EVENT_STATE'
      );
    }

    // 4. Update events table: store HTML, status -> 'ready_for_upload', ready_at -> CURRENT_TIMESTAMP
    await query(
      `UPDATE events
      SET
        invitation_html = $1,
        landing_page_html = $2,
        status = 'ready_for_upload',
        ready_at = CURRENT_TIMESTAMP,
        admin_notes = COALESCE($3, admin_notes)
      WHERE id = $4`,
      [invitation_html, landing_page_html, admin_notes ?? null, eventId]
    );

    // 5. Insert audit log entry into admin_logs (PRD Pages 11, 18)
    const adminId = req.user?.userId;
    if (adminId) {
      await query(
        `INSERT INTO admin_logs (admin_id, action, entity_type, entity_id, reason)
        VALUES ($1, $2, $3, $4, $5)`,
        [
          adminId,
          'mark_ready',
          'event',
          eventId,
          admin_notes || 'Event pages designed and marked ready for upload',
        ]
      );
    }

    // 6. Send email notification to photographer (non-blocking)
    sendPhotographerAlbumReadyEmail(
      event.photographer_email,
      event.photographer_name || undefined,
      event.event_name
    ).catch((err) => {
      logger.error('Failed to send album ready email to photographer', {
        eventId,
        photographerEmail: event.photographer_email,
        error: err instanceof Error ? err.message : err,
      });
    });

    logger.info(`Event #${eventId} marked ready for upload by admin #${adminId}`, {
      eventId,
      adminId,
    });

    // 7. Response per PRD Page 18-19:
    // { "success": true, "event_id": 42, "status": "ready_for_upload" }
    res.status(200).json({
      success: true,
      event_id: eventId,
      status: 'ready_for_upload',
    });
  } catch (error) {
    next(error);
  }
}

