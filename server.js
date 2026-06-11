import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

const dbPath = process.env.DATABASE_PATH || join(__dirname, 'playr.db');
const db = new DatabaseSync(dbPath);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, 'playr-platform.html'));
});

// ════════════════════════════════════════════════
//  SCHEMA
// ════════════════════════════════════════════════
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id        TEXT PRIMARY KEY,
    email          TEXT UNIQUE,
    password_hash  TEXT,
    password_salt  TEXT,
    role           TEXT NOT NULL DEFAULT 'player',
    name           TEXT DEFAULT '',
    position       TEXT DEFAULT '',
    nationality    TEXT DEFAULT '',
    age            INTEGER,
    city           TEXT DEFAULT '',
    country        TEXT DEFAULT '',
    bio            TEXT DEFAULT '',
    avatar_color   TEXT DEFAULT 'linear-gradient(135deg,#6C3EFF,#00FF87)',
    photo_url      TEXT DEFAULT '',
    cover_url      TEXT DEFAULT '',
    open_to_opps   INTEGER NOT NULL DEFAULT 1,
    verified       INTEGER NOT NULL DEFAULT 0,
    stats_json     TEXT DEFAULT '[]',
    career_json    TEXT DEFAULT '[]',
    created_at     DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    type       TEXT DEFAULT 'update',
    content    TEXT DEFAULT '',
    media_url  TEXT DEFAULT '',
    yt_id      TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id    INTEGER NOT NULL,
    user_id    TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS post_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL,
    user_id    TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments(post_id);

  CREATE TABLE IF NOT EXISTS stories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    media_url  TEXT DEFAULT '',
    caption    TEXT DEFAULT '',
    bg         TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at);

  CREATE TABLE IF NOT EXISTS connections (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id TEXT NOT NULL,
    addressee_id TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   DATETIME DEFAULT (datetime('now')),
    UNIQUE(requester_id, addressee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_conn_req ON connections(requester_id);
  CREATE INDEX IF NOT EXISTS idx_conn_addr ON connections(addressee_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    type       TEXT NOT NULL,
    actor_id   TEXT DEFAULT '',
    text       TEXT NOT NULL,
    icon       TEXT DEFAULT '🔔',
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id     TEXT    NOT NULL,
    sender_id   TEXT    NOT NULL,
    receiver_id TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id);
  CREATE INDEX IF NOT EXISTS idx_messages_recv ON messages(receiver_id, is_read);

  CREATE TABLE IF NOT EXISTS user_locations (
    user_id    TEXT PRIMARY KEY,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    city       TEXT DEFAULT '',
    country    TEXT DEFAULT '',
    updated_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS waitlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL UNIQUE,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trial_applications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   TEXT    NOT NULL,
    player_name TEXT    DEFAULT '',
    trial_id    TEXT    NOT NULL,
    trial_title TEXT    DEFAULT '',
    club_id     TEXT    NOT NULL,
    club_name   TEXT    DEFAULT '',
    message     TEXT    DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',
    created_at  DATETIME DEFAULT (datetime('now')),
    updated_at  DATETIME DEFAULT (datetime('now')),
    UNIQUE(player_id, trial_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tapps_player ON trial_applications(player_id);
  CREATE INDEX IF NOT EXISTS idx_tapps_club   ON trial_applications(club_id);

  CREATE TABLE IF NOT EXISTS shortlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scout_id   TEXT    NOT NULL,
    player_id  TEXT    NOT NULL,
    notes      TEXT    DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(scout_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_shortlist_scout ON shortlist(scout_id);
`);

// ════════════════════════════════════════════════
//  AUTH HELPERS
// ════════════════════════════════════════════════
function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const h = scryptSync(pw, salt, 64).toString('hex');
  try { return timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex')); }
  catch { return false; }
}
function newToken() { return randomBytes(24).toString('hex'); }

function tokenFromReq(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.body?.token || req.query?.token || null;
}
function userFromReq(req) {
  const token = tokenFromReq(req);
  if (!token) return null;
  const sess = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!sess) return null;
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(sess.user_id) || null;
}

// Compute a consecutive-day streak from a user's posts (counting back from today)
function streakFor(userId) {
  const days = db.prepare(
    `SELECT DISTINCT date(created_at) AS day FROM posts WHERE user_id = ? ORDER BY day DESC`
  ).all(userId);
  let streak = 0;
  for (let i = 0; i < days.length; i++) {
    const expected = new Date();
    expected.setDate(expected.getDate() - i);
    if (days[i].day === expected.toISOString().split('T')[0]) streak++;
    else break;
  }
  return streak;
}

// Public projection of a user row (no secrets) + live counts
function publicUser(u, viewerId = null) {
  if (!u) return null;
  const connCount = db.prepare(
    `SELECT COUNT(*) c FROM connections WHERE status='accepted' AND (requester_id=? OR addressee_id=?)`
  ).get(u.user_id, u.user_id).c;
  let connStatus = 'none';
  if (viewerId && viewerId !== u.user_id) {
    const c = db.prepare(
      `SELECT requester_id, status FROM connections
       WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)`
    ).get(viewerId, u.user_id, u.user_id, viewerId);
    if (c) {
      if (c.status === 'accepted') connStatus = 'connected';
      else connStatus = c.requester_id === viewerId ? 'sent' : 'received';
    }
  }
  let stats = [], career = [];
  try { stats = JSON.parse(u.stats_json || '[]'); } catch {}
  try { career = JSON.parse(u.career_json || '[]'); } catch {}
  return {
    id: u.user_id, user_id: u.user_id, email: u.email, role: u.role,
    name: u.name || 'New Athlete', position: u.position || '', nationality: u.nationality || '',
    age: u.age || null, city: u.city || '', country: u.country || '',
    bio: u.bio || '', grad: u.avatar_color, avatar_color: u.avatar_color,
    photo: u.photo_url || '', cover: u.cover_url || '',
    open: !!u.open_to_opps, verified: !!u.verified,
    stats, career,
    connections: connCount, views: 0, impressions: 0,
    connStatus, streak: streakFor(u.user_id),
    created_at: u.created_at
  };
}

function addNotif(userId, type, text, icon = '🔔', actorId = '') {
  if (!userId || userId === actorId) return;
  db.prepare(
    'INSERT INTO notifications (user_id, type, actor_id, text, icon) VALUES (?,?,?,?,?)'
  ).run(userId, type, actorId, text, icon);
}

// ════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════
app.post('/api/auth/signup', (req, res) => {
  const { email, password, role, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  const normEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) return res.status(400).json({ error: 'invalid email' });

  const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(normEmail);
  if (existing) return res.status(409).json({ error: 'email_taken' });

  const userId = 'u_' + randomBytes(6).toString('hex');
  const { salt, hash } = hashPassword(password);
  const safeRole = ['player', 'scout', 'coach', 'club'].includes(role) ? role : 'player';
  const displayName = (name && name.trim()) || normEmail.split('@')[0];
  db.prepare(`
    INSERT INTO users (user_id, email, password_hash, password_salt, role, name)
    VALUES (?,?,?,?,?,?)
  `).run(userId, normEmail, hash, salt, safeRole, displayName);

  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, userId);
  const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  res.json({ token, user: publicUser(u, userId) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!u || !verifyPassword(password, u.password_salt, u.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, u.user_id);
  res.json({ token, user: publicUser(u, u.user_id) });
});

app.get('/api/auth/me', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  res.json({ user: publicUser(u, u.user_id) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = tokenFromReq(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ success: true });
});

// ════════════════════════════════════════════════
//  USERS / PROFILES / DIRECTORY
// ════════════════════════════════════════════════
app.get('/api/users', (req, res) => {
  const viewer = userFromReq(req);
  const viewerId = viewer?.user_id || req.query.viewer_id || null;
  let rows;
  if (req.query.role) {
    rows = db.prepare('SELECT * FROM users WHERE role = ? ORDER BY created_at DESC').all(req.query.role);
  } else {
    rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  }
  res.json(rows.map(u => publicUser(u, viewerId)));
});

app.get('/api/users/:id', (req, res) => {
  const viewer = userFromReq(req);
  const viewerId = viewer?.user_id || req.query.viewer_id || null;
  const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json(publicUser(u, viewerId));
});

app.patch('/api/users/:id', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  if (u.user_id !== req.params.id) return res.status(403).json({ error: 'forbidden' });
  const b = req.body;
  const fields = {
    name: b.name, position: b.position, nationality: b.nationality, age: b.age,
    city: b.city, country: b.country, bio: b.bio, avatar_color: b.avatar_color,
    photo_url: b.photo_url ?? b.photo, cover_url: b.cover_url ?? b.cover,
    open_to_opps: b.open === undefined ? undefined : (b.open ? 1 : 0),
    stats_json: b.stats ? JSON.stringify(b.stats) : undefined,
    career_json: b.career ? JSON.stringify(b.career) : undefined,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) db.prepare(`UPDATE users SET ${k} = ? WHERE user_id = ?`).run(v, u.user_id);
  }
  const fresh = db.prepare('SELECT * FROM users WHERE user_id = ?').get(u.user_id);
  res.json(publicUser(fresh, u.user_id));
});

// ════════════════════════════════════════════════
//  POSTS / FEED
// ════════════════════════════════════════════════
function postRow(p, viewerId) {
  return {
    id: p.id, user_id: p.user_id, type: p.type, content: p.content,
    media_url: p.media_url, yt_id: p.yt_id, created_at: p.created_at,
    author_name: p.name, author_role: p.role, author_grad: p.avatar_color,
    author_position: p.position, author_city: p.city, author_country: p.country,
    author_verified: !!p.verified,
    like_count: p.like_count, comment_count: p.comment_count, liked: !!p.liked
  };
}

app.get('/api/posts', (req, res) => {
  const viewer = userFromReq(req);
  const viewerId = viewer?.user_id || req.query.viewer_id || '';
  const params = [viewerId];
  let where = '';
  if (req.query.user_id) { where = 'WHERE p.user_id = ?'; params.push(req.query.user_id); }
  const rows = db.prepare(`
    SELECT p.*, u.name, u.role, u.avatar_color, u.position, u.city, u.country, u.verified,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id) AS like_count,
      (SELECT COUNT(*) FROM post_comments pc WHERE pc.post_id=p.id) AS comment_count,
      (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id=p.id AND pl.user_id=?) AS liked
    FROM posts p JOIN users u ON u.user_id = p.user_id
    ${where}
    ORDER BY p.created_at DESC, p.id DESC LIMIT 100
  `).all(...params);
  res.json(rows.map(p => postRow(p, viewerId)));
});

app.post('/api/posts', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  const { type, content, media_url, yt_id } = req.body;
  if (!content?.trim() && !media_url && !yt_id) return res.status(400).json({ error: 'empty_post' });
  const r = db.prepare(
    'INSERT INTO posts (user_id, type, content, media_url, yt_id) VALUES (?,?,?,?,?)'
  ).run(u.user_id, type || 'update', (content || '').trim(), media_url || '', yt_id || '');
  const row = db.prepare(`
    SELECT p.*, u.name, u.role, u.avatar_color, u.position, u.city, u.country, u.verified,
      0 AS like_count, 0 AS comment_count, 0 AS liked
    FROM posts p JOIN users u ON u.user_id=p.user_id WHERE p.id = ?
  `).get(r.lastInsertRowid);
  res.json(postRow(row, u.user_id));
});

app.post('/api/posts/:id/like', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  const postId = req.params.id;
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  if (!post) return res.status(404).json({ error: 'not_found' });
  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(postId, u.user_id);
  let liked;
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id=? AND user_id=?').run(postId, u.user_id);
    liked = false;
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)').run(postId, u.user_id);
    liked = true;
    addNotif(post.user_id, 'like', `${u.name || 'Someone'} liked your post`, '❤️', u.user_id);
  }
  const count = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id=?').get(postId).c;
  res.json({ liked, count });
});

app.get('/api/posts/:id/comments', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.name AS author_name, u.avatar_color AS author_grad, u.role AS author_role
    FROM post_comments c JOIN users u ON u.user_id=c.user_id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(req.params.id);
  res.json(rows);
});

app.post('/api/posts/:id/comments', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'empty_comment' });
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not_found' });
  const r = db.prepare(
    'INSERT INTO post_comments (post_id, user_id, content) VALUES (?,?,?)'
  ).run(req.params.id, u.user_id, content.trim());
  addNotif(post.user_id, 'comment', `${u.name || 'Someone'} commented on your post`, '💬', u.user_id);
  const row = db.prepare(`
    SELECT c.*, u.name AS author_name, u.avatar_color AS author_grad, u.role AS author_role
    FROM post_comments c JOIN users u ON u.user_id=c.user_id WHERE c.id = ?
  `).get(r.lastInsertRowid);
  res.json(row);
});

// ════════════════════════════════════════════════
//  STORIES (active = last 24h)
// ════════════════════════════════════════════════
app.get('/api/stories', (_req, res) => {
  const rows = db.prepare(`
    SELECT s.*, u.name AS author_name, u.avatar_color AS author_grad, u.role AS author_role
    FROM stories s JOIN users u ON u.user_id = s.user_id
    WHERE s.created_at >= datetime('now', '-1 day')
    ORDER BY s.created_at ASC
  `).all();
  // group by user, preserving order of most-recent activity
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) {
      byUser.set(r.user_id, {
        user_id: r.user_id, name: r.author_name, grad: r.author_grad,
        role: r.author_role, items: []
      });
    }
    byUser.get(r.user_id).items.push({
      id: r.id, media_url: r.media_url, caption: r.caption, bg: r.bg, created_at: r.created_at
    });
  }
  res.json([...byUser.values()]);
});

app.post('/api/stories', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  const { media_url, caption, bg } = req.body;
  if (!media_url && !caption?.trim()) return res.status(400).json({ error: 'empty_story' });
  const r = db.prepare(
    'INSERT INTO stories (user_id, media_url, caption, bg) VALUES (?,?,?,?)'
  ).run(u.user_id, media_url || '', (caption || '').trim(), bg || '');
  res.json({ id: r.lastInsertRowid });
});

// ════════════════════════════════════════════════
//  CONNECTIONS
// ════════════════════════════════════════════════
app.get('/api/connections', (req, res) => {
  const viewer = userFromReq(req);
  const userId = viewer?.user_id || req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const sentRows = db.prepare("SELECT addressee_id FROM connections WHERE requester_id=? AND status='pending'").all(userId);
  const recvRows = db.prepare("SELECT requester_id FROM connections WHERE addressee_id=? AND status='pending'").all(userId);
  const connRows = db.prepare(
    "SELECT requester_id, addressee_id FROM connections WHERE status='accepted' AND (requester_id=? OR addressee_id=?)"
  ).all(userId, userId);
  res.json({
    sent: sentRows.map(r => r.addressee_id),
    received: recvRows.map(r => r.requester_id),
    connected: connRows.map(r => r.requester_id === userId ? r.addressee_id : r.requester_id)
  });
});

app.post('/api/connections', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  const target = req.body.target_id;
  if (!target || target === u.user_id) return res.status(400).json({ error: 'invalid_target' });
  // If they already requested us, accept instead of creating a reverse request
  const reverse = db.prepare(
    "SELECT * FROM connections WHERE requester_id=? AND addressee_id=? AND status='pending'"
  ).get(target, u.user_id);
  if (reverse) {
    db.prepare("UPDATE connections SET status='accepted' WHERE id=?").run(reverse.id);
    addNotif(target, 'connect', `${u.name || 'Someone'} accepted your connection`, '🤝', u.user_id);
    return res.json({ status: 'accepted' });
  }
  try {
    db.prepare("INSERT INTO connections (requester_id, addressee_id, status) VALUES (?,?,'pending')")
      .run(u.user_id, target);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.json({ status: 'exists' });
    throw e;
  }
  addNotif(target, 'connect_req', `${u.name || 'Someone'} wants to connect`, '👋', u.user_id);
  res.json({ status: 'pending' });
});

app.patch('/api/connections', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  const { requester_id, action } = req.body;
  if (!requester_id) return res.status(400).json({ error: 'requester_id required' });
  const row = db.prepare(
    "SELECT * FROM connections WHERE requester_id=? AND addressee_id=? AND status='pending'"
  ).get(requester_id, u.user_id);
  if (!row) return res.status(404).json({ error: 'no_pending_request' });
  if (action === 'accept') {
    db.prepare("UPDATE connections SET status='accepted' WHERE id=?").run(row.id);
    addNotif(requester_id, 'connect', `${u.name || 'Someone'} accepted your connection`, '🤝', u.user_id);
    return res.json({ status: 'accepted' });
  }
  db.prepare('DELETE FROM connections WHERE id=?').run(row.id);
  res.json({ status: 'declined' });
});

app.delete('/api/connections', (req, res) => {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'unauthenticated' });
  const target = req.body.target_id;
  if (!target) return res.status(400).json({ error: 'target_id required' });
  db.prepare(
    'DELETE FROM connections WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)'
  ).run(u.user_id, target, target, u.user_id);
  res.json({ success: true });
});

// ════════════════════════════════════════════════
//  NOTIFICATIONS
// ════════════════════════════════════════════════
app.get('/api/notifications', (req, res) => {
  const viewer = userFromReq(req);
  const userId = viewer?.user_id || req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const rows = db.prepare(
    'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 40'
  ).all(userId);
  const unread = rows.filter(r => !r.is_read).length;
  res.json({ unread, items: rows });
});

app.patch('/api/notifications/read', (req, res) => {
  const u = userFromReq(req);
  const userId = u?.user_id || req.body.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(userId);
  res.json({ success: true });
});

// ════════════════════════════════════════════════
//  MESSAGES  (+ conversations list)
// ════════════════════════════════════════════════
app.get('/api/conversations', (req, res) => {
  const viewer = userFromReq(req);
  const userId = viewer?.user_id || req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const convs = db.prepare(
    `SELECT DISTINCT conv_id FROM messages WHERE sender_id=? OR receiver_id=?`
  ).all(userId, userId);
  const out = [];
  for (const { conv_id } of convs) {
    const last = db.prepare(
      'SELECT * FROM messages WHERE conv_id=? ORDER BY created_at DESC, id DESC LIMIT 1'
    ).get(conv_id);
    if (!last) continue;
    const otherId = last.sender_id === userId ? last.receiver_id : last.sender_id;
    const unread = db.prepare(
      'SELECT COUNT(*) c FROM messages WHERE conv_id=? AND receiver_id=? AND is_read=0'
    ).get(conv_id, userId).c;
    const other = db.prepare('SELECT * FROM users WHERE user_id=?').get(otherId);
    out.push({
      conv_id, other_id: otherId,
      other_name: other?.name || 'Unknown', other_grad: other?.avatar_color || '',
      other_role: other?.role || '',
      last_text: last.content, last_ts: last.created_at,
      last_from_me: last.sender_id === userId, unread
    });
  }
  out.sort((a, b) => (a.last_ts < b.last_ts ? 1 : -1));
  res.json(out);
});

app.post('/api/messages', (req, res) => {
  const u = userFromReq(req);
  let { conv_id, sender_id, receiver_id, content } = req.body;
  if (u) sender_id = u.user_id;
  if (!conv_id || !sender_id || !content?.trim()) {
    return res.status(400).json({ error: 'conv_id, sender_id, content required' });
  }
  const r = db.prepare(
    'INSERT INTO messages (conv_id, sender_id, receiver_id, content) VALUES (?,?,?,?)'
  ).run(conv_id, sender_id, receiver_id || '', content.trim());
  if (receiver_id) {
    const senderName = db.prepare('SELECT name FROM users WHERE user_id=?').get(sender_id)?.name || 'Someone';
    addNotif(receiver_id, 'message', `${senderName} sent you a message`, '✉️', sender_id);
  }
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/messages', (req, res) => {
  const { conv_id } = req.query;
  if (!conv_id) return res.status(400).json({ error: 'conv_id required' });
  const rows = db.prepare(
    'SELECT * FROM messages WHERE conv_id = ? ORDER BY created_at ASC'
  ).all(conv_id);
  res.json(rows);
});

app.patch('/api/messages/read', (req, res) => {
  const u = userFromReq(req);
  const userId = u?.user_id || req.body.user_id;
  const { conv_id } = req.body;
  if (!conv_id || !userId) return res.status(400).json({ error: 'conv_id and user_id required' });
  db.prepare(
    'UPDATE messages SET is_read = 1 WHERE conv_id = ? AND receiver_id = ? AND is_read = 0'
  ).run(conv_id, userId);
  res.json({ success: true });
});

app.get('/api/messages/unread', (req, res) => {
  const viewer = userFromReq(req);
  const userId = viewer?.user_id || req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  const row = db.prepare(
    'SELECT COUNT(*) as c FROM messages WHERE receiver_id = ? AND is_read = 0'
  ).get(userId);
  res.json({ count: row.c });
});

// ════════════════════════════════════════════════
//  LOCATION
// ════════════════════════════════════════════════
app.post('/api/location', (req, res) => {
  const { user_id, lat, lng, city, country } = req.body;
  if (!user_id || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'user_id, lat, lng required' });
  }
  db.prepare(`
    INSERT INTO user_locations (user_id, lat, lng, city, country)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      lat = ?, lng = ?, city = ?, country = ?, updated_at = datetime('now')
  `).run(user_id, lat, lng, city || '', country || '', lat, lng, city || '', country || '');
  res.json({ success: true });
});

app.get('/api/locations', (_req, res) => {
  const rows = db.prepare('SELECT user_id, lat, lng, city, country FROM user_locations').all();
  res.json(rows);
});

// ════════════════════════════════════════════════
//  WAITLIST
// ════════════════════════════════════════════════
app.post('/api/waitlist', (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required' });
  const normalised = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) return res.status(400).json({ error: 'Invalid email address' });
  try {
    db.prepare('INSERT INTO waitlist (email) VALUES (?)').run(normalised);
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') res.json({ success: true, alreadyRegistered: true });
    else throw e;
  }
});

// ════════════════════════════════════════════════
//  TRIAL APPLICATIONS
// ════════════════════════════════════════════════
app.post('/api/trial-applications', (req, res) => {
  const { player_id, player_name, trial_id, trial_title, club_id, club_name, message } = req.body;
  if (!player_id || !trial_id || !club_id) return res.status(400).json({ error: 'player_id, trial_id, club_id required' });
  try {
    const result = db.prepare(`
      INSERT INTO trial_applications (player_id, player_name, trial_id, trial_title, club_id, club_name, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(player_id, player_name || '', trial_id, trial_title || '', club_id, club_name || '', message || '');
    addNotif(club_id, 'trial', `${player_name || 'A player'} applied to ${trial_title || 'your trial'}`, '⚽', player_id);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'already_applied' });
    throw e;
  }
});

