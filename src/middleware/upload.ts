import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types';

/**
 * Upload Middleware & Engineering Safeguards
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 15-16)
 * 
 * PRD Mandate:
 * - Request format: multipart/form-data { photos: [File...], videos: [File...] }
 * - Validate files (size, type)
 * 
 * Production Engineering Safeguards (Configurable defaults):
 * - Memory Storage: Files are buffered in memory and streamed directly to Cloudinary (zero untrusted disk persistence)
 * - Max Photo Size: 25 MB per photo
 * - Max Video Size: 100 MB per video
 * - Max Photos Per Batch: 50
 * - Max Videos Per Batch: 10
 */

export const MAX_PHOTO_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_PHOTOS_PER_BATCH = 50;
export const MAX_VIDEOS_PER_BATCH = 10;

export const ALLOWED_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const ALLOWED_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime', // .mov
  'video/webm',
  'video/x-matroska',
]);

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  const mime = (file.mimetype || '').toLowerCase();

  if (file.fieldname === 'photos') {
    if (ALLOWED_PHOTO_MIME_TYPES.has(mime)) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          `Invalid file format for photo: "${file.originalname}" (${file.mimetype}). Allowed types: JPG, PNG, WEBP, HEIC.`,
          400,
          'INVALID_FILE_TYPE'
        )
      );
    }
  } else if (file.fieldname === 'videos') {
    if (ALLOWED_VIDEO_MIME_TYPES.has(mime)) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          `Invalid file format for video: "${file.originalname}" (${file.mimetype}). Allowed types: MP4, MOV, WEBM.`,
          400,
          'INVALID_FILE_TYPE'
        )
      );
    }
  } else {
    cb(
      new AppError(
        `Unexpected form field: "${file.fieldname}". Upload photos under 'photos' and videos under 'videos'.`,
        400,
        'UNEXPECTED_FIELD'
      )
    );
  }
}

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(MAX_PHOTO_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES),
    files: MAX_PHOTOS_PER_BATCH + MAX_VIDEOS_PER_BATCH,
  },
  fileFilter,
}).fields([
  { name: 'photos', maxCount: MAX_PHOTOS_PER_BATCH },
  { name: 'videos', maxCount: MAX_VIDEOS_PER_BATCH },
]);

/**
 * Middleware handling multipart/form-data for event photo & video uploads.
 */
export function uploadPhotosAndVideosMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  multerUpload(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(
              'File size limit exceeded. Maximum size is 25MB for photos and 100MB for videos.',
              400,
              'FILE_TOO_LARGE'
            )
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(
            new AppError(
              `Unexpected form field "${err.field || 'unknown'}". Upload photos under 'photos' and videos under 'videos'.`,
              400,
              'UNEXPECTED_FIELD'
            )
          );
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return next(
            new AppError(`Upload limit exceeded: ${err.message}`, 400, 'FILE_COUNT_EXCEEDED')
          );
        }
        return next(new AppError(`File upload error: ${err.message}`, 400, 'FILE_UPLOAD_ERROR'));
      }
      return next(err);
    }
    next();
  });
}
