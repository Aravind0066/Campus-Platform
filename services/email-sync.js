const crypto = require('crypto');
const tls = require('tls');
const cron = require('node-cron');
const db = require('../config/db');

const MAX_FETCH_PER_SYNC = Math.max(parseInt(process.env.EMAIL_SYNC_FETCH_LIMIT || '15', 10), 1);
const LOOKBACK_DAYS = Math.max(parseInt(process.env.EMAIL_SYNC_LOOKBACK_DAYS || '7', 10), 1);
// Default to every minute. Sync execution is still guarded by syncJobRunning.
const DEFAULT_SYNC_CRON = process.env.EMAIL_SYNC_CRON || '*/1 * * * *';
const DEFAULT_CATEGORY_NAME = process.env.NOTICE_EMAIL_CATEGORY || 'Email Notices';
const DEFAULT_KEYWORDS = normalizeCsv(
  process.env.NOTICE_EMAIL_DEFAULT_KEYWORDS || 'notice,announcement,circular,update,event,exam,deadline,schedule,holiday'
);
const TOPIC_RULES = [
  { name: 'Examinations', keywords: ['exam', 'assessment', 'quiz', 'midsem', 'endsem', 'hall ticket', 'invigilation'] },
  { name: 'Placements', keywords: ['placement', 'internship', 'interview', 'recruitment', 'career', 'coding round'] },
  { name: 'Academics', keywords: ['class', 'course', 'faculty', 'attendance', 'academic', 'lab', 'assignment', 'timetable'] },
  { name: 'Events', keywords: ['event', 'workshop', 'seminar', 'hackathon', 'club', 'fest', 'competition'] },
  { name: 'Campus Services', keywords: ['hostel', 'transport', 'bus', 'cafeteria', 'mess', 'library', 'wifi'] }
];

const PROVIDER_PRESETS = {
  'gmail.com': { host: 'imap.gmail.com', port: 993, secure: true },
  'googlemail.com': { host: 'imap.gmail.com', port: 993, secure: true },
  'outlook.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'hotmail.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'live.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'office365.com': { host: 'outlook.office365.com', port: 993, secure: true },
  'vitstudent.ac.in': {
    host: process.env.VIT_IMAP_HOST || 'outlook.office365.com',
    port: parseInt(process.env.VIT_IMAP_PORT || '993', 10),
    secure: process.env.VIT_IMAP_SECURE !== 'false'
  },
  'vit.ac.in': {
    host: process.env.VIT_IMAP_HOST || 'outlook.office365.com',
    port: parseInt(process.env.VIT_IMAP_PORT || '993', 10),
    secure: process.env.VIT_IMAP_SECURE !== 'false'
  }
};

let syncJobStarted = false;
let syncJobRunning = false;

