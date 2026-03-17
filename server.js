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

app.get('/admin/waitlist', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, email, created_at FROM waitlist ORDER BY created_at DESC'
  ).all();
  res.json({ count: rows.length, signups: rows });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Playr running → http://localhost:${PORT}`));
