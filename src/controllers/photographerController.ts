import { Request, Response, NextFunction } from 'express';
import { query } from '../database';
import { AppError } from '../types';
import { decryptData } from '../utils/crypto';
import { logger } from '../utils/logger';

/**
 * Valid event statuses defined in PRD Pages 7-8
 */
export const VALID_EVENT_STATUSES = ['pending', 'ready_for_upload', 'live', 'archived'] as const;
export type EventStatus = (typeof VALID_EVENT_STATUSES)[number];

/**
 * Whitelist of allowed sort fields to prevent SQL injection
 */
const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  event_date: 'event_date',
  ready_at: 'ready_at',
  event_name: 'event_name',
  status: 'status',
  photo_count: 'photo_count',
};

export interface EventListItem {
  id: number;
  event_name: string;
  couple_names: string | null;
  event_date: string;
  theme: string;
  location: string | null;
  status: string;
  plan: string;
  photo_count: number;
  video_count: number;
  view_count: number;
  ready_at: string | null;
  created_at: string;
  unique_slug: string;
}

export interface PhotoRecord {
  id: number;
  event_id: number;
  uploaded_by: number | null;
  cloudinary_id: string;
  cloudinary_url: string;
  cloudinary_thumb_url: string | null;
  file_type: 'photo' | 'video';
  created_at: string;
}

export interface SingleEventResponseData {
  id: number;
  event_name: string;
  couple_names: string | null;
  event_date: string;
  theme: string;
  location: string | null;
  client_email: string | null;
  client_phone: string | null;
  status: string;
  plan: string;
  invitation_html: string | null;
  landing_page_html: string | null;
  unique_slug: string;
  description: string | null;
  photo_count: number;
  video_count: number;
  view_count: number;
  amount_paid: number | null;
  payment_status: string;
  ready_at: string | null;
  went_live_at: string | null;
  created_at: string;
  photos: PhotoRecord[];
}

/**
 * GET /api/photographer/events
 * Auth: Required (Photographer)
 * Query: { page, status, sortBy, limit }
 * Source: PRD Page 14
 * 
 * Lists events belonging strictly to the authenticated photographer with
 * pagination, status filtering, and safe sorting.
 */
