const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const {
  buildBrowserFingerprint,
  markSessionInactive,
  markUserSessionsInactive,
  upsertUserSession
} = require('../services/session-security');
const {
  getEmailAccountByUser,
  syncEmailNoticeAccountByUser
} = require('../services/email-sync');

const router = express.Router();
const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production'
};

function clearSessionCookie(res) {
  res.clearCookie('campus.sid', sessionCookieOptions);
}

function isValidVitEmail(email) {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  if (!lower.endsWith('@vitstudent.ac.in')) return false;
  const localPart = lower.split('@')[0];
  return /20\d{2}$/.test(localPart);
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function createAuthenticatedSession(req, user) {
  await regenerateSession(req);
  req.session.user = user;
  req.session.browserFingerprint = buildBrowserFingerprint(req);
  await saveSession(req);

  await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
  await upsertUserSession({ userId: user.id, sessionToken: req.sessionID, req });
}

function queueLoginAutoSync(userId) {
  setImmediate(async () => {
    try {
      const account = await getEmailAccountByUser(userId);
      if (!account?.is_active || !account?.encrypted_password) {
        return;
      }

      await syncEmailNoticeAccountByUser(userId);
    } catch (err) {
      console.warn(`Login auto-sync skipped for user ${userId}: ${err.message}`);
    }
  });
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!isValidVitEmail(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Use your VIT student email ending with 20XX@vitstudent.ac.in.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password should be at least 6 characters.' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing?.length) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.'
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name.trim(), cleanEmail, hash, 'student']
    );

    const user = {
      id: result.insertId,
      name: name.trim(),
      email: cleanEmail,
      role: 'student'
    };

    await createAuthenticatedSession(req, user);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      user
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required.' });
    }

    const [rows] = await db.query(
      'SELECT id, name, email, password_hash, role, status FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );

    if (!rows?.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const foundUser = rows[0];
    const storedHash = foundUser.password_hash || '';
    const valid = storedHash.startsWith('$2')
      ? await bcrypt.compare(password, storedHash)
      : password === storedHash;

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (foundUser.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'This account is inactive. Please contact the campus admin.'
      });
    }

    if (foundUser.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'This account has been suspended. Please contact the campus admin.'
      });
    }

    const user = {
      id: foundUser.id,
      name: foundUser.name,
      email: foundUser.email,
      role: foundUser.role
    };

    await createAuthenticatedSession(req, user);
    queueLoginAutoSync(user.id);

    return res.json({ success: true, user });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (req.sessionID) {
      await markSessionInactive(req.sessionID);
    }
    if (userId) {
      await markUserSessionsInactive(userId);
    }
  } catch (err) {
    console.warn('Session tracking (logout) failed:', err.message);
  }

  req.session.destroy(() => {});
  clearSessionCookie(res);
  return res.json({ success: true });
});

router.get('/me', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, user: null });
  }

  return res.json({ success: true, user: req.session.user });
});

module.exports = router;

