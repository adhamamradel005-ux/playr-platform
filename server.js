import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

const dbPath = process.env.DATABASE_PATH || join(__dirname, 'playr.db');
const db = new DatabaseSync(dbPath);

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, 'playr-platform.html'));
});

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS journal_entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    module_id  INTEGER,
    prompt     TEXT,
    content    TEXT    NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS module_progress (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    module_id  INTEGER NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'done',
    updated_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(user_id, module_id)
  );

  CREATE TABLE IF NOT EXISTS waitlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL UNIQUE,
    created_at DATETIME DEFAULT (datetime('now'))
  );

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

  CREATE TABLE IF NOT EXISTS daily_checkins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    date       TEXT    NOT NULL,
    energy     INTEGER NOT NULL,
    mood       INTEGER NOT NULL,
    focus      INTEGER NOT NULL,
    created_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(user_id, date)
  );
`);

// ── Journal ──

app.post('/api/journal', (req, res) => {
  const { user_id, module_id, prompt, content } = req.body;
  if (!user_id || !content?.trim()) {
    return res.status(400).json({ error: 'user_id and content required' });
  }
  const result = db.prepare(
    'INSERT INTO journal_entries (user_id, module_id, prompt, content) VALUES (?, ?, ?, ?)'
  ).run(user_id, module_id ?? null, prompt ?? null, content.trim());
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/journal', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const entries = db.prepare(
    'SELECT * FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC'
  ).all(user_id);
  res.json(entries);
});

// ── Progress ──

app.post('/api/progress', (req, res) => {
  const { user_id, module_id } = req.body;
  if (!user_id || module_id === undefined) {
    return res.status(400).json({ error: 'user_id and module_id required' });
  }
  db.prepare(`
    INSERT INTO module_progress (user_id, module_id, status)
    VALUES (?, ?, 'done')
    ON CONFLICT(user_id, module_id)
    DO UPDATE SET status = 'done', updated_at = datetime('now')
  `).run(user_id, module_id);
  res.json({ success: true });
});

app.get('/api/progress', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const rows = db.prepare(
    "SELECT module_id FROM module_progress WHERE user_id = ? AND status = 'done'"
  ).all(user_id);
  res.json(rows.map(r => r.module_id));
});

// ── Stats ──

app.get('/api/stats', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const TOTAL = 10;

  const completedCount = db.prepare(
    "SELECT COUNT(*) as c FROM module_progress WHERE user_id = ? AND status = 'done'"
  ).get(user_id).c;

  const overallPct = Math.round((completedCount / TOTAL) * 100);

  const journalCount = db.prepare(
    'SELECT COUNT(*) as c FROM journal_entries WHERE user_id = ?'
  ).get(user_id).c;

  const thisWeekCount = db.prepare(
    "SELECT COUNT(*) as c FROM journal_entries WHERE user_id = ? AND created_at >= datetime('now', '-7 days')"
  ).get(user_id).c;

  // Consecutive-day streak counting backward from today
  const days = db.prepare(`
    SELECT DISTINCT date(created_at) as day FROM journal_entries WHERE user_id = ?
    UNION
    SELECT DISTINCT date(updated_at) as day FROM module_progress WHERE user_id = ?
    ORDER BY day DESC
  `).all(user_id, user_id);

  let streak = 0;
  for (let i = 0; i < days.length; i++) {
    const expected = new Date();
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().split('T')[0];
    if (days[i].day === expectedStr) {
      streak++;
    } else {
      break;
    }
  }

  res.json({ streak, completedCount, overallPct, journalCount, thisWeekCount });
});

// ── Waitlist ──

app.post('/api/waitlist', (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }
  const normalised = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  try {
    db.prepare('INSERT INTO waitlist (email) VALUES (?)').run(normalised);
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      // Already signed up — treat as success so we don't leak whether an email exists
      res.json({ success: true, alreadyRegistered: true });
    } else {
      throw e;
    }
  }
});

// ── Messages ──

app.post('/api/messages', (req, res) => {
  const { conv_id, sender_id, receiver_id, content } = req.body;
  if (!conv_id || !sender_id || !content?.trim()) {
    return res.status(400).json({ error: 'conv_id, sender_id, content required' });
  }
  const result = db.prepare(
    'INSERT INTO messages (conv_id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)'
  ).run(conv_id, sender_id, receiver_id || '', content.trim());
  res.json({ id: result.lastInsertRowid });
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
  const { conv_id, user_id } = req.body;
  if (!conv_id || !user_id) return res.status(400).json({ error: 'conv_id and user_id required' });
  db.prepare(
    'UPDATE messages SET is_read = 1 WHERE conv_id = ? AND receiver_id = ? AND is_read = 0'
  ).run(conv_id, user_id);
  res.json({ success: true });
});

app.get('/api/messages/unread', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const row = db.prepare(
    'SELECT COUNT(*) as c FROM messages WHERE receiver_id = ? AND is_read = 0'
  ).get(user_id);
  res.json({ count: row.c });
});

// ── Location ──

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

// ── Daily Check-ins ──

app.post('/api/checkin', (req, res) => {
  const { user_id, energy, mood, focus } = req.body;
  if (!user_id || energy === undefined || mood === undefined || focus === undefined) {
    return res.status(400).json({ error: 'user_id, energy, mood, focus required' });
  }
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO daily_checkins (user_id, date, energy, mood, focus)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET energy = ?, mood = ?, focus = ?
  `).run(user_id, today, energy, mood, focus, energy, mood, focus);
  res.json({ success: true });
});

app.get('/api/checkin', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const rows = db.prepare(
    "SELECT date, energy, mood, focus FROM daily_checkins WHERE user_id = ? AND date >= date('now', '-30 days') ORDER BY date ASC"
  ).all(user_id);
  res.json(rows);
});

app.get('/admin/waitlist', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, email, created_at FROM waitlist ORDER BY created_at DESC'
  ).all();
  res.json({ count: rows.length, signups: rows });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Playr running → http://localhost:${PORT}`));
