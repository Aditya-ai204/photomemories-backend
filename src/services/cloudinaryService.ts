import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Cloudinary Service for Photo and Video Storage
 * Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 5, 9, 15-16, 28-29)
 * 
 * Configured using validated environment variables:
 * - CLOUDINARY_CLOUD_NAME
 * - CLOUDINARY_API_KEY
 * - CLOUDINARY_API_SECRET
 */

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface CloudinaryUploadOptions {
  folder: string;
  resource_type: 'image' | 'video';
  public_id?: string;
}

export interface CloudinaryUploadResult {
  cloudinary_id: string;
  cloudinary_url: string;
  cloudinary_thumb_url: string;
  file_type: 'photo' | 'video';
}

/**
 * Uploads a buffer directly to Cloudinary using upload_stream.
 * Avoids saving files to server disk.
 */
export async function uploadBufferToCloudinary(
  buffer: Buffer,
  options: CloudinaryUploadOptions
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        resource_type: options.resource_type,
        public_id: options.public_id,
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary stream upload failed', {
            folder: options.folder,
            resource_type: options.resource_type,
            error: error?.message || 'Empty result from Cloudinary',
          });
          return reject(error || new Error('Cloudinary upload returned empty result'));
        }

        const file_type: 'photo' | 'video' = options.resource_type === 'video' ? 'video' : 'photo';

        // Generate thumbnail URL
        let thumbUrl = result.secure_url;
        try {
          if (file_type === 'photo') {
            thumbUrl = cloudinary.url(result.public_id, {
              transformation: [
                { width: 300, height: 300, crop: 'fill', quality: 'auto' },
              ],
              secure: true,
            });
          } else {
            thumbUrl = cloudinary.url(result.public_id, {
              resource_type: 'video',
              format: 'jpg',
              transformation: [
                { width: 300, height: 300, crop: 'fill', quality: 'auto' },
              ],
              secure: true,
            });
          }
        } catch (thumbError) {
          logger.warn('Failed to generate thumbnail URL, falling back to secure_url', {
            public_id: result.public_id,
            error: thumbError instanceof Error ? thumbError.message : thumbError,
          });
          thumbUrl = result.secure_url;
        }

        resolve({
          cloudinary_id: result.public_id,
          cloudinary_url: result.secure_url,
          cloudinary_thumb_url: thumbUrl,
          file_type,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Deletes an uploaded asset from Cloudinary (used for rollback and photo deletion).
 */
export async function deleteFromCloudinary(
  publicId: string,
  resourceType: 'image' | 'video' = 'image'
): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    logger.info(`Deleted asset from Cloudinary: ${publicId} (${resourceType})`);
  } catch (error) {
    logger.error(`Failed to delete asset from Cloudinary: ${publicId}`, {
      resourceType,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export { cloudinary };