function normalizeCsv(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(items.map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function getEncryptionKey() {
  const seed = process.env.EMAIL_SYNC_SECRET || process.env.SESSION_SECRET || 'campus-platform-email-sync';
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(payload) {
  if (!payload) return '';
  const [ivRaw, tagRaw, dataRaw] = String(payload).split(':');
  if (!ivRaw || !tagRaw || !dataRaw) return '';
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivRaw, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function detectProviderFromEmail(emailAddress) {
  const domain = String(emailAddress || '').split('@')[1]?.toLowerCase();
  return domain ? PROVIDER_PRESETS[domain] || null : null;
}

function resolveImapConfig(account) {
  const preset = detectProviderFromEmail(account.email_address || account.emailAddress || '');
  return {
    host: account.imap_host || account.imapHost || preset?.host || null,
    port: parseInt(account.imap_port || account.imapPort || preset?.port || '993', 10),
    secure: typeof account.imap_secure !== 'undefined'
      ? Boolean(Number(account.imap_secure)) || account.imap_secure === true
      : typeof account.imapSecure !== 'undefined'
        ? Boolean(account.imapSecure)
        : preset?.secure !== false,
    username: account.imap_username || account.imapUsername || account.email_address || account.emailAddress || ''
  };
}

function imapQuote(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatImapDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function extractLiteral(raw) {
  const match = raw.match(/\{(\d+)\}\r\n/);
  if (!match) return '';
  const length = parseInt(match[1], 10);
  const start = match.index + match[0].length;
  return raw.slice(start, start + length);
}

function parseSearchResponse(raw) {
  const line = raw.match(/\* SEARCH\s*([^\r\n]*)/i);
  if (!line || !line[1]) return [];
  return line[1].trim().split(/\s+/).filter(Boolean);
}

function decodeMimeWords(value) {
  return String(value || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g, (_, charset, encoding, text) => {
    try {
      let buffer;
      if (encoding.toUpperCase() === 'B') {
        buffer = Buffer.from(text, 'base64');
      } else {
        const qp = text.replace(/_/g, ' ').replace(/=([A-Fa-f0-9]{2})/g, (match, hex) => {
          return String.fromCharCode(parseInt(hex, 16));
        });
        buffer = Buffer.from(qp, 'binary');
      }

      const normalized = String(charset || '').toLowerCase();
      if (normalized.includes('utf-8')) return buffer.toString('utf8');
      return buffer.toString('latin1');
    } catch (err) {
      return text;
    }
  });
}

function parseHeaders(rawHeaders) {
  const lines = String(rawHeaders || '').split(/\r\n/);
  const headers = {};
  let currentKey = null;

  for (const line of lines) {
    if (!line) continue;

    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] = `${headers[currentKey]} ${line.trim()}`.trim();
      continue;
    }

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    currentKey = line.slice(0, separator).trim().toLowerCase();
    headers[currentKey] = decodeMimeWords(line.slice(separator + 1).trim());
  }

  return headers;
}

function parseSender(fromHeader) {
  const decoded = decodeMimeWords(fromHeader || '');
  const angleMatch = decoded.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].replace(/"/g, '').trim(),
      email: angleMatch[2].trim().toLowerCase()
    };
  }

  const emailMatch = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    return {
      name: decoded.replace(emailMatch[0], '').replace(/[()]/g, '').trim(),
      email: emailMatch[0].toLowerCase()
    };
  }

  return { name: decoded.trim(), email: '' };
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function decodeQuotedPrintable(text) {
  return String(text || '')
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function splitMimeMessage(raw) {
  const source = String(raw || '');
  const match = source.match(/\r?\n\r?\n/);
  if (!match) {
    return { headers: {}, body: source };
  }

  const index = match.index;
  const separatorLength = match[0].length;
  return {
    headers: parseHeaders(source.slice(0, index)),
    body: source.slice(index + separatorLength)
  };
}

function decodeTransferBody(body, transferEncoding) {
  const encoding = String(transferEncoding || '').toLowerCase();
  const rawBody = String(body || '');

  if (encoding.includes('base64')) {
    try {
      const compact = rawBody.replace(/[^A-Za-z0-9+/=]/g, '');
      return Buffer.from(compact, 'base64').toString('utf8');
    } catch (err) {
      return rawBody;
    }
  }

  if (encoding.includes('quoted-printable')) {
    return decodeQuotedPrintable(rawBody);
  }

  return rawBody;
}

function extractMimeText(raw, depth = 0) {
  if (depth > 4) return String(raw || '');

  const { headers, body } = splitMimeMessage(raw);
  const contentType = String(headers['content-type'] || 'text/plain').toLowerCase();
  const transferEncoding = headers['content-transfer-encoding'] || '';

  if (contentType.includes('multipart/')) {
    const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
    if (boundaryMatch?.[1]) {
      const boundary = boundaryMatch[1];
      const parts = body
        .split(new RegExp(`--${boundary}(?:--)?`, 'g'))
        .map((part) => part.trim())
        .filter(Boolean);

      const plainPart = parts.find((part) => /content-type:\s*text\/plain/i.test(part));
      const htmlPart = parts.find((part) => /content-type:\s*text\/html/i.test(part));
      const candidate = plainPart || htmlPart || parts[0] || '';
      return extractMimeText(candidate, depth + 1);
    }
  }

  return decodeTransferBody(body, transferEncoding);
}

function cleanBodySnippet(body) {
  const decoded = extractMimeText(body);
  const stripped = decodeHtmlEntities(
    String(decoded || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/=\r?\n/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.slice(0, 1200);
}

function inferPriority(subject, body) {
  const text = `${subject || ''} ${body || ''}`.toLowerCase();
  if (/(emergency|immediate|urgent|critical|alert)/.test(text)) return 'emergency';
  if (/(important|deadline|mandatory|exam|interview|placement)/.test(text)) return 'important';
  return 'normal';
}

function buildNoticeBody(message) {
  const senderLabel = message.senderName || message.senderEmail || 'Unknown sender';
  const receivedAt = message.receivedAt
    ? new Date(message.receivedAt).toLocaleString('en-IN', { hour12: true })
    : 'Unknown time';
  const preview = message.preview || 'No preview available from the synced email.';

  return `Imported from email\nFrom: ${senderLabel}${message.senderEmail ? ` (${message.senderEmail})` : ''}\nReceived: ${receivedAt}\n\n${preview}`;
}

function matchesNoticeCandidate(message, account) {
  const allowlist = normalizeCsv(account.sender_allowlist || account.senderAllowlist);
  const keywords = normalizeCsv(account.keyword_filters || account.keywordFilters);
  const effectiveKeywords = keywords.length ? keywords : DEFAULT_KEYWORDS;
  const sender = String(message.senderEmail || '').toLowerCase();
  const blob = `${message.subject || ''} ${message.preview || ''}`.toLowerCase();

  const senderMatches = !allowlist.length || allowlist.some((entry) => {
    return sender === entry || sender.endsWith(`@${entry.replace(/^@/, '')}`) || sender.includes(entry);
  });

  const keywordMatches = !effectiveKeywords.length || effectiveKeywords.some((keyword) => blob.includes(keyword));
  return senderMatches && keywordMatches;
}

function classifyNoticeTopic(subject, body) {
  const blob = `${subject || ''} ${body || ''}`.toLowerCase();
  const match = TOPIC_RULES.find((topic) => topic.keywords.some((keyword) => blob.includes(keyword)));
  return match?.name || DEFAULT_CATEGORY_NAME;
}

async function getOrCreateEmailCategoryId(categoryName = DEFAULT_CATEGORY_NAME) {
  const [existing] = await db.query(
    'SELECT id FROM categories WHERE name = ? AND type = ? LIMIT 1',
    [categoryName, 'notice']
  );

  if (existing?.length) return existing[0].id;

  const [result] = await db.query(
    'INSERT INTO categories (name, type, description, color, is_active) VALUES (?, ?, ?, ?, 1)',
    [categoryName, 'notice', 'Imported notices from connected email accounts', '#2563eb']
  );

  return result.insertId;
}

class SimpleImapClient {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.buffer = '';
    this.pending = null;
    this.commandCounter = 0;
    this.greetingResolver = null;
    this.greetingRejecter = null;
  }

  handleData(chunk) {
    this.buffer += chunk.toString('utf8');

    if (this.greetingResolver && this.buffer.includes('\r\n')) {
      const resolver = this.greetingResolver;
      this.greetingResolver = null;
      this.greetingRejecter = null;
      resolver();
    }

    this.maybeResolvePending();
  }

  maybeResolvePending() {
    if (!this.pending) return;

    const matcher = new RegExp(`(?:^|\\r\\n)${this.pending.tag} (OK|NO|BAD)(?: [^\\r\\n]*)?\\r\\n`, 'i');
    const match = matcher.exec(this.buffer);
    if (!match) return;

    const end = match.index + match[0].length;
    const raw = this.buffer.slice(0, end);
    this.buffer = this.buffer.slice(end);

    const current = this.pending;
    this.pending = null;
    clearTimeout(current.timer);

    if (String(match[1]).toUpperCase() !== 'OK') {
      current.reject(new Error(`IMAP command failed: ${raw.trim()}`));
      return;
    }

    current.resolve(raw);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: this.config.host,
          port: this.config.port,
          rejectUnauthorized: process.env.NODE_ENV === 'production'
        },
        () => {}
      );

      this.socket = socket;
      socket.setEncoding('utf8');
      socket.setTimeout(15000, () => reject(new Error('IMAP connection timed out')));
      socket.on('data', (chunk) => this.handleData(chunk));
      socket.on('error', reject);
      socket.on('close', () => {
        if (this.pending) {
          this.pending.reject(new Error('IMAP connection closed unexpectedly'));
          this.pending = null;
        }
      });

      this.greetingResolver = resolve;
      this.greetingRejecter = reject;
    });
  }

  async send(command) {
    if (!this.socket) throw new Error('IMAP socket not connected');
    if (this.pending) throw new Error('IMAP client already has a pending command');

    const tag = `A${String(++this.commandCounter).padStart(4, '0')}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.tag === tag) {
          this.pending = null;
          reject(new Error(`IMAP command timed out: ${command}`));
        }
      }, 15000);

      this.pending = { tag, resolve, reject, timer };
      this.socket.write(`${tag} ${command}\r\n`);
      this.maybeResolvePending();
    });
  }

  async login(username, password) {
    return this.send(`LOGIN ${imapQuote(username)} ${imapQuote(password)}`);
  }

  async selectInbox() {
    return this.send('SELECT INBOX');
  }

  async uidSearchSince(date) {
    return this.send(`UID SEARCH SINCE ${formatImapDate(date)}`);
  }

  async fetchHeaders(uid) {
    const raw = await this.send(`UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])`);
    return extractLiteral(raw);
  }

  async fetchText(uid) {
    const raw = await this.send(`UID FETCH ${uid} (BODY.PEEK[TEXT]<0.4096>)`);
    return extractLiteral(raw);
  }

  async logout() {
    try {
      await this.send('LOGOUT');
    } catch (err) {
      return null;
    }
    return null;
  }

  close() {
    try {
      this.socket?.destroy();
    } catch (err) {
      return null;
    }
    return null;
  }
}

async function verifyImapConnection(settings) {
  const config = resolveImapConfig(settings);
  if (!config.host || !config.port || !config.username) {
    throw new Error('IMAP host, port, and username are required.');
  }

  const password = settings.appPassword || settings.password || settings.decryptedPassword;
  if (!password) throw new Error('Email app password is required for inbox sync.');

  const client = new SimpleImapClient(config);
  try {
    await client.connect();
    await client.login(config.username, password);
    await client.selectInbox();
  } finally {
    await client.logout();
    client.close();
  }
}

async function getEmailAccountByUser(userId) {
  const [rows] = await db.query(
    'SELECT * FROM email_notice_accounts WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return rows?.[0] || null;
}

function toSafeAccount(account) {
  if (!account) return null;
  const config = resolveImapConfig(account);
  return {
    id: account.id,
    emailAddress: account.email_address,
    imapHost: account.imap_host || config.host || '',
    imapPort: config.port || 993,
    imapSecure: config.secure,
    imapUsername: account.imap_username || config.username || account.email_address,
    senderAllowlist: normalizeCsv(account.sender_allowlist).join(', '),
    keywordFilters: normalizeCsv(account.keyword_filters).join(', '),
    isActive: Boolean(account.is_active),
    lastSyncedAt: account.last_synced_at,
    lastError: account.last_error,
    hasPassword: Boolean(account.encrypted_password)
  };
}

async function saveEmailAccount({ userId, payload }) {
  const existing = await getEmailAccountByUser(userId);
  const emailAddress = String(payload.emailAddress || existing?.email_address || '').trim().toLowerCase();
  if (!emailAddress) throw new Error('Email address is required.');

  const config = resolveImapConfig({
    ...existing,
    email_address: emailAddress,
    imap_host: payload.imapHost || existing?.imap_host,
    imap_port: payload.imapPort || existing?.imap_port,
    imap_secure: typeof payload.imapSecure === 'undefined' ? existing?.imap_secure : payload.imapSecure,
    imap_username: payload.imapUsername || existing?.imap_username || emailAddress
  });

  const password = String(payload.appPassword || '').trim();
  const decryptedPassword = password || (existing?.encrypted_password ? decryptSecret(existing.encrypted_password) : '');
  if (!decryptedPassword) {
    throw new Error('Enter an email app password before enabling notice sync.');
  }

  await verifyImapConnection({
    emailAddress,
    imapHost: config.host,
    imapPort: config.port,
    imapSecure: config.secure,
    imapUsername: config.username,
    decryptedPassword
  });

  const encryptedPassword = password ? encryptSecret(password) : existing.encrypted_password;
  const senderAllowlist = normalizeCsv(payload.senderAllowlist).join(',');
  const keywordFilters = normalizeCsv(payload.keywordFilters).join(',');
  const isActive = typeof payload.isActive === 'undefined' ? true : Boolean(payload.isActive);

  if (existing) {
    await db.query(
      `UPDATE email_notice_accounts
       SET email_address = ?, imap_host = ?, imap_port = ?, imap_secure = ?, imap_username = ?,
           encrypted_password = ?, sender_allowlist = ?, keyword_filters = ?, is_active = ?,
           last_error = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [
        emailAddress,
        config.host,
        config.port,
        config.secure ? 1 : 0,
        config.username,
        encryptedPassword,
        senderAllowlist || null,
        keywordFilters || null,
        isActive ? 1 : 0,
        userId
      ]
    );
  } else {
    await db.query(
      `INSERT INTO email_notice_accounts
       (user_id, email_address, imap_host, imap_port, imap_secure, imap_username, encrypted_password, sender_allowlist, keyword_filters, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        emailAddress,
        config.host,
        config.port,
        config.secure ? 1 : 0,
        config.username,
        encryptedPassword,
        senderAllowlist || null,
        keywordFilters || null,
        isActive ? 1 : 0
      ]
    );
  }

  return getEmailAccountByUser(userId);
}

async function importEmailNotice(account, message) {
  const [existingByUid] = await db.query(
    'SELECT id FROM email_notice_imports WHERE account_id = ? AND message_uid = ? LIMIT 1',
    [account.id, message.uid]
  );
  if (existingByUid?.length) return null;

  if (message.messageId) {
    const [existingByMessageId] = await db.query(
      'SELECT id FROM email_notice_imports WHERE account_id = ? AND message_id = ? LIMIT 1',
      [account.id, message.messageId]
    );
    if (existingByMessageId?.length) return null;
  }

  const categoryId = await getOrCreateEmailCategoryId(classifyNoticeTopic(message.subject, message.preview));
  const priority = inferPriority(message.subject, message.preview);
  const [noticeResult] = await db.query(
    `INSERT INTO notices
     (created_by, category_id, title, body, priority, target_audience, source_type, source_ref, source_sender_name, source_sender_email)
     VALUES (?, ?, ?, ?, ?, 'all', 'email', ?, ?, ?)`,
    [
      account.user_id,
      categoryId,
      message.subject || 'Imported notice',
      buildNoticeBody(message),
      priority,
      message.messageId || String(message.uid),
      message.senderName || null,
      message.senderEmail || null
    ]
  );

  await db.query(
    `INSERT INTO email_notice_imports
     (account_id, user_id, notice_id, message_uid, message_id, sender_name, sender_email, subject, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
      account.user_id,
      noticeResult.insertId,
      String(message.uid),
      message.messageId || null,
      message.senderName || null,
      message.senderEmail || null,
      message.subject || 'Imported notice',
      message.receivedAt || null
    ]
  );

  return noticeResult.insertId;
}

