import { Request, Response, NextFunction } from 'express';
import { query } from '../database';
import { AppError } from '../types';
import { logger } from '../utils/logger';
import {
  formatFullDomain,
  sanitizeSubdomain,
  isValidSubdomainFormat,
} from '../services/subdomainService';

/**
 * Public Event & Photographer Controller
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 19-20, 25, 26)
 */

export interface PublicEventDTO {
  event_name: string;
  couple_names: string | null;
  event_date: string;
  theme: string;
  location: string | null;
  description: string | null;
  subdomain: string;
  unique_slug: string;
  invitation_html: string | null;
  landing_page_html: string | null;
}

export interface PublicPhotographerDTO {
  name: string;
  company: string | null;
  subdomain: string;
  full_domain: string;
}

interface EventLookupRow {
  id: number;
  event_name: string;
  couple_names: string | null;
  event_date: Date | string;
  theme: string;
  location: string | null;
  description: string | null;
  status: string;
  unique_slug: string;
  invitation_html: string | null;
  landing_page_html: string | null;
  photographer_subdomain: string | null;
}

interface PhotographerLookupRow {
  id: number;
  name: string;
  company_name: string | null;
  subdomain: string;
  user_active: boolean;
  subdomain_active: boolean | null;
}

/**
 * GET /api/public/event/:slug
 * Auth: Not required (Public)
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 19-20, 25)
 * 
 * - Resolves event by unique_slug
 * - Enforces event visibility: 'pending' (draft) and 'archived' events return 404
 * - Strictly redacts client contact information, payment details, and admin notes
 * - Returns public event presentation metadata, photographer subdomain FQDN, and HTML pages
 */
export async function getPublicEventBySlug(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const slugParam = req.params['slug'];
    if (!slugParam || typeof slugParam !== 'string' || slugParam.trim().length === 0) {
      throw new AppError('Event slug is required.', 400, 'INVALID_SLUG');
    }

    const slug = slugParam.trim().toLowerCase();

    // Query event with photographer subdomain
    // Note: client_email, client_phone, amount_paid, admin_notes are strictly excluded
    const result = await query<EventLookupRow>(
      `SELECT
        e.id,
        e.event_name,
        e.couple_names,
        e.event_date,
        e.theme,
        e.location,
        e.description,
        e.status,
        e.unique_slug,
        e.invitation_html,
        e.landing_page_html,
        u.subdomain AS photographer_subdomain
      FROM events e
      JOIN users u ON e.photographer_id = u.id
      WHERE LOWER(e.unique_slug) = LOWER($1)`,
      [slug]
    );

    const event = result.rows[0];

    // Must exist and must be in public state ('ready_for_upload' or 'live')
    // Pending (draft request) and archived events are not public
    if (!event || event.status === 'pending' || event.status === 'archived') {
      throw new AppError(`Event "${slug}" not found.`, 404, 'EVENT_NOT_FOUND');
    }

    const formattedDate =
      event.event_date instanceof Date
        ? event.event_date.toISOString().split('T')[0]
        : String(event.event_date).split('T')[0];

    const fullDomain = formatFullDomain(event.photographer_subdomain || 'photographer');

    const publicEvent: PublicEventDTO = {
      event_name: event.event_name,
      couple_names: event.couple_names || null,
      event_date: formattedDate,
      theme: event.theme,
      location: event.location || null,
      description: event.description || null,
      subdomain: fullDomain,
      unique_slug: event.unique_slug,
      invitation_html: event.invitation_html || null,
      landing_page_html: event.landing_page_html || null,
    };

    logger.info(`Public event retrieved for slug: ${event.unique_slug}`, {
      slug: event.unique_slug,
      status: event.status,
    });

    res.status(200).json({
      success: true,
      event: publicEvent,
      invitation_html: event.invitation_html || null,
      landing_page_html: event.landing_page_html || null,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/public/photographer/:subdomain
 * Auth: Not required (Public)
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Page 26)
 * 
 * - Resolves photographer branding information by public subdomain
 * - Case-insensitive lookup against users and subdomains tables
 * - Validates active status
 * - Returns only public branding DTO (name, company, subdomain, full_domain)
 */
export async function getPublicPhotographerBySubdomain(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const subdomainParam = req.params['subdomain'];
    if (!subdomainParam || typeof subdomainParam !== 'string' || subdomainParam.trim().length === 0) {
      throw new AppError('Subdomain parameter is required.', 400, 'INVALID_SUBDOMAIN');
    }

    const rawSubdomain = subdomainParam.trim().toLowerCase();
    const sanitized = sanitizeSubdomain(rawSubdomain);

    if (!isValidSubdomainFormat(sanitized)) {
      throw new AppError(
        `Invalid subdomain format: "${subdomainParam}".`,
        400,
        'INVALID_SUBDOMAIN'
      );
    }

    // Lookup photographer and verify active status
    const result = await query<PhotographerLookupRow>(
      `SELECT
        u.id,
        u.name,
        u.company_name,
        u.subdomain,
        u.is_active AS user_active,
        s.is_active AS subdomain_active
      FROM users u
      LEFT JOIN subdomains s ON u.id = s.photographer_id AND LOWER(s.subdomain_name) = LOWER(u.subdomain)
      WHERE LOWER(u.subdomain) = LOWER($1)
        AND u.role = 'photographer'`,
      [sanitized]
    );

    const photographer = result.rows[0];

    // Must exist, user must be active, and if a subdomain record exists it must not be inactive
    if (!photographer || !photographer.user_active || photographer.subdomain_active === false) {
      throw new AppError(
        `Photographer with subdomain "${sanitized}" not found.`,
        404,
        'PHOTOGRAPHER_NOT_FOUND'
      );
    }

    const fullDomain = formatFullDomain(photographer.subdomain);

    const publicPhotographer: PublicPhotographerDTO = {
      name: photographer.name,
      company: photographer.company_name || null,
      subdomain: photographer.subdomain,
      full_domain: fullDomain,
    };

    logger.info(`Public photographer branding retrieved for subdomain: ${photographer.subdomain}`);

    res.status(200).json({
      success: true,
      photographer: publicPhotographer,
    });
  } catch (error) {
    next(error);
  }
}
