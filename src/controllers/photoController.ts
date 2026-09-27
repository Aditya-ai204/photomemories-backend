import { Request, Response, NextFunction } from 'express';
import { pool, query } from '../database';
import { AppError } from '../types';
import { logger } from '../utils/logger';
import {
  uploadBufferToCloudinary,
  deleteFromCloudinary,
  CloudinaryUploadResult,
} from '../services/cloudinaryService';
import {
  MAX_PHOTO_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
} from '../middleware/upload';
import { formatFullDomain } from '../services/subdomainService';

/**
 * Controller for Photo and Video Uploads
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 9, 15-16)
 */

interface EventLookupRow {
  id: number;
  photographer_id: number;
  status: string;
  photo_count: number;
  video_count: number;
  unique_slug: string;
  photographer_subdomain: string | null;
}

/**
 * POST /api/events/:eventId/upload-photos
 * Auth: Required (Photographer)
 * Multipart form data: { photos: [File...], videos: [File...] }
 * 
 * - Verifies authenticated photographer owns the event
 * - Verifies event status is "ready_for_upload" or "live"
 * - Validates file types and sizes
 * - Uploads files directly to Cloudinary
 * - Persists records in `photos` table
 * - Increments `events.photo_count` and `events.video_count` atomically
 * - Transitions event status to "live" and sets `went_live_at` upon first upload
 * - In case of DB failure, performs rollback cleanup of Cloudinary assets
 * - Returns PRD-compliant 201 response:
 *   {
 *     "success": true,
 *     "uploaded_count": number,
 *     "event_status": "live",
 *     "event_url": "photographer.photomemories.ai/event/slug"
 *   }
 */
