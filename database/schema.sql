CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student', 'admin') DEFAULT 'student',
  status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL,
  INDEX idx_email (email),
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS buildings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  location VARCHAR(200),
  description TEXT,
  coordinates VARCHAR(100),
  status ENUM('active', 'maintenance', 'closed') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resources (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(100) NOT NULL,
  floor_number VARCHAR(50),
  description TEXT,
  is_open TINYINT(1) DEFAULT 1,
  contact_info VARCHAR(255),
  timings VARCHAR(255),
  capacity INT NULL,
  equipment TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  INDEX idx_building (building_id),
  INDEX idx_type (type),
  INDEX idx_is_open (is_open)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type ENUM('post', 'resource', 'notice') NOT NULL,
  description TEXT,
  color VARCHAR(20) DEFAULT '#667eea',
  icon VARCHAR(50) NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_name_type (name, type),
  INDEX idx_type (type),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  category_id INT NULL,
  type ENUM('update', 'query') NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  priority ENUM('normal', 'important', 'urgent') DEFAULT 'normal',
  expires_at DATETIME NULL,
  status ENUM('open', 'resolved', 'closed') DEFAULT 'open',
  view_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_user (user_id),
  INDEX idx_type (type),
  INDEX idx_status (status),
  INDEX idx_expires (expires_at),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS post_replies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  user_id INT NOT NULL,
  reply_text TEXT NOT NULL,
  is_accepted TINYINT(1) DEFAULT 0,
  is_helpful INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_post (post_id),
  INDEX idx_user (user_id),
  INDEX idx_accepted (is_accepted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  created_by INT NOT NULL,
  category_id INT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  priority ENUM('normal', 'important', 'emergency') DEFAULT 'normal',
  target_audience ENUM('all', 'students', 'faculty', 'staff') DEFAULT 'all',
  source_type ENUM('manual', 'email') DEFAULT 'manual',
  source_ref VARCHAR(255) NULL,
  source_sender_name VARCHAR(150) NULL,
  source_sender_email VARCHAR(150) NULL,
  is_pinned TINYINT(1) DEFAULT 0,
  view_count INT DEFAULT 0,
  expires_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_created_by (created_by),
  INDEX idx_priority (priority),
  INDEX idx_source_type (source_type),
  INDEX idx_source_ref (source_ref),
  INDEX idx_pinned (is_pinned),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notice_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  notice_id INT NOT NULL,
  user_id INT NOT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_view (notice_id, user_id),
  INDEX idx_notice (notice_id),
  INDEX idx_user (user_id),
  INDEX idx_viewed_at (viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  session_token VARCHAR(255) NOT NULL UNIQUE,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  browser_fingerprint VARCHAR(255),
  device_type VARCHAR(50),
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_token (session_token),
  INDEX idx_browser_fingerprint (browser_fingerprint),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_notice_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  email_address VARCHAR(150) NOT NULL,
  imap_host VARCHAR(150) NULL,
  imap_port INT DEFAULT 993,
  imap_secure TINYINT(1) DEFAULT 1,
  imap_username VARCHAR(150) NULL,
  encrypted_password TEXT NOT NULL,
  sender_allowlist TEXT NULL,
  keyword_filters TEXT NULL,
  is_active TINYINT(1) DEFAULT 1,
  last_synced_at TIMESTAMP NULL,
  last_error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_email_notice_account_user (user_id),
  INDEX idx_email_notice_accounts_active (is_active),
  INDEX idx_email_notice_accounts_email (email_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_notice_imports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id INT NOT NULL,
  user_id INT NOT NULL,
  notice_id INT NOT NULL,
  message_uid VARCHAR(100) NOT NULL,
  message_id VARCHAR(255) NULL,
  sender_name VARCHAR(150) NULL,
  sender_email VARCHAR(150) NULL,
  subject VARCHAR(255) NOT NULL,
  received_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES email_notice_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE,
  UNIQUE KEY unique_email_notice_import_uid (account_id, message_uid),
  UNIQUE KEY unique_email_notice_import_message (account_id, message_id),
  INDEX idx_email_notice_imports_user (user_id),
  INDEX idx_email_notice_imports_notice (notice_id),
  INDEX idx_email_notice_imports_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
