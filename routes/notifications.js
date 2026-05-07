const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
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

// Email transporter setup (configure in .env)
let transporter = null;

if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

/**
 * POST /api/notifications/send-notice
 * Sends email notification to all users when a notice is created (admin only)
 */
router.post('/send-notice', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { noticeId, title, body, priority } = req.body || {};
    
    if (!noticeId || !title || !body) {
      return res.status(400).json({ success: false, message: 'Notice details required.' });
    }

    if (!transporter) {
      console.warn('Email not configured. Skipping email notification.');
      return res.json({ success: true, message: 'Notice created (email not configured).' });
    }

    // Get all user emails
    const [users] = await db.query("SELECT email, name FROM users WHERE email IS NOT NULL AND status = 'active'");
    
    if (!users || users.length === 0) {
      return res.json({ success: true, message: 'No users to notify.' });
    }

    const priorityLabel = priority === 'emergency' ? ' EMERGENCY' : 
                          priority === 'important' ? ' IMPORTANT' : ' Notice';

    const recipientEmails = users.map((user) => user.email).filter(Boolean);
    const mailOptions = {
      from: `"Campus Platform" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      bcc: recipientEmails.join(', '),
      subject: `${priorityLabel}: ${title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">${title}</h2>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="color: #666; line-height: 1.6;">${body.replace(/\n/g, '<br>')}</p>
          </div>
          <p style="color: #999; font-size: 12px;">
            This is an automated notification from Campus Platform.<br>
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/noticeboard.html">View on Noticeboard</a>
          </p>
        </div>
      `,
      text: `${title}\n\n${body}\n\nView on Noticeboard: ${process.env.APP_URL || 'http://localhost:3000'}/noticeboard.html`
    };

    // Send to all users

    await transporter.sendMail(mailOptions);

    console.log(`Email notification sent to ${recipientEmails.length} users for notice: ${title}`);

    res.json({ success: true, message: `Notification sent to ${recipientEmails.length} users.` });
  } catch (err) {
    console.error('Email notification error:', err);
    res.status(500).json({ success: false, message: 'Failed to send notifications: ' + err.message });
  }
});

module.exports = router;



