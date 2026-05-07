require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const bcrypt = require('bcrypt');
const DB_NAME = process.env.DB_NAME;

async function columnExists(table, column) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  return (rows[0]?.c || 0) > 0;
}

async function ensureColumn(table, column, alterSql) {
  try {
    const exists = await columnExists(table, column);
    if (exists) return false;
    await db.query(alterSql);
    console.log(`Patched ${table}: added column ${column}`);
    return true;
  } catch (err) {
    console.warn(`Could not patch ${table}.${column}: ${err.message}`);
    return false;
  }
}

async function runSchemaStatements() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaRaw = fs.readFileSync(schemaPath, 'utf8');
  const schema = schemaRaw.replace(/^\s*--.*$/gm, '').trim();
  const statements = schema
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  console.log(`Found ${statements.length} SQL statements to execute.`);

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    try {
      await db.query(statement);
      console.log(`Executed statement ${index + 1}/${statements.length}`);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.error(`Statement ${index + 1} failed: ${err.message}`);
      }
    }
  }
}

async function patchLegacyTables() {
  await ensureColumn(
    'users',
    'status',
    "ALTER TABLE users ADD COLUMN status ENUM('active','inactive','suspended') DEFAULT 'active'"
  );
  await ensureColumn(
    'users',
    'last_login',
    'ALTER TABLE users ADD COLUMN last_login TIMESTAMP NULL'
  );

  await ensureColumn(
    'posts',
    'category_id',
    'ALTER TABLE posts ADD COLUMN category_id INT NULL'
  );
  await ensureColumn(
    'posts',
    'view_count',
    'ALTER TABLE posts ADD COLUMN view_count INT DEFAULT 0'
  );
  await ensureColumn(
    'posts',
    'updated_at',
    'ALTER TABLE posts ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
  );

  await ensureColumn(
    'notices',
    'category_id',
    'ALTER TABLE notices ADD COLUMN category_id INT NULL'
  );
  await ensureColumn(
    'notices',
    'target_audience',
    "ALTER TABLE notices ADD COLUMN target_audience ENUM('all','students','faculty','staff') DEFAULT 'all'"
  );
  await ensureColumn(
    'notices',
    'source_type',
    "ALTER TABLE notices ADD COLUMN source_type ENUM('manual','email') DEFAULT 'manual'"
  );
  await ensureColumn(
    'notices',
    'source_ref',
    'ALTER TABLE notices ADD COLUMN source_ref VARCHAR(255) NULL'
  );
  await ensureColumn(
    'notices',
    'source_sender_name',
    'ALTER TABLE notices ADD COLUMN source_sender_name VARCHAR(150) NULL'
  );
  await ensureColumn(
    'notices',
    'source_sender_email',
    'ALTER TABLE notices ADD COLUMN source_sender_email VARCHAR(150) NULL'
  );
  await ensureColumn(
    'notices',
    'is_pinned',
    'ALTER TABLE notices ADD COLUMN is_pinned TINYINT(1) DEFAULT 0'
  );
  await ensureColumn(
    'notices',
    'view_count',
    'ALTER TABLE notices ADD COLUMN view_count INT DEFAULT 0'
  );
  await ensureColumn(
    'notices',
    'expires_at',
    'ALTER TABLE notices ADD COLUMN expires_at DATETIME NULL'
  );
  await ensureColumn(
    'notices',
    'updated_at',
    'ALTER TABLE notices ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
  );

  await ensureColumn(
    'resources',
    'building_id',
    'ALTER TABLE resources ADD COLUMN building_id INT NULL'
  );
  await ensureColumn(
    'resources',
    'floor_number',
    'ALTER TABLE resources ADD COLUMN floor_number VARCHAR(50) NULL'
  );
  await ensureColumn(
    'resources',
    'capacity',
    'ALTER TABLE resources ADD COLUMN capacity INT NULL'
  );
  await ensureColumn(
    'resources',
    'equipment',
    'ALTER TABLE resources ADD COLUMN equipment TEXT NULL'
  );
  await ensureColumn(
    'resources',
    'updated_at',
    'ALTER TABLE resources ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
  );

  await ensureColumn(
    'user_sessions',
    'browser_fingerprint',
    'ALTER TABLE user_sessions ADD COLUMN browser_fingerprint VARCHAR(255) NULL'
  );
}

function isValidAdminVitEmail(email) {
  if (!email) return false;
  const lower = String(email).trim().toLowerCase();
  const localPart = lower.split('@')[0];
  if (!localPart) return false;

  // For admin bootstrap we allow either domain:
  // - @vit.ac.in
  // - @vitstudent.ac.in
  // The "20XX" suffix is NOT required for admins (but it is still enforced for student registration).
  return lower.endsWith('@vit.ac.in') || lower.endsWith('@vitstudent.ac.in');
}

