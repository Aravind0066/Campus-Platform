const express = require('express');
const router = express.Router();
const db = require('../config/db');

function requireAuth(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ success: false, message: 'Please log in.' });
  }

  return next();
}

router.use(requireAuth);

const DEFAULT_POST_CATEGORIES = ['Classroom', 'Library', 'WiFi', 'Hostel', 'Transport', 'Other'];

async function getOrCreateCategoryId(categoryName, type) {
  if (!categoryName) return null;
  const name = categoryName.trim();
  if (!name) return null;

  const [existing] = await db.query('SELECT id FROM categories WHERE name = ? AND type = ?', [name, type]);
  if (existing && existing.length > 0) return existing[0].id;

  try {
    const [result] = await db.query('INSERT INTO categories (name, type, is_active) VALUES (?, ?, 1)', [name, type]);
    return result.insertId;
  } catch (e) {
    const [rows2] = await db.query('SELECT id FROM categories WHERE name = ? AND type = ?', [name, type]);
    return rows2 && rows2.length ? rows2[0].id : null;
  }
}

async function ensureDefaultPostCategories() {
  for (const name of DEFAULT_POST_CATEGORIES) {
    await getOrCreateCategoryId(name, 'post');
  }
}

async function getPostVisibilityClause(includeExpired = false) {
  if (includeExpired) {
    return '1=1';
  }

  return "(p.type <> 'update' OR p.expires_at IS NULL OR p.expires_at > NOW())";
}

async function fetchPostById(id, options = {}) {
  const visibility = await getPostVisibilityClause(Boolean(options.includeExpired));
  const [rows] = await db.query(
    `
    SELECT p.id, p.user_id, p.type, p.title, p.body, p.priority, p.expires_at,
           p.status, p.view_count, p.created_at, p.updated_at,
           u.name AS author_name, u.email AS author_email,
           c.name AS category, c.color AS category_color, c.icon AS category_icon,
           COALESCE(reply_stats.reply_count, 0) AS reply_count,
           COALESCE(reply_stats.accepted_reply_count, 0) AS accepted_reply_count
    FROM posts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN (
      SELECT post_id,
             COUNT(*) AS reply_count,
             SUM(CASE WHEN is_accepted = 1 THEN 1 ELSE 0 END) AS accepted_reply_count
      FROM post_replies
      GROUP BY post_id
    ) reply_stats ON reply_stats.post_id = p.id
    WHERE p.id = ? AND ${visibility}
    LIMIT 1
    `,
    [id]
  );

  return rows?.[0] || null;
}

