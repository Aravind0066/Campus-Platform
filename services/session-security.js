const crypto = require('crypto');
const db = require('../config/db');

function normalizeUserAgent(userAgent = '') {
  return userAgent.toString().trim().replace(/\s+/g, ' ').slice(0, 255);
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || null;
}

function getDeviceType(userAgent) {
  const ua = (userAgent || '').toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) return 'mobile';
  if (ua.includes('ipad') || ua.includes('tablet')) return 'tablet';
  return 'desktop';
}

// UA + Accept-Language only; Client Hints vary by request type and caused false logouts.
function buildBrowserFingerprint(req) {
  const parts = [
    normalizeUserAgent(req.headers['user-agent'] || ''),
    (req.headers['accept-language'] || '').toString().trim()
  ];

  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

async function upsertUserSession({ userId, sessionToken, req }) {
  if (!userId || !sessionToken) return;

  const ip = getClientIp(req);
  const ua = normalizeUserAgent(req.headers['user-agent'] || '');
  const device = getDeviceType(ua);
  const fingerprint = buildBrowserFingerprint(req);
  const expires = req.session?.cookie?._expires
    ? new Date(req.session.cookie._expires)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, browser_fingerprint, device_type, is_active, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       ip_address = VALUES(ip_address),
       user_agent = VALUES(user_agent),
       browser_fingerprint = VALUES(browser_fingerprint),
       device_type = VALUES(device_type),
       is_active = 1,
       expires_at = VALUES(expires_at),
       last_activity = CURRENT_TIMESTAMP`,
    [userId, sessionToken, ip, ua, fingerprint, device, expires]
  );
}

async function touchUserSession(sessionToken) {
  if (!sessionToken) return;
  await db.query(
    'UPDATE user_sessions SET last_activity = CURRENT_TIMESTAMP WHERE session_token = ? AND is_active = 1',
    [sessionToken]
  );
}

async function markSessionInactive(sessionToken) {
  if (!sessionToken) return;
  await db.query('UPDATE user_sessions SET is_active = 0 WHERE session_token = ?', [sessionToken]);
}

async function markUserSessionsInactive(userId) {
  if (!userId) return;
  await db.query('UPDATE user_sessions SET is_active = 0 WHERE user_id = ?', [userId]);
}

async function validateSessionBinding(req) {
  if (!req.session?.user?.id || !req.sessionID) {
    return { valid: true };
  }

  const expectedFingerprint = buildBrowserFingerprint(req);

  const [rows] = await db.query(
    `SELECT s.session_token, s.ip_address, s.user_agent, s.browser_fingerprint, s.is_active, s.expires_at, u.status AS user_status
     FROM user_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.session_token = ? AND s.user_id = ?
     LIMIT 1`,
    [req.sessionID, req.session.user.id]
  );

  const current = rows?.[0];
  if (!current || !current.is_active) {
    return { valid: false, message: 'Session not active. Please log in again.' };
  }

  if (current.expires_at && new Date(current.expires_at).getTime() <= Date.now()) {
    return { valid: false, message: 'Session expired. Please log in again.' };
  }

  if (current.user_status && current.user_status !== 'active') {
    return { valid: false, message: 'This account is no longer active. Please contact the campus admin.' };
  }

  const requestUa = normalizeUserAgent(req.headers['user-agent'] || '');
  if (current.user_agent && normalizeUserAgent(current.user_agent) !== requestUa) {
    return {
      valid: false,
      message: 'This account session cannot be reused from another browser.'
    };
  }

  if (current.browser_fingerprint !== expectedFingerprint) {
    await db.query(
      'UPDATE user_sessions SET browser_fingerprint = ? WHERE session_token = ? AND user_id = ?',
      [expectedFingerprint, req.sessionID, req.session.user.id]
    );
  }
  req.session.browserFingerprint = expectedFingerprint;

  if (process.env.STRICT_SESSION_IP === 'true') {
    const requestIp = getClientIp(req);
    if (current.ip_address && requestIp && current.ip_address !== requestIp) {
      return {
        valid: false,
        message: 'Network changed for this locked session. Please log in again.'
      };
    }
  }

  return { valid: true };
}

module.exports = {
  buildBrowserFingerprint,
  getClientIp,
  getDeviceType,
  markSessionInactive,
  markUserSessionsInactive,
  normalizeUserAgent,
  touchUserSession,
  upsertUserSession,
  validateSessionBinding
};

