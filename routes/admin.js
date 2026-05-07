const express = require('express');
const router = express.Router();
const db = require('../config/db');

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

router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [userCount] = await db.query('SELECT COUNT(*) as count FROM users');
    const [adminCount] = await db.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
    const [studentCount] = await db.query("SELECT COUNT(*) as count FROM users WHERE role = 'student'");
    const [activeUsers] = await db.query("SELECT COUNT(*) as count FROM users WHERE status = 'active'");
    const [suspendedUsers] = await db.query("SELECT COUNT(*) as count FROM users WHERE status = 'suspended'");

    const [postCount] = await db.query('SELECT COUNT(*) as count FROM posts');
    const [updateCount] = await db.query("SELECT COUNT(*) as count FROM posts WHERE type = 'update'");
    const [queryCount] = await db.query("SELECT COUNT(*) as count FROM posts WHERE type = 'query'");

    const [resourceCount] = await db.query('SELECT COUNT(*) as count FROM resources');
    const [noticeCount] = await db.query('SELECT COUNT(*) as count FROM notices');

    const [recentPosts] = await db.query(`
      SELECT COUNT(*) as count FROM posts
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    const [recentUsers] = await db.query(`
      SELECT COUNT(*) as count FROM users
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);

    res.json({
      success: true,
      data: {
        users: {
          total: userCount[0]?.count || 0,
          admins: adminCount[0]?.count || 0,
          students: studentCount[0]?.count || 0,
          active: activeUsers[0]?.count || 0,
          suspended: suspendedUsers[0]?.count || 0
        },
        posts: {
          total: postCount[0]?.count || 0,
          updates: updateCount[0]?.count || 0,
          queries: queryCount[0]?.count || 0
        },
        resources: resourceCount[0]?.count || 0,
        notices: noticeCount[0]?.count || 0,
        recent: {
          posts: recentPosts[0]?.count || 0,
          users: recentUsers[0]?.count || 0
        }
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
             (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as post_count
      FROM users u
      ORDER BY u.created_at DESC
    `);

    res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('Admin users list error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.put('/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role } = req.body || {};

    if (isNaN(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id.' });
    }

    if (!['student', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role must be student or admin.' });
    }

    if (userId === req.session.user.id && role !== 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot demote yourself.' });
    }

    if (role === 'admin') {
      const [admins] = await db.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
      const adminCount = admins[0]?.count || 0;
      const [targetRows] = await db.query('SELECT role FROM users WHERE id = ? LIMIT 1', [userId]);
      const targetRole = targetRows[0]?.role;

      const alreadyAdmin = targetRole === 'admin';
      if (!alreadyAdmin && adminCount >= 1) {
        return res.status(400).json({
          success: false,
          message: 'Only one admin is allowed. Demote the existing admin first.'
        });
      }
    }

    await db.query('UPDATE users SET role = ? WHERE id = ?', [role, userId]);

    res.json({ success: true, message: 'User role updated.' });
  } catch (err) {
    console.error('Admin update role error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.put('/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { status } = req.body || {};

    if (isNaN(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id.' });
    }

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active, inactive, or suspended.' });
    }

    if (userId === req.session.user.id && status !== 'active') {
      return res.status(400).json({ success: false, message: 'You cannot disable your own admin account.' });
    }

    const [result] = await db.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({ success: true, message: 'User status updated.' });
  } catch (err) {
    console.error('Admin update status error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);

    if (isNaN(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id.' });
    }

    if (userId === req.session.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete yourself.' });
    }

    const [target] = await db.query('SELECT role FROM users WHERE id = ? LIMIT 1', [userId]);
    if (target && target.length && target[0].role === 'admin') {
      const [admins] = await db.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
      const adminCount = admins[0]?.count || 0;
      if (adminCount <= 1) {
        return res.status(400).json({ success: false, message: 'Cannot delete the only admin account.' });
      }
    }

    await db.query('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.get('/buildings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, code, name, location, description, status, created_at, updated_at
       FROM buildings
       ORDER BY name ASC`
    );
    return res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('Admin buildings list error:', err);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.post('/buildings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code, name, location, description, status } = req.body || {};
    const cleanCode = String(code || '').trim();
    const cleanName = String(name || '').trim();
    if (!cleanCode || !cleanName) {
      return res.status(400).json({ success: false, message: 'Building code and name are required.' });
    }

    const cleanStatus = ['active', 'maintenance', 'closed'].includes(String(status || '').toLowerCase())
      ? String(status).toLowerCase()
      : 'active';

    await db.query(
      `INSERT INTO buildings (code, name, location, description, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        cleanCode,
        cleanName,
        String(location || '').trim() || null,
        String(description || '').trim() || null,
        cleanStatus
      ]
    );

    return res.json({ success: true, message: 'Building created.' });
  } catch (err) {
    console.error('Admin building create error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Could not create building.' });
  }
});

router.put('/buildings/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid building id.' });
    }

    const { code, name, location, description, status } = req.body || {};
    const cleanCode = String(code || '').trim();
    const cleanName = String(name || '').trim();
    if (!cleanCode || !cleanName) {
      return res.status(400).json({ success: false, message: 'Building code and name are required.' });
    }

    const cleanStatus = ['active', 'maintenance', 'closed'].includes(String(status || '').toLowerCase())
      ? String(status).toLowerCase()
      : 'active';

    const [result] = await db.query(
      `UPDATE buildings
       SET code = ?, name = ?, location = ?, description = ?, status = ?
       WHERE id = ?`,
      [
        cleanCode,
        cleanName,
        String(location || '').trim() || null,
        String(description || '').trim() || null,
        cleanStatus,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Building not found.' });
    }

    return res.json({ success: true, message: 'Building updated.' });
  } catch (err) {
    console.error('Admin building update error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Could not update building.' });
  }
});

router.delete('/buildings/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid building id.' });
    }

    const [result] = await db.query('DELETE FROM buildings WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Building not found.' });
    }

    return res.json({ success: true, message: 'Building deleted.' });
  } catch (err) {
    console.error('Admin building delete error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Could not delete building.' });
  }
});

module.exports = router;