app.get('/api/trial-applications', (req, res) => {
  const { player_id, club_id, trial_id } = req.query;
  if (player_id) {
    return res.json(db.prepare('SELECT * FROM trial_applications WHERE player_id = ? ORDER BY created_at DESC').all(player_id));
  }
  if (club_id) {
    let sql = 'SELECT * FROM trial_applications WHERE club_id = ?';
    const params = [club_id];
    if (trial_id) { sql += ' AND trial_id = ?'; params.push(trial_id); }
    sql += ' ORDER BY created_at DESC';
    return res.json(db.prepare(sql).all(...params));
  }
  res.status(400).json({ error: 'player_id or club_id required' });
});

app.patch('/api/trial-applications/:id', (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'accepted', 'declined', 'saved'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
  const appRow = db.prepare('SELECT * FROM trial_applications WHERE id=?').get(req.params.id);
  db.prepare("UPDATE trial_applications SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  if (appRow && (status === 'accepted' || status === 'declined')) {
    addNotif(appRow.player_id, 'trial', `Your application to ${appRow.trial_title || 'a trial'} was ${status}`, '⚽', appRow.club_id);
  }
  res.json({ success: true });
});

// ════════════════════════════════════════════════
//  SHORTLIST
// ════════════════════════════════════════════════
app.post('/api/shortlist', (req, res) => {
  const { scout_id, player_id, notes } = req.body;
  if (!scout_id || !player_id) return res.status(400).json({ error: 'scout_id and player_id required' });
  db.prepare(`
    INSERT INTO shortlist (scout_id, player_id, notes) VALUES (?, ?, ?)
    ON CONFLICT(scout_id, player_id) DO UPDATE SET notes = COALESCE(?, notes)
  `).run(scout_id, player_id, notes || '', notes ?? null);
  res.json({ success: true });
});