async function syncEmailNoticeAccount(account) {
  const config = resolveImapConfig(account);
  const password = decryptSecret(account.encrypted_password);
  if (!password) throw new Error('Stored email credentials could not be decrypted.');

  const client = new SimpleImapClient(config);
  const lookbackDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const importedNoticeIds = [];
  let scannedCount = 0;
  let matchedCount = 0;

  try {
    await client.connect();
    await client.login(config.username, password);
    await client.selectInbox();

    const searchRaw = await client.uidSearchSince(lookbackDate);
    const uids = parseSearchResponse(searchRaw).slice(-MAX_FETCH_PER_SYNC).reverse();

    for (const uid of uids) {
      scannedCount += 1;
      const headerText = await client.fetchHeaders(uid);
      const headers = parseHeaders(headerText);
      const sender = parseSender(headers.from || '');
      const preview = cleanBodySnippet(await client.fetchText(uid));

      const message = {
        uid,
        subject: headers.subject || 'Imported notice',
        senderName: sender.name,
        senderEmail: sender.email,
        messageId: (headers['message-id'] || '').trim(),
        receivedAt: headers.date ? new Date(headers.date) : null,
        preview
      };

      if (!matchesNoticeCandidate(message, account)) {
        continue;
      }

      matchedCount += 1;
      const noticeId = await importEmailNotice(account, message);
      if (noticeId) importedNoticeIds.push(noticeId);
    }

    await db.query(
      'UPDATE email_notice_accounts SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?',
      [account.id]
    );

    return {
      importedCount: importedNoticeIds.length,
      matchedCount,
      scannedCount,
      noticeIds: importedNoticeIds
    };
  } catch (err) {
    await db.query(
      'UPDATE email_notice_accounts SET last_error = ? WHERE id = ?',
      [err.message.slice(0, 1000), account.id]
    );
    throw err;
  } finally {
    await client.logout();
    client.close();
  }
}

