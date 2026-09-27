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
  deleteFromCloudinary: vi.fn(),
  cloudinary: {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn(),
      destroy: vi.fn(),
    },
    url: vi.fn(),
  },
}));

describe('Photographer Photo Upload Integration (POST /api/events/:eventId/upload-photos)', () => {
  const queryMock = vi.mocked(db.query);
  const poolConnectMock = vi.mocked(db.pool.connect);
  const uploadMock = vi.mocked(cloudinaryService.uploadBufferToCloudinary);
  const deleteMock = vi.mocked(cloudinaryService.deleteFromCloudinary);

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

  const mockEventRowReady = {
    id: 42,
    photographer_id: 10,
    status: 'ready_for_upload',
    photo_count: 0,
    video_count: 0,
    unique_slug: 'aarav-priya-2024',
    photographer_subdomain: 'rohan-photography',
  };

  const mockEventRowLive = {
    id: 42,
    photographer_id: 10,
    status: 'live',
    photo_count: 10,
    video_count: 2,
    unique_slug: 'aarav-priya-2024',
    photographer_subdomain: 'rohan-photography',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    poolConnectMock.mockReturnValue(mockClient as any);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as any);
  });

  // ======================================================================
  // 1. RBAC & Authentication Checks (PRD Pages 15-16, 24, 30)
  // ======================================================================
  describe('RBAC & Authentication Checks', () => {
    it('rejects with 401 UNAUTHORIZED when no token is provided', async () => {
      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .attach('photos', Buffer.from('fake-image-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects with 403 FORBIDDEN when user has admin role instead of photographer', async () => {
      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${adminToken}`)
        .attach('photos', Buffer.from('fake-image-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  // ======================================================================
  // 2. Validation & Bad Request Handling (PRD Pages 15-16)
  // ======================================================================
  describe('Validation & Bad Request Handling', () => {
    it('rejects with 400 INVALID_EVENT_ID when eventId is not a number', async () => {
      const response = await request(app)
        .post('/api/events/invalid/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('fake-image-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_ID');
    });

    it('rejects with 400 INVALID_EVENT_ID when eventId is zero or negative', async () => {
      const response = await request(app)
        .post('/api/events/0/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('fake-image-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_ID');
    });

    it('rejects with 400 NO_FILES_PROVIDED when request has no files attached', async () => {
      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('NO_FILES_PROVIDED');
    });

    it('rejects with 400 INVALID_FILE_TYPE when photo has unsupported MIME type', async () => {
      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('text-content'), {
          filename: 'document.txt',
          contentType: 'text/plain',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_FILE_TYPE');
      expect(response.body.error).toContain('text/plain');
    });

    it('rejects with 400 INVALID_FILE_TYPE when video has unsupported MIME type', async () => {
      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('videos', Buffer.from('audio-content'), {
          filename: 'song.mp3',
          contentType: 'audio/mpeg',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_FILE_TYPE');
      expect(response.body.error).toContain('audio/mpeg');
    });

    it('rejects with 400 UNEXPECTED_FIELD when file is attached under unknown field name', async () => {
      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('documents', Buffer.from('fake-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('UNEXPECTED_FIELD');
    });
  });

  // ======================================================================
  // 3. Ownership & Event State Verification (PRD Pages 15-16)
  // ======================================================================
  describe('Ownership & Event State Verification', () => {
    it('returns 404 EVENT_NOT_FOUND when event does not exist', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any);

      const response = await request(app)
        .post('/api/events/999/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('fake-image-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('EVENT_NOT_FOUND');
    });

    it('returns 403 FORBIDDEN when event belongs to another photographer (IDOR protection)', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [mockEventRowReady],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${otherPhotographerToken}`)
        .attach('photos', Buffer.from('fake-image-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('returns 400 INVALID_EVENT_STATE when event is in pending status', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ ...mockEventRowReady, status: 'pending' }],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('fake-image-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_STATE');
      expect(response.body.error).toContain('pending');
    });

    it('returns 400 INVALID_EVENT_STATE when event is in archived status', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ ...mockEventRowReady, status: 'archived' }],
        rowCount: 1,
      } as any);

      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('fake-image-content'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_EVENT_STATE');
      expect(response.body.error).toContain('archived');
    });
  });

  // ======================================================================
  // 4. Successful Uploads & State Machine Transitions (PRD Page 16)
  // ======================================================================
  describe('Successful Uploads & State Machine Transitions', () => {
    it('successfully uploads photo and video, auto-transitions ready_for_upload event to live, and returns 201', async () => {
      // 1. SELECT event returns ready_for_upload event
      queryMock.mockResolvedValueOnce({
        rows: [mockEventRowReady],
        rowCount: 1,
      } as any);

      // Cloudinary mock upload results
      uploadMock
        .mockResolvedValueOnce({
          cloudinary_id: 'cld_photo_1',
          cloudinary_url: 'https://res.cloudinary.com/cloud/image/upload/v1/photo1.jpg',
          cloudinary_thumb_url: 'https://res.cloudinary.com/cloud/image/upload/w_300,h_300/photo1.jpg',
          file_type: 'photo',
        })
        .mockResolvedValueOnce({
          cloudinary_id: 'cld_video_1',
          cloudinary_url: 'https://res.cloudinary.com/cloud/video/upload/v1/video1.mp4',
          cloudinary_thumb_url: 'https://res.cloudinary.com/cloud/video/upload/w_300,h_300/video1.jpg',
          file_type: 'video',
        });

      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('image-binary-data'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        })
        .attach('videos', Buffer.from('video-binary-data'), {
          filename: 'highlight.mp4',
          contentType: 'video/mp4',
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        uploaded_count: 2,
        event_status: 'live',
        event_url: 'rohan-photography.photomemories.ai/event/aarav-priya-2024',
      });

      // Verify Cloudinary was called twice with correct folders
      expect(uploadMock).toHaveBeenCalledTimes(2);
      expect(uploadMock.mock.calls[0]![1]).toEqual({
        folder: 'photomemories/events/42/photos',
        resource_type: 'image',
      });
      expect(uploadMock.mock.calls[1]![1]).toEqual({
        folder: 'photomemories/events/42/videos',
        resource_type: 'video',
      });

      // Verify DB transaction
      expect(poolConnectMock).toHaveBeenCalledTimes(1);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalledTimes(1);

      // Verify photo inserts
      const insertCalls = mockClient.query.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO photos')
      );
      expect(insertCalls.length).toBe(2);

      // Verify event counter and status update
      const updateCall = mockClient.query.mock.calls.find((call) =>
        typeof call[0] === 'string' && call[0].includes('UPDATE events')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain("status = 'live'");
      expect(updateCall![0]).toContain('photo_count = photo_count + $1');
      expect(updateCall![0]).toContain('video_count = video_count + $2');
      expect(updateCall![1]).toEqual([1, 1, 42]);
    });

    it('subsequent upload preserves live status for already live event', async () => {
      // 1. SELECT event returns live event
      queryMock.mockResolvedValueOnce({
        rows: [mockEventRowLive],
        rowCount: 1,
      } as any);

      uploadMock.mockResolvedValueOnce({
        cloudinary_id: 'cld_photo_2',
        cloudinary_url: 'https://res.cloudinary.com/cloud/image/upload/v1/photo2.jpg',
        cloudinary_thumb_url: 'https://res.cloudinary.com/cloud/image/upload/w_300,h_300/photo2.jpg',
        file_type: 'photo',
      });

      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('image-binary-data'), {
          filename: 'photo2.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        uploaded_count: 1,
        event_status: 'live',
        event_url: 'rohan-photography.photomemories.ai/event/aarav-priya-2024',
      });

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });

  // ======================================================================
  // 5. Cloudinary & Database Failure Handling with Rollback
  // ======================================================================
  describe('Failure Handling & Rollback', () => {
    it('cleans up uploaded Cloudinary assets when Cloudinary upload fails mid-batch', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [mockEventRowReady],
        rowCount: 1,
      } as any);

      // First file succeeds, second file fails
      uploadMock
        .mockResolvedValueOnce({
          cloudinary_id: 'cld_photo_temp_1',
          cloudinary_url: 'https://res.cloudinary.com/cloud/image/upload/v1/temp1.jpg',
          cloudinary_thumb_url: 'https://res.cloudinary.com/cloud/image/upload/w_300,h_300/temp1.jpg',
          file_type: 'photo',
        })
        .mockRejectedValueOnce(new Error('Cloudinary network timeout'));

      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('image-1'), { filename: 'p1.jpg', contentType: 'image/jpeg' })
        .attach('photos', Buffer.from('image-2'), { filename: 'p2.jpg', contentType: 'image/jpeg' });

      expect(response.status).toBe(502);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('CLOUDINARY_UPLOAD_ERROR');

      // Verify rollback cleanup of first uploaded asset
      expect(deleteMock).toHaveBeenCalledWith('cld_photo_temp_1', 'image');

      // DB should never have started a transaction
      expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
    });

    it('rolls back DB transaction and cleans up Cloudinary assets when database insert fails', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [mockEventRowReady],
        rowCount: 1,
      } as any);

      uploadMock.mockResolvedValueOnce({
        cloudinary_id: 'cld_photo_success_1',
        cloudinary_url: 'https://res.cloudinary.com/cloud/image/upload/v1/s1.jpg',
        cloudinary_thumb_url: 'https://res.cloudinary.com/cloud/image/upload/w_300,h_300/s1.jpg',
        file_type: 'photo',
      });

      // DB query fails during insert
      mockClient.query
        .mockResolvedValueOnce({ rows: [] } as any) // BEGIN
        .mockRejectedValueOnce(new Error('Database write error')); // INSERT INTO photos

      const response = await request(app)
        .post('/api/events/42/upload-photos')
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${photographerToken}`)
        .attach('photos', Buffer.from('image-1'), { filename: 'p1.jpg', contentType: 'image/jpeg' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('DATABASE_ERROR');

      // Verify DB transaction rollback
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalledTimes(1);

      // Verify Cloudinary asset rollback
      expect(deleteMock).toHaveBeenCalledWith('cld_photo_success_1', 'image');
    });
  });
});
