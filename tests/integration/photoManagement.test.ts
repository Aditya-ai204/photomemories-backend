import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import * as db from '../../src/database';
import * as cloudinaryService from '../../src/services/cloudinaryService';
import { signAccessToken } from '../../src/utils/jwt';
import { ACCESS_TOKEN_COOKIE_NAME } from '../../src/utils/cookies';

// Mock database module
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../../src/database', () => ({
  query: vi.fn(),
  pool: {
    connect: vi.fn(() => mockClient),
    query: vi.fn(),
    on: vi.fn(),
    end: vi.fn(),
  },
}));

// Mock cloudinaryService module
vi.mock('../../src/services/cloudinaryService', () => ({
  uploadBufferToCloudinary: vi.fn(),
  deleteFromCloudinary: vi.fn().mockResolvedValue(undefined),
  cloudinary: {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn(),
      destroy: vi.fn(),
    },
    url: vi.fn(),
  },
}));

describe('Photographer Photo Management Integration (PRD Pages 16-17)', () => {
  const queryMock = vi.mocked(db.query);
  const poolConnectMock = vi.mocked(db.pool.connect);
  const deleteCloudinaryMock = vi.mocked(cloudinaryService.deleteFromCloudinary);

  const photographerToken = signAccessToken({
    userId: 10,
    email: 'rohan.photographer@example.com',
    role: 'photographer',
  });

  const otherPhotographerToken = signAccessToken({
    userId: 99,
    email: 'other.photographer@example.com',
    role: 'photographer',
  });

  const adminToken = signAccessToken({
    userId: 1,
    email: 'krish.admin@photomemories.ai',
    role: 'admin',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    poolConnectMock.mockReturnValue(mockClient as any);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as any);
  });

  // ======================================================================
  // 1. GET /api/events/:eventId/photos (PRD Pages 16-17)
  // ======================================================================
  describe('GET /api/events/:eventId/photos', () => {
    it('rejects with 401 UNAUTHORIZED when no auth token provided', async () => {
      const response = await request(app).get('/api/events/42/photos');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects with 403 FORBIDDEN when user has admin role', async () => {
      const response = await request(app)
        .get('/api/events/42/photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('rejects with 400 INVALID_EVENT_ID when eventId is non-numeric', async () => {
      const response = await request(app)
        .get('/api/events/abc/photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_ID');
    });

    it('rejects with 400 INVALID_EVENT_ID when eventId is non-positive', async () => {
      const response = await request(app)
        .get('/api/events/-5/photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_ID');
    });

    it('returns 404 EVENT_NOT_FOUND when event does not exist in database', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const response = await request(app)
        .get('/api/events/999/photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('EVENT_NOT_FOUND');
    });

    it('returns 403 FORBIDDEN when event belongs to a different photographer (IDOR defense)', async () => {
      // Event belongs to photographer 10, but requester is other photographer (userId: 99)
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 42, photographer_id: 10 }],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .get('/api/events/42/photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${otherPhotographerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('returns 200 with empty photos array when event has no uploaded media', async () => {
      // Event lookup
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 42, photographer_id: 10 }],
        rowCount: 1,
      } as any);

      // Photos lookup
      queryMock.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .get('/api/events/42/photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.photos).toEqual([]);
    });

    it('returns 200 with photo records ordered by upload_date DESC', async () => {
      const mockPhotos = [
        {
          id: 102,
          event_id: 42,
          uploaded_by: 10,
          cloudinary_id: 'photomemories/events/42/photos/img_102',
          cloudinary_url: 'https://res.cloudinary.com/test/image/upload/v1/img_102.jpg',
          cloudinary_thumb_url: 'https://res.cloudinary.com/test/image/upload/w_300,h_300/img_102.jpg',
          file_type: 'photo',
          upload_date: '2026-09-26T12:00:00.000Z',
          created_at: '2026-09-26T12:00:00.000Z',
        },
        {
          id: 101,
          event_id: 42,
          uploaded_by: 10,
          cloudinary_id: 'photomemories/events/42/videos/vid_101',
          cloudinary_url: 'https://res.cloudinary.com/test/video/upload/v1/vid_101.mp4',
          cloudinary_thumb_url: 'https://res.cloudinary.com/test/video/upload/w_300,h_300/vid_101.jpg',
          file_type: 'video',
          upload_date: '2026-09-26T11:00:00.000Z',
          created_at: '2026-09-26T11:00:00.000Z',
        },
      ];

      // Event lookup
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 42, photographer_id: 10 }],
        rowCount: 1,
      } as any);

      // Photos lookup
      queryMock.mockResolvedValueOnce({
        rows: mockPhotos,
        rowCount: 2,
      } as any);

      const response = await request(app)
        .get('/api/events/42/photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.photos).toHaveLength(2);
      expect(response.body.photos[0].id).toBe(102);
      expect(response.body.photos[0].file_type).toBe('photo');
      expect(response.body.photos[1].id).toBe(101);
      expect(response.body.photos[1].file_type).toBe('video');
    });
  });

  // ======================================================================
  // 2. DELETE /api/photos/:photoId (PRD Page 17)
  // ======================================================================
  describe('DELETE /api/photos/:photoId', () => {
    it('rejects with 401 UNAUTHORIZED when no auth token provided', async () => {
      const response = await request(app).delete('/api/photos/101');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects with 403 FORBIDDEN when user has admin role', async () => {
      const response = await request(app)
        .delete('/api/photos/101')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('rejects with 400 INVALID_PHOTO_ID when photoId is non-numeric', async () => {
      const response = await request(app)
        .delete('/api/photos/abc')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_PHOTO_ID');
    });

    it('rejects with 400 INVALID_PHOTO_ID when photoId is non-positive', async () => {
      const response = await request(app)
        .delete('/api/photos/0')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_PHOTO_ID');
    });

    it('returns 404 PHOTO_NOT_FOUND when photo does not exist in database', async () => {
      queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const response = await request(app)
        .delete('/api/photos/999')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('PHOTO_NOT_FOUND');
    });

    it('returns 403 FORBIDDEN when photo belongs to an event owned by another photographer (IDOR defense)', async () => {
      // Photo belongs to event owned by photographer 10, but caller is other photographer (userId: 99)
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 101,
            event_id: 42,
            cloudinary_id: 'photomemories/events/42/photos/img_101',
            file_type: 'photo',
            photographer_id: 10,
          },
        ],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .delete('/api/photos/101')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${otherPhotographerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(deleteCloudinaryMock).not.toHaveBeenCalled();
    });

    it('successfully deletes a photo, calls Cloudinary with resource_type=image, and decrements photo_count', async () => {
      const mockPhoto = {
        id: 101,
        event_id: 42,
        cloudinary_id: 'photomemories/events/42/photos/img_101',
        file_type: 'photo',
        photographer_id: 10,
      };

      queryMock.mockResolvedValueOnce({
        rows: [mockPhoto],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .delete('/api/photos/101')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Photo deleted successfully');

      // Verify Cloudinary deletion was called with resource_type 'image'
      expect(deleteCloudinaryMock).toHaveBeenCalledWith(
        'photomemories/events/42/photos/img_101',
        'image'
      );

      // Verify DB transaction executed BEGIN, DELETE, UPDATE, COMMIT
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        'DELETE FROM photos WHERE id = $1',
        [101]
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE events'),
        [1, 0, 42] // decrement photo_count by 1, video_count by 0
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('successfully deletes a video, calls Cloudinary with resource_type=video, and decrements video_count', async () => {
      const mockVideo = {
        id: 102,
        event_id: 42,
        cloudinary_id: 'photomemories/events/42/videos/vid_102',
        file_type: 'video',
        photographer_id: 10,
      };

      queryMock.mockResolvedValueOnce({
        rows: [mockVideo],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .delete('/api/photos/102')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Photo deleted successfully');

      // Verify Cloudinary deletion was called with resource_type 'video'
      expect(deleteCloudinaryMock).toHaveBeenCalledWith(
        'photomemories/events/42/videos/vid_102',
        'video'
      );

      // Verify DB transaction decrements video_count by 1, photo_count by 0
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE events'),
        [0, 1, 42]
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('rolls back and returns 500 when database transaction fails during deletion', async () => {
      const mockPhoto = {
        id: 101,
        event_id: 42,
        cloudinary_id: 'photomemories/events/42/photos/img_101',
        file_type: 'photo',
        photographer_id: 10,
      };

      queryMock.mockResolvedValueOnce({
        rows: [mockPhoto],
        rowCount: 1,
      } as any);

      // Make DB query throw inside the transaction
      mockClient.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('DELETE FROM photos')) {
          throw new Error('Database deadlocked or connection dropped');
        }
        return { rows: [], rowCount: 0 };
      });

      const response = await request(app)
        .delete('/api/photos/101')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('DATABASE_ERROR');

      // Verify ROLLBACK was called
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('works via sub-resource route DELETE /api/events/:eventId/photos/:photoId and validates eventId match', async () => {
      const mockPhoto = {
        id: 101,
        event_id: 42,
        cloudinary_id: 'photomemories/events/42/photos/img_101',
        file_type: 'photo',
        photographer_id: 10,
      };

      // Mismatch case: photo belongs to event 42, but route has eventId 99
      queryMock.mockResolvedValueOnce({
        rows: [mockPhoto],
        rowCount: 1,
      } as any);

      const mismatchResponse = await request(app)
        .delete('/api/events/99/photos/101')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(mismatchResponse.status).toBe(400);
      expect(mismatchResponse.body.code).toBe('EVENT_MISMATCH');

      // Match case: photo belongs to event 42, route has eventId 42
      queryMock.mockResolvedValueOnce({
        rows: [mockPhoto],
        rowCount: 1,
      } as any);

      const matchResponse = await request(app)
        .delete('/api/events/42/photos/101')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(matchResponse.status).toBe(200);
      expect(matchResponse.body.success).toBe(true);
    });
  });
});
