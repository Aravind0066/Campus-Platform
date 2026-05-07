const express = require('express');
const db = require('../config/db');
const {
  getEmailAccountByUser,
  saveEmailAccount,
  syncEmailNoticeAccountByUser,
  toSafeAccount
} = require('../services/email-sync');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ success: false, message: 'Please log in.' });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin only.' });
  }

  return next();
}

function getVisibleNoticeAudiences(req) {
  if (req.session?.user?.role === 'admin') {
    return ['all', 'students', 'faculty', 'staff'];
  }

  return ['all', 'students'];
}

function buildNoticeVisibilityClause(req, alias = 'n') {
  const audiences = getVisibleNoticeAudiences(req);
  const placeholders = audiences.map(() => '?').join(', ');
  return {
    clause: `${alias}.target_audience IN (${placeholders})`,
    params: audiences
  };
}

function buildNoticeAccessClause(req, alias = 'n') {
  const visibility = buildNoticeVisibilityClause(req, alias);
  return {
    clause: `(((${alias}.source_type = 'manual') AND ${visibility.clause}) OR (${alias}.source_type = 'email' AND ${alias}.created_by = ?))`,
    params: [...visibility.params, req.session.user.id]
  };
}

async function getOrCreateCategoryId(categoryName, type) {
  if (!categoryName) return null;
  const name = categoryName.trim();
  if (!name) return null;

  const [existing] = await db.query(
    'SELECT id FROM categories WHERE name = ? AND type = ?',
    [name, type]
  );
  if (existing?.length) return existing[0].id;

  try {
    const [result] = await db.query(
      'INSERT INTO categories (name, type, is_active) VALUES (?, ?, 1)',
      [name, type]
    );
    return result.insertId;
  } catch (err) {
    const [rows] = await db.query(
      'SELECT id FROM categories WHERE name = ? AND type = ?',
      [name, type]
    );
    return rows?.[0]?.id || null;
  }
}

router.get('/email/settings', requireAuth, async (req, res) => {
  try {
    const account = await getEmailAccountByUser(req.session.user.id);
    return res.json({ success: true, data: toSafeAccount(account) });
  } catch (err) {
    console.error('Email notice settings error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.put('/email/settings', requireAuth, async (req, res) => {
  try {
    const account = await saveEmailAccount({ userId: req.session.user.id, payload: req.body || {} });
    return res.json({
      success: true,
      message: 'Email notice sync has been saved and verified.',
      data: toSafeAccount(account)
    });
  } catch (err) {
    console.error('Email notice settings save error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Could not save email sync settings.' });
  }
});

router.post('/email/sync', requireAuth, async (req, res) => {
  try {
    const result = await syncEmailNoticeAccountByUser(req.session.user.id);
    return res.json({
      success: true,
      message: `${result.importedCount} notice(s) imported from email.`,
      data: result
    });
  } catch (err) {
    console.error('Email notice sync error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Email sync failed.' });
  }
});

