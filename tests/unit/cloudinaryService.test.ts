import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  uploadBufferToCloudinary,
  deleteFromCloudinary,
  cloudinary,
} from '../../src/services/cloudinaryService';

describe('Cloudinary Service Unit Tests (src/services/cloudinaryService.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadBufferToCloudinary', () => {
    it('successfully uploads an image buffer and generates thumbnail URL', async () => {
      const mockResult = {
        public_id: 'sample_photo_id',
        secure_url: 'https://res.cloudinary.com/test/image/upload/sample_photo_id.jpg',
      };

      (vi.spyOn(cloudinary.uploader, 'upload_stream') as any).mockImplementation((options: any, callback: any) => {
        expect(options.folder).toBe('photomemories/events/42/photos');
        expect(options.resource_type).toBe('image');
        // invoke callback asynchronously
        setTimeout(() => callback(null, mockResult), 10);
        return {
          end: vi.fn(),
        } as any;
      });

      vi.spyOn(cloudinary, 'url').mockReturnValue(
        'https://res.cloudinary.com/test/image/upload/w_300,h_300/sample_photo_id.jpg'
      );

      const buffer = Buffer.from('test-image-data');
      const result = await uploadBufferToCloudinary(buffer, {
        folder: 'photomemories/events/42/photos',
        resource_type: 'image',
      });

      expect(result).toEqual({
        cloudinary_id: 'sample_photo_id',
        cloudinary_url: 'https://res.cloudinary.com/test/image/upload/sample_photo_id.jpg',
        cloudinary_thumb_url: 'https://res.cloudinary.com/test/image/upload/w_300,h_300/sample_photo_id.jpg',
        file_type: 'photo',
      });
    });

    it('successfully uploads a video buffer and generates video thumbnail URL', async () => {
      const mockResult = {
        public_id: 'sample_video_id',
        secure_url: 'https://res.cloudinary.com/test/video/upload/sample_video_id.mp4',
      };

      (vi.spyOn(cloudinary.uploader, 'upload_stream') as any).mockImplementation((options: any, callback: any) => {
        expect(options.folder).toBe('photomemories/events/42/videos');
        expect(options.resource_type).toBe('video');
        setTimeout(() => callback(null, mockResult), 10);
        return {
          end: vi.fn(),
        } as any;
      });

      vi.spyOn(cloudinary, 'url').mockReturnValue(
        'https://res.cloudinary.com/test/video/upload/w_300,h_300/sample_video_id.jpg'
      );

      const buffer = Buffer.from('test-video-data');
      const result = await uploadBufferToCloudinary(buffer, {
        folder: 'photomemories/events/42/videos',
        resource_type: 'video',
      });

      expect(result).toEqual({
        cloudinary_id: 'sample_video_id',
        cloudinary_url: 'https://res.cloudinary.com/test/video/upload/sample_video_id.mp4',
        cloudinary_thumb_url: 'https://res.cloudinary.com/test/video/upload/w_300,h_300/sample_video_id.jpg',
        file_type: 'video',
      });
    });

    it('rejects when upload_stream returns an error', async () => {
      (vi.spyOn(cloudinary.uploader, 'upload_stream') as any).mockImplementation((_options: any, callback: any) => {
        setTimeout(() => callback(new Error('Cloudinary stream connection reset'), null), 10);
        return {
          end: vi.fn(),
        } as any;
      });

      const buffer = Buffer.from('test-image-data');
      await expect(
        uploadBufferToCloudinary(buffer, {
          folder: 'photomemories/events/42/photos',
          resource_type: 'image',
        })
      ).rejects.toThrow('Cloudinary stream connection reset');
    });

    it('falls back to secure_url if thumbnail generation throws', async () => {
      const mockResult = {
        public_id: 'photo_no_thumb',
        secure_url: 'https://res.cloudinary.com/test/image/upload/photo_no_thumb.jpg',
      };

      (vi.spyOn(cloudinary.uploader, 'upload_stream') as any).mockImplementation((_options: any, callback: any) => {
        setTimeout(() => callback(null, mockResult), 10);
        return {
          end: vi.fn(),
        } as any;
      });

      vi.spyOn(cloudinary, 'url').mockImplementation(() => {
        throw new Error('Transformation config error');
      });

      const buffer = Buffer.from('test-image-data');
      const result = await uploadBufferToCloudinary(buffer, {
        folder: 'photomemories/events/42/photos',
        resource_type: 'image',
      });

      expect(result.cloudinary_thumb_url).toBe(mockResult.secure_url);
    });
  });

  describe('deleteFromCloudinary', () => {
    it('calls cloudinary.uploader.destroy with resource_type and logs success', async () => {
      const destroySpy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

      await deleteFromCloudinary('photo_to_delete', 'image');

      expect(destroySpy).toHaveBeenCalledWith('photo_to_delete', { resource_type: 'image' });
    });

    it('handles destroy errors gracefully without crashing', async () => {
      vi.spyOn(cloudinary.uploader, 'destroy').mockRejectedValue(new Error('API error'));

      // Should not throw
      await expect(deleteFromCloudinary('failing_id', 'video')).resolves.toBeUndefined();
    });
  });
});