async function syncEmailNoticeAccountByUser(userId) {
  const account = await getEmailAccountByUser(userId);
  if (!account) throw new Error('Connect an email account before syncing notices.');
  return syncEmailNoticeAccount(account);
}

function startEmailNoticeSyncJob() {
  if (syncJobStarted || process.env.ENABLE_EMAIL_NOTICE_SYNC === 'false') return;
  if (!cron.validate(DEFAULT_SYNC_CRON)) {
    console.warn(`Skipping email sync job: invalid cron expression "${DEFAULT_SYNC_CRON}"`);
    return;
  }

  syncJobStarted = true;
  cron.schedule(DEFAULT_SYNC_CRON, async () => {
    if (syncJobRunning) return;
    syncJobRunning = true;

    try {
      const [accounts] = await db.query('SELECT * FROM email_notice_accounts WHERE is_active = 1');
      for (const account of accounts || []) {
        try {
          await syncEmailNoticeAccount(account);
        } catch (err) {
          console.error(`Email notice sync failed for ${account.email_address}:`, err.message);
        }
      }
    } catch (err) {
      console.error('Email notice sync job failed:', err.message);
    } finally {
      syncJobRunning = false;
    }
  });
}

module.exports = {
  getEmailAccountByUser,
  saveEmailAccount,
  startEmailNoticeSyncJob,
  syncEmailNoticeAccountByUser,
  toSafeAccount
};