export async function uploadEventPhotos(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const uploadedAssets: CloudinaryUploadResult[] = [];

  try {
    // 1. Authenticate photographer requester
    const currentUser = req.user;
    if (!currentUser || !currentUser.userId) {
      throw new AppError('Authentication required. Missing access token.', 401, 'UNAUTHORIZED');
    }

    // 2. Validate eventId parameter
    const eventIdParam = req.params['eventId'];
    const eventId = parseInt(String(eventIdParam), 10);
    if (isNaN(eventId) || eventId <= 0) {
      throw new AppError(
        `Invalid event ID: "${eventIdParam}". Must be a positive integer.`,
        400,
        'INVALID_EVENT_ID'
      );
    }

    // 3. Extract and validate uploaded files
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const photoFiles = files?.['photos'] || [];
    const videoFiles = files?.['videos'] || [];

    if (photoFiles.length === 0 && videoFiles.length === 0) {
      throw new AppError(
        'No files provided for upload. Attach at least one file under "photos" or "videos".',
        400,
        'NO_FILES_PROVIDED'
      );
    }

    // Individual file size safeguards
    for (const file of photoFiles) {
      if (file.size > MAX_PHOTO_SIZE_BYTES) {
        throw new AppError(
          `Photo "${file.originalname}" exceeds maximum allowed size of 25MB.`,
          400,
          'FILE_TOO_LARGE'
        );
      }
    }
    for (const file of videoFiles) {
      if (file.size > MAX_VIDEO_SIZE_BYTES) {
        throw new AppError(
          `Video "${file.originalname}" exceeds maximum allowed size of 100MB.`,
          400,
          'FILE_TOO_LARGE'
        );
      }
    }

    // 4. Verify event existence, ownership, and state (PRD Pages 15-16)
    const eventResult = await query<EventLookupRow>(
      `SELECT
        e.id,
        e.photographer_id,
        e.status,
        e.photo_count,
        e.video_count,
        e.unique_slug,
        u.subdomain AS photographer_subdomain
      FROM events e
      JOIN users u ON e.photographer_id = u.id
      WHERE e.id = $1`,
      [eventId]
    );

    const event = eventResult.rows[0];
    if (!event) {
      throw new AppError(`Event #${eventId} not found.`, 404, 'EVENT_NOT_FOUND');
    }

    // Enforce ownership: only the photographer who owns the event can upload
    if (event.photographer_id !== currentUser.userId) {
      throw new AppError('You do not own this event.', 403, 'FORBIDDEN');
    }

    // Enforce state machine: event must be in 'ready_for_upload' or 'live' status
    if (event.status !== 'ready_for_upload' && event.status !== 'live') {
      throw new AppError(
        `Cannot upload photos: event #${eventId} is currently in '${event.status}' status. Event must be 'ready_for_upload' or 'live'.`,
        400,
        'INVALID_EVENT_STATE'
      );
    }

    // 5. Upload files to Cloudinary with rollback tracking
    // Folder organization: photomemories/events/{eventId}/{photos|videos} (Engineering convention)
    try {
      // Upload photos
      for (const photo of photoFiles) {
        const uploadResult = await uploadBufferToCloudinary(photo.buffer, {
          folder: `photomemories/events/${eventId}/photos`,
          resource_type: 'image',
        });
        uploadedAssets.push(uploadResult);
      }

      // Upload videos
      for (const video of videoFiles) {
        const uploadResult = await uploadBufferToCloudinary(video.buffer, {
          folder: `photomemories/events/${eventId}/videos`,
          resource_type: 'video',
        });
        uploadedAssets.push(uploadResult);
      }
    } catch (uploadError) {
      // Rollback any assets already uploaded to Cloudinary before this failure
      if (uploadedAssets.length > 0) {
        await Promise.allSettled(
          uploadedAssets.map((asset) =>
            deleteFromCloudinary(
              asset.cloudinary_id,
              asset.file_type === 'video' ? 'video' : 'image'
            )
          )
        );
      }
      logger.error('Failed to upload all files to Cloudinary', {
        eventId,
        error: uploadError instanceof Error ? uploadError.message : uploadError,
      });
      throw new AppError('Failed to upload files to Cloudinary.', 502, 'CLOUDINARY_UPLOAD_ERROR');
    }

    // 6. Persist uploaded assets to PostgreSQL in an atomic transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert each photo/video into photos table
      for (const asset of uploadedAssets) {
        await client.query(
          `INSERT INTO photos (
            event_id,
            uploaded_by,
            cloudinary_id,
            cloudinary_url,
            cloudinary_thumb_url,
            file_type
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            eventId,
            currentUser.userId,
            asset.cloudinary_id,
            asset.cloudinary_url,
            asset.cloudinary_thumb_url,
            asset.file_type,
          ]
        );
      }

      // Count new items
      const newPhotoCount = photoFiles.length;
      const newVideoCount = videoFiles.length;

      // Update counters and transition status:
      // If event was 'ready_for_upload', transition to 'live' and set went_live_at (PRD Page 16)
      await client.query(
        `UPDATE events
        SET
          photo_count = photo_count + $1,
          video_count = video_count + $2,
          status = 'live',
          went_live_at = COALESCE(went_live_at, CURRENT_TIMESTAMP)
        WHERE id = $3`,
        [newPhotoCount, newVideoCount, eventId]
      );

      await client.query('COMMIT');
    } catch (dbError) {
      await client.query('ROLLBACK');

      // Rollback uploaded Cloudinary assets to prevent orphaned media
      await Promise.allSettled(
        uploadedAssets.map((asset) =>
          deleteFromCloudinary(
            asset.cloudinary_id,
            asset.file_type === 'video' ? 'video' : 'image'
          )
        )
      );

      logger.error('Database transaction failed during photo persistence, rolled back Cloudinary assets', {
        eventId,
        error: dbError instanceof Error ? dbError.message : dbError,
      });
      throw new AppError('Failed to record uploaded photos in database.', 500, 'DATABASE_ERROR');
    } finally {
      client.release();
    }

    // 7. Format event URL per PRD Page 16:
    // "photographer1.photomemories.ai/event/aarav-priya-2024"
    const subdomain = event.photographer_subdomain || `photographer-${event.photographer_id}`;
    const fullDomain = formatFullDomain(subdomain);
    const eventUrl = `${fullDomain}/event/${event.unique_slug}`;

    logger.info(`Successfully uploaded ${uploadedAssets.length} assets to event #${eventId}`, {
      eventId,
      photographerId: currentUser.userId,
      photosUploaded: photoFiles.length,
      videosUploaded: videoFiles.length,
      eventStatus: 'live',
      eventUrl,
    });

    // 8. Return PRD-compliant 201 response (PRD Page 16)
    res.status(201).json({
      success: true,
      uploaded_count: uploadedAssets.length,
      event_status: 'live',
      event_url: eventUrl,
    });
  } catch (error) {
    next(error);
  }
}

export interface PhotoMetadataRow {
  id: number;
  event_id: number;
  uploaded_by: number | null;
  cloudinary_id: string;
  cloudinary_url: string;
  cloudinary_thumb_url: string | null;
  file_type: 'photo' | 'video';
  upload_date: string;
  created_at: string;
}

interface PhotoDeleteLookupRow {
  id: number;
  event_id: number;
  cloudinary_id: string;
  file_type: 'photo' | 'video';
  photographer_id: number;
}

/**
 * GET /api/events/:eventId/photos
 * Auth: Required (Photographer)
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 16-17)
 * 
 * - Verifies authenticated photographer owns the event (IDOR defense)
 * - Fetches all photos and videos belonging to the event
 * - Returns photo metadata in descending order of upload/creation
 */
