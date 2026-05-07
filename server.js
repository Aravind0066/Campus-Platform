require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./config/db');

const authRoutes = require('./routes/auth');
const resourcesRoutes = require('./routes/resources');
const postsRoutes = require('./routes/posts');
const noticesRoutes = require('./routes/notices');
const adminRoutes = require('./routes/admin');
const notificationsRoutes = require('./routes/notifications');
const {
  markSessionInactive,
  touchUserSession,
  validateSessionBinding
} = require('./services/session-security');
const { startEmailNoticeSyncJob } = require('./services/email-sync');

const app = express();
const publicDir = path.join(__dirname, 'public');
const pwaDir = path.join(publicDir, 'pwa');
const pageOverridesDir = path.join(__dirname, 'pages');
const assetOverridesDir = path.join(__dirname, 'app-assets');
const overriddenPages = [
  'index.html',
  'login.html',
  'community.html',
  'add-post.html',
  'admin.html',
  'noticeboard.html',
  'post-details.html',
  'profile.html',
  'resource-details.html',
  'resources.html'
];
const publicPagePaths = new Set(['/', '/index.html', '/login.html']);
const guestOnlyPagePaths = new Set(['/login.html']);
const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 24 * 60 * 60 * 1000
};

function isAuthenticated(req) {
  return Boolean(req.session?.user?.id);
}

function buildLoginRedirectTarget(req) {
  const nextPath = req.originalUrl && req.originalUrl !== '/login.html'
    ? `?next=${encodeURIComponent(req.originalUrl)}`
    : '';

  return `/login.html${nextPath}`;
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.redirect(buildLoginRedirectTarget(req));
  }

  return next();
}

function requireGuestPage(req, res, next) {
  if (isAuthenticated(req)) {
    return res.redirect('/');
  }

  return next();
}

function clearSessionCookie(res) {
  res.clearCookie('campus.sid', {
    httpOnly: sessionCookieOptions.httpOnly,
    sameSite: sessionCookieOptions.sameSite,
    secure: sessionCookieOptions.secure
  });
}

function isHtmlPageRequest(req) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return false;
  }

  const requestPath = req.path.toLowerCase();
  return requestPath === '/' || requestPath.endsWith('.html');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'campus.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: sessionCookieOptions
}));

app.use(async (req, res, next) => {
  if (!req.session?.user?.id || !req.sessionID) {
    return next();
  }

  try {
    const validation = await validateSessionBinding(req);
    if (!validation.valid) {
      await markSessionInactive(req.sessionID);
      if (req.session) {
        delete req.session.user;
        delete req.session.browserFingerprint;
        delete req.session._lastTouchedAt;
      }
      req.session.destroy(() => {});
      clearSessionCookie(res);

      if (req.path.startsWith('/api')) {
        return res.status(401).json({
          success: false,
          message: validation.message || 'Session expired. Please log in again.'
        });
      }

      if (req.path.toLowerCase() === '/login.html') {
        return next();
      }

      return res.redirect(buildLoginRedirectTarget(req));
    }

    const now = Date.now();
    const lastTouchedAt = req.session._lastTouchedAt || 0;
    if (now - lastTouchedAt > 60 * 1000) {
      req.session._lastTouchedAt = now;
      setImmediate(async () => {
        try {
          await touchUserSession(req.sessionID);
        } catch (err) {
          // Ignore session touch errors.
        }
      });
    }

    return next();
  } catch (err) {
    console.error('Session validation error:', err.message);
    if (req.path.startsWith('/api')) {
      return res.status(500).json({ success: false, message: 'Session validation failed.' });
    }

    return res.redirect('/login.html');
  }
});

app.use((req, res, next) => {
  if (!isHtmlPageRequest(req)) {
    return next();
  }

  const requestPath = req.path.toLowerCase();
  if (guestOnlyPagePaths.has(requestPath)) {
    return requireGuestPage(req, res, next);
  }

  if (publicPagePaths.has(requestPath)) {
    return next();
  }

  return requireAuth(req, res, next);
});

app.use('/api/auth', authRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/notices', noticesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);

app.use('/app-assets', express.static(assetOverridesDir));

app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(pwaDir, 'manifest.webmanifest'));
});

app.get('/offline.html', (req, res) => {
  res.sendFile(path.join(pwaDir, 'offline.html'));
});

app.get('/service-worker.js', (req, res) => {
  res.set('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile(path.join(pwaDir, 'service-worker.js'));
});

overriddenPages.forEach((pageName) => {
  const routePath = `/${pageName}`;
  app.get(routePath, (req, res) => {
    res.sendFile(path.join(pageOverridesDir, pageName));
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(pageOverridesDir, 'index.html'));
});

app.use(express.static(publicDir));

app.get('/api/dashboard/overview', async (req, res) => {
  try {
    const audienceVisibility = req.session?.user?.role === 'admin'
      ? ['all', 'students', 'faculty', 'staff']
      : ['all', 'students'];
    const placeholders = audienceVisibility.map(() => '?').join(', ');

    const [resourceSummaryRows] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN is_open = 1 THEN 1 ELSE 0 END) AS open_count
       FROM resources`
    );
    const [postSummaryRows] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN type = 'query' THEN 1 ELSE 0 END) AS query_count,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count
       FROM posts
       WHERE (type <> 'update' OR expires_at IS NULL OR expires_at > NOW())`
    );
    const [noticeSummaryRows] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN source_type = 'email' THEN 1 ELSE 0 END) AS email_count,
              SUM(CASE WHEN priority = 'emergency' THEN 1 ELSE 0 END) AS emergency_count
       FROM notices
       WHERE (expires_at IS NULL OR expires_at > NOW())
         AND target_audience IN (${placeholders})`,
      audienceVisibility
    );
    const [recentPosts] = await db.query(
      `SELECT p.id, p.title, p.type, p.priority, p.created_at,
              u.name AS author_name,
              COALESCE(c.name, 'General') AS category
       FROM posts p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE (p.type <> 'update' OR p.expires_at IS NULL OR p.expires_at > NOW())
       ORDER BY p.created_at DESC
       LIMIT 4`
    );
    const [recentNotices] = await db.query(
      `SELECT n.id, n.title, n.priority, n.source_type, n.created_at,
              COALESCE(c.name, 'Uncategorized') AS category
       FROM notices n
       LEFT JOIN categories c ON c.id = n.category_id
       WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
         AND n.target_audience IN (${placeholders})
       ORDER BY n.is_pinned DESC, n.created_at DESC
       LIMIT 4`,
      audienceVisibility
    );

    return res.json({
      success: true,
      data: {
        resources: {
          total: resourceSummaryRows[0]?.total || 0,
          open: resourceSummaryRows[0]?.open_count || 0
        },
        community: {
          total: postSummaryRows[0]?.total || 0,
          queries: postSummaryRows[0]?.query_count || 0,
          resolved: postSummaryRows[0]?.resolved_count || 0
        },
        notices: {
          total: noticeSummaryRows[0]?.total || 0,
          email: noticeSummaryRows[0]?.email_count || 0,
          emergency: noticeSummaryRows[0]?.emergency_count || 0
        },
        recentPosts: recentPosts || [],
        recentNotices: recentNotices || []
      }
    });
  } catch (err) {
    console.error('Dashboard overview error:', err);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

app.get('/api', (req, res) => {
  res.json({ message: 'Campus Platform API', status: 'ok' });
});

startEmailNoticeSyncJob();

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