router.get('/categories', async (req, res) => {
  try {
    await ensureDefaultPostCategories();
    const [rows] = await db.query(
      `SELECT name, color, icon
       FROM categories
       WHERE type = 'post' AND is_active = 1
       ORDER BY name ASC`
    );

    return res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('Post categories error:', err);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    let sql = `
      SELECT p.id, p.user_id, p.type, p.title, p.body, p.priority, p.expires_at,
             p.status, p.view_count, p.created_at,
             u.name AS author_name, u.email AS author_email,
             c.name AS category, c.color AS category_color, c.icon AS category_icon,
             COALESCE(reply_stats.reply_count, 0) AS reply_count,
             COALESCE(reply_stats.accepted_reply_count, 0) AS accepted_reply_count
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN (
        SELECT post_id,
               COUNT(*) AS reply_count,
               SUM(CASE WHEN is_accepted = 1 THEN 1 ELSE 0 END) AS accepted_reply_count
        FROM post_replies
        GROUP BY post_id
      ) reply_stats ON reply_stats.post_id = p.id
      WHERE 1=1
        AND (p.type <> 'update' OR p.expires_at IS NULL OR p.expires_at > NOW())
    `;
    const params = [];

    if (req.query.type) {
      sql += ' AND p.type = ?';
      params.push(req.query.type);
    }
    if (req.query.category) {
      sql += ' AND c.name = ?';
      params.push(req.query.category);
    }
    if (req.query.search) {
      sql += ' AND (p.title LIKE ? OR p.body LIKE ?)';
      const term = '%' + req.query.search.trim() + '%';
      params.push(term, term);
    }

    sql += ' ORDER BY p.created_at DESC';

    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('Posts list error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { type, title, body, category, priority, expires_at } = req.body || {};

    if (!type || !title || !body) {
      return res.status(400).json({ success: false, message: 'Type, title and body required.' });
    }
    if (!['update', 'query'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be update or query.' });
    }

    const userId = req.session.user.id;
    const pri = (priority && ['normal', 'important', 'urgent'].includes(priority)) ? priority : 'normal';
    const categoryId = await getOrCreateCategoryId(category, 'post');

    let exp = null;
    if (type === 'update' && expires_at) {
      if (typeof expires_at === 'string' && expires_at.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        exp = expires_at;
      } else {
        const date = new Date(expires_at);
        if (!isNaN(date.getTime())) {
          const pad = (n) => String(n).padStart(2, '0');
          exp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        }
      }
    }

    const [result] = await db.query(
      'INSERT INTO posts (user_id, category_id, type, title, body, priority, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, categoryId, type, title.trim(), body.trim(), pri, exp]
    );

    res.json({ success: true, message: 'Post created.', id: result.insertId });
  } catch (err) {
    console.error('Post create error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.put('/:id/expiry', async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (isNaN(postId)) return res.status(400).json({ success: false, message: 'Invalid post id.' });

    const hoursRaw = req.body?.hours;
    const hours = typeof hoursRaw === 'string' ? parseInt(hoursRaw, 10) : hoursRaw;
    const allowedHours = [1, 4, 24];
    if (!allowedHours.includes(hours)) {
      return res.status(400).json({ success: false, message: 'hours must be one of: 1, 4, 24' });
    }

    const [posts] = await db.query(
      'SELECT id, user_id, type FROM posts WHERE id = ? LIMIT 1',
      [postId]
    );

    if (!posts || posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];
    const isOwner = post.user_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ success: false, message: 'Not allowed.' });

    if (post.type !== 'update') {
      return res.status(400).json({ success: false, message: 'Expiry can only be updated for update posts.' });
    }

    const d = new Date(Date.now() + hours * 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const exp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    await db.query('UPDATE posts SET expires_at = ?, status = ? WHERE id = ?', [exp, 'open', postId]);
    return res.json({ success: true, message: 'Expiry updated.' });
  } catch (err) {
    console.error('Expiry update error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [rows] = await db.query(
      `SELECT
         SUM(CASE WHEN type = 'update' THEN 1 ELSE 0 END) AS updates,
         SUM(CASE WHEN type = 'query' THEN 1 ELSE 0 END) AS queries
       FROM posts
       WHERE user_id = ?`,
      [userId]
    );

    const updates = Number(rows[0]?.updates || 0);
    const queries = Number(rows[0]?.queries || 0);
    const total = updates + queries;

    res.json({
      success: true,
      data: {
        updates,
        queries,
        total
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid post id.' });

    const post = await fetchPostById(id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    setImmediate(async () => {
      try {
        await db.query('UPDATE posts SET view_count = view_count + 1 WHERE id = ?', [id]);
      } catch (e) {
        // Ignore view count errors.
      }
    });

    res.json({ success: true, data: post });
  } catch (err) {
    console.error('Post get error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.get('/:id/replies', async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (isNaN(postId)) return res.status(400).json({ success: false, message: 'Invalid post id.' });

    const post = await fetchPostById(postId);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const [rows] = await db.query(
      `
      SELECT r.id, r.post_id, r.user_id, r.reply_text, r.is_accepted, r.is_helpful, r.created_at,
             u.name AS author_name, u.email AS author_email
      FROM post_replies r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.post_id = ?
      ORDER BY r.is_accepted DESC, r.created_at ASC
      `,
      [postId]
    );

    res.json({ success: true, data: rows || [] });
  } catch (err) {
    console.error('Replies list error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.post('/:id/replies', async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const { reply_text } = req.body || {};
    if (isNaN(postId)) return res.status(400).json({ success: false, message: 'Invalid post id.' });
    if (!reply_text || !reply_text.trim()) return res.status(400).json({ success: false, message: 'Reply text required.' });

    const post = await fetchPostById(postId);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const userId = req.session.user.id;
    const [result] = await db.query(
      'INSERT INTO post_replies (post_id, user_id, reply_text) VALUES (?, ?, ?)',
      [postId, userId, reply_text.trim()]
    );

    if (post.status === 'resolved') {
      await db.query('UPDATE posts SET status = ? WHERE id = ?', ['open', postId]);
    }

    res.json({ success: true, message: 'Reply added.', id: result.insertId });
  } catch (err) {
    console.error('Reply create error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

router.put('/:postId/replies/:replyId/accept', async (req, res) => {
  try {
    const postId = parseInt(req.params.postId, 10);
    const replyId = parseInt(req.params.replyId, 10);
    if (isNaN(postId) || isNaN(replyId)) return res.status(400).json({ success: false, message: 'Invalid id.' });

    const [posts] = await db.query('SELECT id, user_id FROM posts WHERE id = ? LIMIT 1', [postId]);
    if (!posts || posts.length === 0) return res.status(404).json({ success: false, message: 'Post not found.' });

    const post = posts[0];
    const isOwner = post.user_id === req.session.user.id;
    const isAdmin = req.session.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ success: false, message: 'Not allowed.' });

    const [replies] = await db.query('SELECT id FROM post_replies WHERE id = ? AND post_id = ? LIMIT 1', [replyId, postId]);
    if (!replies || replies.length === 0) return res.status(404).json({ success: false, message: 'Reply not found.' });

    await db.query('UPDATE post_replies SET is_accepted = 0 WHERE post_id = ?', [postId]);
    await db.query('UPDATE post_replies SET is_accepted = 1 WHERE id = ? AND post_id = ?', [replyId, postId]);
    await db.query('UPDATE posts SET status = ? WHERE id = ?', ['resolved', postId]);

    res.json({ success: true, message: 'Reply accepted.' });
  } catch (err) {
    console.error('Accept reply error:', err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

module.exports = router;