export async function getPhotographerEvents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const currentUser = req.user;
    if (!currentUser || !currentUser.userId) {
      throw new AppError('Authentication required. Missing access token.', 401, 'UNAUTHORIZED');
    }

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

    // 3. Parse and validate sort column (SQL injection defense via whitelist mapping)
    const sortByParam = typeof req.query['sortBy'] === 'string' ? req.query['sortBy'].trim() : 'created_at';
    const sortColumn = ALLOWED_SORT_COLUMNS[sortByParam] || 'created_at';

    // 4. Build parameterized queries (enforcing ownership directly in SQL)
    const countConditions: string[] = ['photographer_id = $1'];
    const queryParams: unknown[] = [currentUser.userId];

    if (statusFilter) {
      queryParams.push(statusFilter);
      countConditions.push(`status = $${queryParams.length}`);
    }

    const whereClause = countConditions.join(' AND ');

    // Total count query
    const countResult = await query<{ total: string }>(
      `SELECT COUNT(*)::text as total FROM events WHERE ${whereClause}`,
      queryParams
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);
    const totalPages = Math.ceil(total / limit);

    // Data query
    const dataParams = [...queryParams, limit, offset];
    const limitPlaceholder = `$${dataParams.length - 1}`;
    const offsetPlaceholder = `$${dataParams.length}`;

    const dataResult = await query<EventListItem>(
      `SELECT
        id,
        event_name,
        couple_names,
        event_date,
        theme,
        location,
        status,
        plan,
        photo_count,
        video_count,
        view_count,
        ready_at,
        created_at,
        unique_slug
      FROM events
      WHERE ${whereClause}
      ORDER BY ${sortColumn} DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      dataParams
    );

    res.status(200).json({
      success: true,
      events: dataResult.rows,
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
 * GET /api/photographer/events/:eventId
 * Auth: Required (Photographer)
 * Source: PRD Page 15
 * 
 * Fetches a single event with strict IDOR ownership enforcement directly in SQL.
 * Decrypts sensitive contact details at rest (client_email, client_phone) and
 * includes associated photos and HTML documents.
 */
export async function getPhotographerEventById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const currentUser = req.user;
    if (!currentUser || !currentUser.userId) {
      throw new AppError('Authentication required. Missing access token.', 401, 'UNAUTHORIZED');
    }

    // 1. Validate eventId parameter
    const eventIdParam = req.params['eventId'];
    const eventId = parseInt(String(eventIdParam), 10);
    if (isNaN(eventId) || eventId <= 0 || !Number.isInteger(eventId)) {
      throw new AppError('Invalid event ID. Event ID must be a positive integer', 400, 'INVALID_ID');
    }

    // 2. Fetch event strictly filtered by authenticated photographer_id (IDOR defense)
    const eventResult = await query<any>(
      `SELECT
        id,
        photographer_id,
        event_name,
        couple_names,
        event_date,
        theme,
        location,
        client_email,
        client_phone,
        plan,
        status,
        unique_slug,
        description,
        invitation_html,
        landing_page_html,
        photo_count,
        video_count,
        view_count,
        amount_paid,
        payment_status,
        ready_at,
        went_live_at,
        created_at
      FROM events
      WHERE id = $1 AND photographer_id = $2`,
      [eventId, currentUser.userId]
    );

    if (eventResult.rows.length === 0) {
      // Return 404 whether nonexistent or owned by another photographer to prevent ID enumeration
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    const rawEvent = eventResult.rows[0];

    // 3. Decrypt client contact details using authoritative crypto utility (PRD Pages 7, 23-24)
    let decryptedEmail: string | null = null;
    if (rawEvent.client_email) {
      try {
        decryptedEmail = decryptData(rawEvent.client_email);
      } catch (err) {
        logger.warn('Failed to decrypt client_email, treating as legacy or plaintext', {
          event_id: eventId,
        });
        decryptedEmail = rawEvent.client_email;
      }
    }

    let decryptedPhone: string | null = null;
    if (rawEvent.client_phone) {
      try {
        decryptedPhone = decryptData(rawEvent.client_phone);
      } catch (err) {
        logger.warn('Failed to decrypt client_phone, treating as legacy or plaintext', {
          event_id: eventId,
        });
        decryptedPhone = rawEvent.client_phone;
      }
    }

    // 4. Fetch associated photos for this event
    const photosResult = await query<PhotoRecord>(
      `SELECT
        id,
        event_id,
        uploaded_by,
        cloudinary_id,
        cloudinary_url,
        cloudinary_thumb_url,
        file_type,
        created_at
      FROM photos
      WHERE event_id = $1
      ORDER BY created_at ASC`,
      [eventId]
    );

    // 5. Build structured response per PRD Page 15
    const eventData: SingleEventResponseData = {
      id: rawEvent.id,
      event_name: rawEvent.event_name,
      couple_names: rawEvent.couple_names,
      event_date: rawEvent.event_date,
      theme: rawEvent.theme,
      location: rawEvent.location,
      client_email: decryptedEmail,
      client_phone: decryptedPhone,
      status: rawEvent.status,
      plan: rawEvent.plan,
      invitation_html: rawEvent.invitation_html || null,
      landing_page_html: rawEvent.landing_page_html || null,
      unique_slug: rawEvent.unique_slug,
      description: rawEvent.description || null,
      photo_count: rawEvent.photo_count ?? 0,
      video_count: rawEvent.video_count ?? 0,
      view_count: rawEvent.view_count ?? 0,
      amount_paid: rawEvent.amount_paid ? Number(rawEvent.amount_paid) : null,
      payment_status: rawEvent.payment_status,
      ready_at: rawEvent.ready_at || null,
      went_live_at: rawEvent.went_live_at || null,
      created_at: rawEvent.created_at,
      photos: photosResult.rows,
    };

    res.status(200).json({
      success: true,
      event: eventData,
    });
  } catch (error) {
    next(error);
  }
}
