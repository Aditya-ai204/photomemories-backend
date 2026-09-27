-- Authoritative Database Schema Migration
-- Source: PhotoMemories_Backend_PRD_V2.pdf (Pages 6-11, 26)

-- 1. Users Table (PRD Page 6)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'photographer' CHECK (role IN ('photographer', 'admin')),
  company_name VARCHAR(255),
  phone VARCHAR(20),
  subdomain VARCHAR(100) UNIQUE,
  city VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  verification_token VARCHAR(255),
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_subdomain ON users(subdomain);

-- 2. Events Table (PRD Pages 7-8)
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  photographer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name VARCHAR(255) NOT NULL,
  couple_names VARCHAR(255),
  event_date DATE NOT NULL,
  theme VARCHAR(50) NOT NULL,
  location VARCHAR(255),
  client_email VARCHAR(500),
  client_phone VARCHAR(255),
  plan VARCHAR(50) DEFAULT 'base' CHECK (plan IN ('base', 'medium', 'pro')),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'ready_for_upload', 'live', 'archived')),
  unique_slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  
  -- Admin-created content (manual design)
  invitation_html TEXT,
  landing_page_html TEXT,
  
  -- Photographer data counters
  photo_count INTEGER DEFAULT 0,
  video_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  
  -- Subscription & Payment info
  amount_paid DECIMAL(10, 2),
  payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed')),
  
  -- Tracking
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ready_at TIMESTAMP,
  went_live_at TIMESTAMP,
  
  -- Admin notes
  admin_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_photographer ON events(photographer_id);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(unique_slug);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- 3. Photos Table (PRD Page 9)
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id),
  cloudinary_id VARCHAR(255) NOT NULL,
  cloudinary_url VARCHAR(500) NOT NULL,
  cloudinary_thumb_url VARCHAR(500),
  file_type VARCHAR(50) DEFAULT 'photo' CHECK (file_type IN ('photo', 'video')),
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_photos_event ON photos(event_id);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_by ON photos(uploaded_by);

-- 4. Subscriptions Table (PRD Page 10)
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  photographer_id INTEGER NOT NULL REFERENCES users(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  plan VARCHAR(50) CHECK (plan IN ('base', 'medium', 'pro')),
  amount DECIMAL(10, 2),
  features JSONB,
  purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

-- 5. Analytics Table (PRD Pages 10-11)
CREATE TABLE IF NOT EXISTS analytics (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  action_date DATE NOT NULL,
  user_ip VARCHAR(45),
  user_agent VARCHAR(500),
  referrer VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics(event_id);

-- 6. AdminLogs Table (PRD Page 11)
CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Subdomains Table (PRD Page 26)
CREATE TABLE IF NOT EXISTS subdomains (
  id SERIAL PRIMARY KEY,
  photographer_id INTEGER REFERENCES users(id),
  subdomain_name VARCHAR(100) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);