app.delete('/api/shortlist', (req, res) => {
  const { scout_id, player_id } = req.body;
  if (!scout_id || !player_id) return res.status(400).json({ error: 'scout_id and player_id required' });
  db.prepare('DELETE FROM shortlist WHERE scout_id = ? AND player_id = ?').run(scout_id, player_id);
  res.json({ success: true });
});

app.get('/api/shortlist', (req, res) => {
  const { scout_id } = req.query;
  if (!scout_id) return res.status(400).json({ error: 'scout_id required' });
  const rows = db.prepare('SELECT player_id, notes, created_at FROM shortlist WHERE scout_id = ? ORDER BY created_at DESC').all(scout_id);
  res.json(rows);
});

app.patch('/api/shortlist/notes', (req, res) => {
  const { scout_id, player_id, notes } = req.body;
  if (!scout_id || !player_id) return res.status(400).json({ error: 'scout_id and player_id required' });
  db.prepare('UPDATE shortlist SET notes = ? WHERE scout_id = ? AND player_id = ?').run(notes || '', scout_id, player_id);
  res.json({ success: true });
});

app.get('/admin/waitlist', (_req, res) => {
  const rows = db.prepare('SELECT id, email, created_at FROM waitlist ORDER BY created_at DESC').all();
  res.json({ count: rows.length, signups: rows });
});