export async function getEventPhotos(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const currentUser = req.user;
    if (!currentUser || !currentUser.userId) {
      throw new AppError('Authentication required. Missing access token.', 401, 'UNAUTHORIZED');
    }

    const eventIdParam = req.params['eventId'];
    const eventId = parseInt(String(eventIdParam), 10);
    if (isNaN(eventId) || eventId <= 0) {
      throw new AppError(
        `Invalid event ID: "${eventIdParam}". Must be a positive integer.`,
        400,
        'INVALID_EVENT_ID'
      );
    }

    // Verify event existence and ownership
    const eventResult = await query<{ id: number; photographer_id: number }>(
      'SELECT id, photographer_id FROM events WHERE id = $1',
      [eventId]
    );

    const event = eventResult.rows[0];
    if (!event) {
      throw new AppError(`Event #${eventId} not found.`, 404, 'EVENT_NOT_FOUND');
    }

    if (event.photographer_id !== currentUser.userId) {
      throw new AppError('You do not own this event.', 403, 'FORBIDDEN');
    }

    // Fetch photos ordered by upload_date DESC, id DESC
    const photosResult = await query<PhotoMetadataRow>(
      `SELECT
        id,
        event_id,
        uploaded_by,
        cloudinary_id,
        cloudinary_url,
        cloudinary_thumb_url,
        file_type,
        upload_date,
        created_at
      FROM photos
      WHERE event_id = $1
      ORDER BY upload_date DESC, id DESC`,
      [eventId]
    );

    logger.info(`Retrieved ${photosResult.rows.length} photos for event #${eventId}`, {
      eventId,
      photographerId: currentUser.userId,
      count: photosResult.rows.length,
    });

    res.status(200).json({
      success: true,
      photos: photosResult.rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/photos/:photoId
 * Auth: Required (Photographer)
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Page 17)
 * 
 * - Verifies authenticated photographer owns the event the photo belongs to (IDOR defense)
 * - Deletes the asset from Cloudinary
 * - Atomically deletes photo record from database and decrements event photo_count/video_count
 */
export async function deletePhoto(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const currentUser = req.user;
    if (!currentUser || !currentUser.userId) {
      throw new AppError('Authentication required. Missing access token.', 401, 'UNAUTHORIZED');
    }

    const photoIdParam = req.params['photoId'];
    const photoId = parseInt(String(photoIdParam), 10);
    if (isNaN(photoId) || photoId <= 0) {
      throw new AppError(
        `Invalid photo ID: "${photoIdParam}". Must be a positive integer.`,
        400,
        'INVALID_PHOTO_ID'
      );
    }

    // Look up photo joined with events to verify existence and event ownership
    const photoResult = await query<PhotoDeleteLookupRow>(
      `SELECT
        p.id,
        p.event_id,
        p.cloudinary_id,
        p.file_type,
        e.photographer_id
      FROM photos p
      JOIN events e ON p.event_id = e.id
      WHERE p.id = $1`,
      [photoId]
    );

    const photo = photoResult.rows[0];
    if (!photo) {
      throw new AppError(`Photo #${photoId} not found.`, 404, 'PHOTO_NOT_FOUND');
    }

    if (photo.photographer_id !== currentUser.userId) {
      throw new AppError('You do not own this photo.', 403, 'FORBIDDEN');
    }

    // If eventId param was also provided in route (e.g. /events/:eventId/photos/:photoId), ensure consistency
    if (req.params['eventId']) {
      const routeEventId = parseInt(String(req.params['eventId']), 10);
      if (!isNaN(routeEventId) && photo.event_id !== routeEventId) {
        throw new AppError('Photo does not belong to the specified event.', 400, 'EVENT_MISMATCH');
      }
    }

    // 1. Delete asset from Cloudinary
    await deleteFromCloudinary(
      photo.cloudinary_id,
      photo.file_type === 'video' ? 'video' : 'image'
    );

    // 2. Atomically delete photo from DB and decrement event counter
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query('DELETE FROM photos WHERE id = $1', [photoId]);

      const isVideo = photo.file_type === 'video';
      await client.query(
        `UPDATE events
        SET
          photo_count = GREATEST(0, photo_count - $1),
          video_count = GREATEST(0, video_count - $2)
        WHERE id = $3`,
        [isVideo ? 0 : 1, isVideo ? 1 : 0, photo.event_id]
      );

      await client.query('COMMIT');
    } catch (dbError) {
      await client.query('ROLLBACK');
      logger.error('Database transaction failed during photo deletion', {
        photoId,
        eventId: photo.event_id,
        error: dbError instanceof Error ? dbError.message : dbError,
      });
      throw new AppError('Failed to delete photo from database.', 500, 'DATABASE_ERROR');
    } finally {
      client.release();
    }

    logger.info(`Photo #${photoId} deleted successfully by photographer #${currentUser.userId}`, {
      photoId,
      eventId: photo.event_id,
      photographerId: currentUser.userId,
      fileType: photo.file_type,
    });

    res.status(200).json({
      success: true,
      message: 'Photo deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