router.get('/views/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [rows] = await db.query(
      `SELECT COUNT(*) AS count,
              MAX(viewed_at) AS last_viewed_at
       FROM notice_views
       WHERE user_id = ?`,
      [userId]
    );

    return res.json({
      success: true,
      data: {
        viewed: rows[0]?.count || 0,
        lastViewedAt: rows[0]?.last_viewed_at || null
      }
    });
  } catch (err) {
    console.error('Notice views stats error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.get('/summary/overview', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    const access = buildNoticeAccessClause(req);

    const [totalsRows] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN source_type = 'manual' THEN 1 ELSE 0 END) AS manual_count,
              SUM(CASE WHEN source_type = 'email' THEN 1 ELSE 0 END) AS email_count,
              SUM(CASE WHEN priority = 'emergency' THEN 1 ELSE 0 END) AS emergency_count,
              SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today_count
       FROM notices n
       WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
         AND ${access.clause}`,
      access.params
    );
    const [priorityRows] = await db.query(
      `SELECT priority, COUNT(*) AS count
       FROM notices n
       WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
         AND ${access.clause}
       GROUP BY priority`,
      access.params
    );
    const [categoryRows] = await db.query(
      `SELECT COALESCE(c.name, 'Uncategorized') AS category, COUNT(*) AS count
       FROM notices n
       LEFT JOIN categories c ON n.category_id = c.id
       WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
         AND ${access.clause}
       GROUP BY COALESCE(c.name, 'Uncategorized')
       ORDER BY count DESC
       LIMIT 6`,
      access.params
    );

    let viewer = {
      viewed: 0,
      emailSyncConnected: false,
      lastSyncedAt: null
    };

    if (userId) {
      const [viewRows] = await db.query(
        'SELECT COUNT(*) AS count FROM notice_views WHERE user_id = ?',
        [userId]
      );
      const account = await getEmailAccountByUser(userId);
      viewer = {
        viewed: viewRows[0]?.count || 0,
        emailSyncConnected: Boolean(account),
        lastSyncedAt: account?.last_synced_at || null
      };
    }

    return res.json({
      success: true,
      data: {
        totals: totalsRows[0] || {},
        byPriority: priorityRows || [],
        byCategory: categoryRows || [],
        viewer
      }
    });
  } catch (err) {
    console.error('Notice summary error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const access = buildNoticeAccessClause(req);
    const [rows] = await db.query(
      `SELECT n.id, n.title, n.body, n.priority, n.target_audience, n.is_pinned,
              n.view_count, n.expires_at, n.created_at, n.source_type, n.source_ref,
              n.source_sender_name, n.source_sender_email,
              u.name AS created_by_name, u.email AS created_by_email,
              c.name AS category, c.color AS category_color, c.icon AS category_icon
       FROM notices n
       LEFT JOIN users u ON n.created_by = u.id
       LEFT JOIN categories c ON n.category_id = c.id
       WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
         AND ${access.clause}
       ORDER BY n.is_pinned DESC, n.created_at DESC`,
      access.params
    );

    return res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('Notices list error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, body, priority, category, target_audience } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body required.' });
    }

    if (!['normal', 'important', 'emergency'].includes(priority)) {
      return res.status(400).json({
        success: false,
        message: 'Priority must be normal, important, or emergency.'
      });
    }

    const categoryId = await getOrCreateCategoryId(category, 'notice');
    const target = ['all', 'students', 'faculty', 'staff'].includes(target_audience)
      ? target_audience
      : 'all';

    const [result] = await db.query(
      `INSERT INTO notices (created_by, category_id, title, body, priority, target_audience, source_type)
       VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
      [req.session.user.id, categoryId, title.trim(), body.trim(), priority, target]
    );

    if (process.env.EMAIL_HOST) {
      setImmediate(async () => {
        try {
          const nodemailer = require('nodemailer');
          const emailTransporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT || '587', 10),
            secure: process.env.EMAIL_SECURE === 'true',
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASS
            }
          });

          const [users] = await db.query("SELECT email FROM users WHERE email IS NOT NULL AND status = 'active'");
          if (!users?.length) return;

          const priorityLabel = priority === 'emergency'
            ? 'EMERGENCY'
            : priority === 'important'
              ? 'IMPORTANT'
              : 'Notice';

          await emailTransporter.sendMail({
            from: `"Campus Platform" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            bcc: users.map((user) => user.email).join(', '),
            subject: `${priorityLabel}: ${title}`,
            html: `<h2>${title}</h2><p>${body.replace(/\n/g, '<br>')}</p><p><a href="${process.env.APP_URL || 'http://localhost:3000'}/noticeboard.html">View on Noticeboard</a></p>`
          });
        } catch (err) {
          console.error('Email notification error:', err);
        }
      });
    }

    return res.json({ success: true, message: 'Notice created.', id: result.insertId });
  } catch (err) {
    console.error('Notice create error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.post('/:id/view', requireAuth, async (req, res) => {
  try {
    const noticeId = parseInt(req.params.id, 10);
    if (Number.isNaN(noticeId)) {
      return res.status(400).json({ success: false, message: 'Invalid notice id.' });
    }

    const access = buildNoticeAccessClause(req);
    const [notices] = await db.query(
      `SELECT id
       FROM notices n
       WHERE n.id = ?
         AND (n.expires_at IS NULL OR n.expires_at > NOW())
         AND ${access.clause}
       LIMIT 1`,
      [noticeId, ...access.params]
    );
    if (!notices?.length) {
      return res.status(404).json({ success: false, message: 'Notice not found.' });
    }

    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || null;
    const ua = req.headers['user-agent'] || null;
    const [result] = await db.query(
      'INSERT IGNORE INTO notice_views (notice_id, user_id, ip_address, user_agent) VALUES (?, ?, ?, ?)',
      [noticeId, req.session.user.id, ip, ua]
    );

    const inserted = result?.affectedRows === 1;
    if (inserted) {
      await db.query('UPDATE notices SET view_count = view_count + 1 WHERE id = ?', [noticeId]);
    }

    return res.json({ success: true, viewed: true, counted: inserted });
  } catch (err) {
    console.error('Notice view error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid notice id.' });
    }

    const [result] = await db.query('DELETE FROM notices WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Notice not found.' });
    }

    return res.json({ success: true, message: 'Notice deleted.' });
  } catch (err) {
    console.error('Notice delete error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

module.exports = router;