// ════════════════════════════════════════════════
//  DEMO SEED (only when there are no users yet)
// ════════════════════════════════════════════════
function seedDemoData() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return;
  console.log('Seeding demo data…');

  const demo = [
    { id: 'kai_mensah', name: 'Kai Mensah', role: 'player', position: 'Winger', nat: 'Ghana', age: 19, city: 'Manchester', country: 'England', grad: 'linear-gradient(135deg,#00FF87,#00C9A7)', bio: 'Left winger. Pace and end product. Open to trials in the UK & Europe.', verified: 1,
      stats: [{label:'Pace',value:'92'},{label:'Goals',value:'14'},{label:'Assists',value:'11'},{label:'Apps',value:'27'}],
      career: [{club:'City Academy U21',period:'2023–now'},{club:'Trafford Youth',period:'2021–2023'}] },
    { id: 'amara_toure', name: 'Amara Touré', role: 'player', position: 'Striker', nat: 'Senegal', age: 21, city: 'Lyon', country: 'France', grad: 'linear-gradient(135deg,#FF6B6B,#FFD93D)', bio: 'Number 9. Strong in the air, clinical finisher.', verified: 0,
      stats: [{label:'Goals',value:'22'},{label:'Pace',value:'84'},{label:'Apps',value:'30'},{label:'Mins',value:'2540'}],
      career: [{club:'OL Réserves',period:'2022–now'}] },
    { id: 'marcus_diallo', name: 'Marcus Diallo', role: 'player', position: 'Centre-Back', nat: 'Belgium', age: 20, city: 'Brussels', country: 'Belgium', grad: 'linear-gradient(135deg,#6C3EFF,#00C9FF)', bio: 'Ball-playing centre-back. Calm under pressure.', verified: 1,
      stats: [{label:'Tackles',value:'78'},{label:'Aerial',value:'88'},{label:'Pass%',value:'91'},{label:'Apps',value:'25'}],
      career: [{club:'Anderlecht U21',period:'2023–now'}] },
    { id: 'sarah_okonkwo', name: 'Sarah Okonkwo', role: 'player', position: 'Midfielder', nat: 'Nigeria', age: 18, city: 'London', country: 'England', grad: 'linear-gradient(135deg,#FF8A00,#FF2D92)', bio: "Box-to-box midfielder. Women's football. Engine that never stops.", verified: 1,
      stats: [{label:'Pass%',value:'89'},{label:'Goals',value:'9'},{label:'Assists',value:'13'},{label:'Apps',value:'28'}],
      career: [{club:'Arsenal WFC Academy',period:'2022–now'}] },
    { id: 'rayan_bouzid', name: 'Rayan Bouzid', role: 'player', position: 'Goalkeeper', nat: 'Morocco', age: 22, city: 'Madrid', country: 'Spain', grad: 'linear-gradient(135deg,#00C9A7,#6C3EFF)', bio: 'Shot-stopper with quick distribution. Sweeper-keeper.', verified: 0,
      stats: [{label:'Saves',value:'120'},{label:'Clean',value:'11'},{label:'Pass%',value:'82'},{label:'Apps',value:'26'}],
      career: [{club:'Getafe B',period:'2023–now'}] },
    { id: 'scout_bennett', name: 'David Bennett', role: 'scout', nat: 'England', city: 'London', country: 'England', grad: 'linear-gradient(135deg,#1E90FF,#00C9A7)', bio: 'Senior scout. Tracking wingers and forwards across UK & West Africa.', verified: 1,
      stats: [], career: [{club:'Independent Scout Network',period:'2018–now'}] },
    { id: 'coach_silva', name: 'Marco Silva', role: 'coach', nat: 'Portugal', city: 'Porto', country: 'Portugal', grad: 'linear-gradient(135deg,#FFD93D,#FF6B6B)', bio: 'UEFA A licence coach. Developing technical youth players.', verified: 1,
      stats: [], career: [{club:'FC Porto Youth',period:'2019–now'}] },
    { id: 'fc_velocity', name: 'FC Velocity Academy', role: 'club', nat: 'Netherlands', city: 'Amsterdam', country: 'Netherlands', grad: 'linear-gradient(135deg,#FF2D92,#6C3EFF)', bio: 'Elite youth academy. Trials open for the 2026 season.', verified: 1,
      stats: [], career: [{club:'Eredivisie Youth League',period:'Founded 2015'}] },
  ];

  const insU = db.prepare(`
    INSERT INTO users (user_id, email, password_hash, password_salt, role, name, position, nationality, age, city, country, bio, avatar_color, verified, stats_json, career_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const d of demo) {
    const { salt, hash } = hashPassword('demo1234');
    insU.run(d.id, d.id + '@playr.demo', hash, salt, d.role, d.name, d.position || '', d.nat || '',
      d.age || null, d.city || '', d.country || '', d.bio || '', d.grad, d.verified || 0,
      JSON.stringify(d.stats || []), JSON.stringify(d.career || []));
  }

  const insP = db.prepare('INSERT INTO posts (user_id, type, content, media_url, created_at) VALUES (?,?,?,?,?)');
  const t = (mins) => `datetime('now', '-${mins} minutes')`;
  const posts = [
    ['kai_mensah','update','Two goals and an assist in today\'s academy derby. Buzzing. 🔥⚽','',45],
    ['amara_toure','achievement','Signed my first professional contract today. Hard work pays off. 🙏','',180],
    ['sarah_okonkwo','update','Pre-season fitness numbers are up across the board. Putting in the work.','',300],
    ['marcus_diallo','update','Clean sheet number 11 this season. Defence wins titles.','',600],
    ['scout_bennett','update','Watching three U21 fixtures this weekend. The talent coming through is unreal.','',90],
    ['fc_velocity','trial','📢 Trial day announced — 14 March, Amsterdam. Outfield players & keepers, born 2006–2008. Apply now.','',1440],
    ['rayan_bouzid','update','Penalty saved in the 89th to keep the win. Heart rate still recovering. 🧤','',1500],
  ];
  for (const [uid, type, content, media, mins] of posts) {
    db.prepare(`INSERT INTO posts (user_id, type, content, media_url, created_at) VALUES (?,?,?,?, ${t(mins)})`)
      .run(uid, type, content, media);
  }

  // a few likes & comments for life
  const allPosts = db.prepare('SELECT id, user_id FROM posts').all();
  const likers = ['kai_mensah','amara_toure','marcus_diallo','sarah_okonkwo','scout_bennett'];
  for (const p of allPosts) {
    likers.filter(l => l !== p.user_id).slice(0, 3).forEach(l => {
      try { db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)').run(p.id, l); } catch {}
    });
  }
  if (allPosts[0]) db.prepare('INSERT INTO post_comments (post_id, user_id, content) VALUES (?,?,?)')
    .run(allPosts[0].id, 'scout_bennett', 'Been tracking you — keep this up. 👀');

  // stories (within 24h)
  const insS = db.prepare(`INSERT INTO stories (user_id, caption, bg, created_at) VALUES (?,?,?, datetime('now', '-' || ? || ' minutes'))`);
  insS.run('kai_mensah', 'Matchday ⚽', 'linear-gradient(135deg,#00FF87,#00C9A7)', 30);
  insS.run('amara_toure', 'Contract signed ✍️', 'linear-gradient(135deg,#FF6B6B,#FFD93D)', 120);
  insS.run('sarah_okonkwo', 'Gym session 💪', 'linear-gradient(135deg,#FF8A00,#FF2D92)', 200);
  insS.run('fc_velocity', 'Trials open!', 'linear-gradient(135deg,#FF2D92,#6C3EFF)', 400);

  // some accepted connections among demo players
  const conn = db.prepare("INSERT INTO connections (requester_id, addressee_id, status) VALUES (?,?,?)");
  conn.run('kai_mensah','amara_toure','accepted');
  conn.run('kai_mensah','sarah_okonkwo','accepted');
  conn.run('marcus_diallo','kai_mensah','accepted');

  console.log(`Seeded ${demo.length} users, ${posts.length} posts, 4 stories.`);
}
seedDemoData();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Playr running → http://localhost:${PORT}`));