async function getCount(tableName) {
  const [rows] = await db.query(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return rows[0]?.count || 0;
}

async function getOrCreateCategory(name, type, color = '#2563eb', description = null) {
  const [existing] = await db.query(
    'SELECT id FROM categories WHERE name = ? AND type = ? LIMIT 1',
    [name, type]
  );
  if (existing?.length) return existing[0].id;

  const [result] = await db.query(
    `INSERT INTO categories (name, type, description, color, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [name, type, description, color]
  );

  return result.insertId;
}

async function ensureDemoStudent() {
  const email = (process.env.DEMO_STUDENT_EMAIL || 'demo.student2026@vitstudent.ac.in').trim().toLowerCase();
  const name = process.env.DEMO_STUDENT_NAME || 'Demo Student';
  const password = process.env.DEMO_STUDENT_PASSWORD || 'student123';

  const [existing] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing?.length) return existing[0].id;

  const hash = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
    [name, email, hash, 'student', 'active']
  );

  return result.insertId;
}

async function seedDemoData(adminId) {
  const shouldSeed = process.env.SEED_DEMO_DATA !== 'false';
  if (!shouldSeed) {
    console.log('Demo seed skipped: set SEED_DEMO_DATA=true if you want starter data.');
    return;
  }

  const [buildingCount, resourceCount, postCount, noticeCount] = await Promise.all([
    getCount('buildings'),
    getCount('resources'),
    getCount('posts'),
    getCount('notices')
  ]);

  const studentId = await ensureDemoStudent();

  const postCategories = [
    ['Classroom', '#1d4ed8'],
    ['Library', '#0f766e'],
    ['WiFi', '#7c3aed'],
    ['Hostel', '#ea580c'],
    ['Transport', '#dc2626'],
    ['Other', '#475467']
  ];
  const noticeCategories = [
    ['Academics', '#1d4ed8'],
    ['Examinations', '#dc2626'],
    ['Placements', '#0f766e'],
    ['Campus Services', '#7c3aed']
  ];

  for (const [name, color] of postCategories) {
    await getOrCreateCategory(name, 'post', color, 'Demo post category');
  }
  for (const [name, color] of noticeCategories) {
    await getOrCreateCategory(name, 'notice', color, 'Demo notice category');
  }

  if (buildingCount === 0) {
    await db.query(
      `INSERT INTO buildings (code, name, location, description, status)
       VALUES
       ('TT', 'Technology Tower', 'Central academic zone', 'Labs, classrooms, and student help desks.', 'active'),
       ('CBMR', 'Central Block and Main Reception', 'Administrative corridor', 'Core admin and support services.', 'active'),
       ('LIB', 'Central Library', 'Knowledge hub', 'Reading spaces, circulation desk, and digital access points.', 'active')`
    );
    console.log('Seeded demo buildings.');
  }

  if (resourceCount === 0) {
    const [buildings] = await db.query('SELECT id, code FROM buildings');
    const buildingByCode = Object.fromEntries((buildings || []).map((row) => [row.code, row.id]));
    await db.query(
      `INSERT INTO resources
       (building_id, name, type, floor_number, description, is_open, contact_info, timings, capacity, equipment)
       VALUES
       (?, 'Innovation Lab', 'Lab', '2', 'Rapid prototyping and collaboration space for project teams.', 1, 'lab@campus.local', '9 AM - 7 PM', 40, '3D printer, whiteboards, maker kits'),
       (?, 'Student Help Desk', 'Support Office', 'Ground', 'Walk-in support for campus services and ID issues.', 1, 'support@campus.local', '8 AM - 6 PM', 20, 'Token system, issue counter'),
       (?, 'Reading Hall', 'Library', '1', 'Quiet reading and long-form study area.', 1, 'library@campus.local', '8 AM - 10 PM', 120, 'Reading desks, charging ports'),
       (?, 'Placement Resource Room', 'Career Center', '3', 'Preparation room for placement drives and mock interviews.', 1, 'placement@campus.local', '10 AM - 5 PM', 35, 'Interview booths, practice systems'),
       (?, 'Night Canteen', 'Food Court', 'Ground', 'Late evening food counter near the academic blocks.', 0, 'canteen@campus.local', '6 PM - 1 AM', 60, 'Seating area, takeaway counter')`,
      [
        buildingByCode.TT,
        buildingByCode.CBMR,
        buildingByCode.LIB,
        buildingByCode.TT,
        buildingByCode.CBMR
      ]
    );
    console.log('Seeded demo resources.');
  }

  if (postCount === 0) {
    const classroomCategoryId = await getOrCreateCategory('Classroom', 'post', '#1d4ed8');
    const wifiCategoryId = await getOrCreateCategory('WiFi', 'post', '#7c3aed');
    const libraryCategoryId = await getOrCreateCategory('Library', 'post', '#0f766e');

    await db.query(
      `INSERT INTO posts
       (user_id, category_id, type, title, body, priority, expires_at, status)
       VALUES
       (?, ?, 'update', 'Projector issue resolved in TT 404', 'The projector in TT 404 is working again. Faculty confirmed it for the afternoon slot.', 'important', DATE_ADD(NOW(), INTERVAL 4 HOUR), 'open'),
       (?, ?, 'query', 'Best time to use library discussion rooms?', 'Has anyone figured out the least crowded window to use the discussion rooms before internal reviews?', 'normal', NULL, 'open'),
       (?, ?, 'query', 'WiFi drops near lab corridor', 'Is there a stable backup hotspot or workaround when the corridor network starts dropping during submissions?', 'important', NULL, 'open')`,
      [
        studentId, classroomCategoryId,
        studentId, libraryCategoryId,
        studentId, wifiCategoryId
      ]
    );
    console.log('Seeded demo posts.');
  }

  if (noticeCount === 0) {
    const academicsCategoryId = await getOrCreateCategory('Academics', 'notice', '#1d4ed8');
    const examsCategoryId = await getOrCreateCategory('Examinations', 'notice', '#dc2626');
    const placementsCategoryId = await getOrCreateCategory('Placements', 'notice', '#0f766e');

    await db.query(
      `INSERT INTO notices
       (created_by, category_id, title, body, priority, target_audience, source_type, view_count)
       VALUES
       (?, ?, 'Mid-sem registration window opened', 'Students can now register for mid-sem slots through the academic portal until Friday 6 PM.', 'important', 'students', 'manual', 0),
       (?, ?, 'Mock placement drive schedule', 'The placement cell has published the mock interview schedule for final-year students this week.', 'normal', 'students', 'manual', 0),
       (?, ?, 'Exam hall entry checklist', 'Carry your ID card, approved calculator, and printed hall ticket before entering the exam block.', 'emergency', 'students', 'manual', 0)`,
      [
        adminId, academicsCategoryId,
        adminId, placementsCategoryId,
        adminId, examsCategoryId
      ]
    );
    console.log('Seeded demo notices.');
  }
}

async function bootstrapSingleAdmin() {
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  const adminName = process.env.BOOTSTRAP_ADMIN_NAME || process.env.ADMIN_NAME || 'Campus Admin';

  if (!adminEmail || !adminPassword) {
    console.log('Admin bootstrap skipped: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD in .env.');
    return;
  }

  if (!isValidAdminVitEmail(adminEmail)) {
    throw new Error(
      `Invalid admin email "${adminEmail}". Must end with @vit.ac.in or @vitstudent.ac.in.`
    );
  }

  if (String(adminPassword).length < 6) {
    throw new Error('Admin bootstrap failed: ADMIN_PASSWORD must be at least 6 characters.');
  }

  const cleanEmail = String(adminEmail).trim().toLowerCase();

  const [existingRows] = await db.query('SELECT id, role FROM users WHERE email = ? LIMIT 1', [cleanEmail]);
  let adminId = existingRows?.[0]?.id || null;

  if (!adminId) {
    const passwordHash = await bcrypt.hash(String(adminPassword), 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)',
      [adminName, cleanEmail, passwordHash, 'admin', 'active']
    );
    adminId = result.insertId;
  } else {
    // If the user exists, ensure they are admin.
    await db.query('UPDATE users SET role = ? WHERE id = ?', ['admin', adminId]);
  }

  // Enforce exactly ONE admin account in the system.
  await db.query("UPDATE users SET role = 'student' WHERE role = 'admin' AND email <> ?", [cleanEmail]);

  console.log(`Admin bootstrap completed. Admin user id: ${adminId}`);
  return adminId;
}

async function migrate() {
  try {
    console.log('Starting database migration...');
    await runSchemaStatements();

    try {
      await db.query('ALTER TABLE categories DROP INDEX name');
    } catch (err) {
      // Ignore when the old index is already gone.
    }

    try {
      await db.query('ALTER TABLE categories ADD UNIQUE KEY unique_name_type (name, type)');
    } catch (err) {
      // Ignore when the composite key already exists.
    }

    await patchLegacyTables();
    const adminId = await bootstrapSingleAdmin();
    if (adminId) {
      await seedDemoData(adminId);
    }

    console.log('Schema migration completed.');
    console.log('Database is ready for app data.');
    process.exit(0);
  } catch (err) {
    console.error(`Migration failed: ${err.message}`);
    process.exit(1);
  }
}

migrate();
