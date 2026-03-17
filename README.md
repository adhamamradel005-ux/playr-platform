# Playr — Athlete Mental Performance Platform

A psychology-first learning platform for footballers. Covers identity, pressure, resilience, flow, and more across 10 structured modules.

**Stack:** Node.js (≥ 22.5) · Express · SQLite (`node:sqlite` built-in) · Vanilla JS

---

## Running locally

```bash
npm install
npm start          # http://localhost:3000
# or
npm run dev        # auto-restarts on file changes (Node 18+)
```

The SQLite database (`playr.db`) is created automatically on first run.

---

## Deploying to Railway (recommended)

Railway is the simplest option because it supports persistent volumes, which means your database survives redeploys.

### 1 — Push your code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create playr-platform --public --source=. --push
# or push to an existing GitHub repo
```

### 2 — Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `playr-platform` repository
4. Railway detects Node automatically and deploys using `npm start`

### 3 — Add a persistent volume (keeps the database alive across redeploys)

1. In your Railway project, click **+ New → Volume**
2. Mount path: `/data`
3. Open your service → **Variables** tab → add:
   ```
   DATABASE_PATH=/data/playr.db
   ```
4. Railway redeploys automatically

### 4 — Get your public URL

Go to your service → **Settings → Networking → Generate Domain**. Your app is live.

---

## Deploying to Render

Render's free tier works but **does not include a persistent disk**, so the SQLite database resets on every redeploy. Use it for demos. For real data, upgrade to a paid plan ($7/month) and add a disk.

### 1 — Push your code to GitHub (same as above)

### 2 — Create a Web Service on Render

1. Go to [render.com](https://render.com) and sign in
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Node version:** set the `NODE_VERSION` environment variable to `22`

### 3 — Add a persistent disk (paid plans only)

1. Go to your service → **Disks → Add Disk**
2. Mount path: `/data`
3. Add environment variable:
   ```
   DATABASE_PATH=/data/playr.db
   ```

### 4 — Get your public URL

Render assigns a `*.onrender.com` URL automatically once the deploy finishes.

---

## Environment variables

| Variable        | Default              | Description                                    |
|-----------------|----------------------|------------------------------------------------|
| `PORT`          | `3000`               | Port the server listens on (set by the platform) |
| `DATABASE_PATH` | `./playr.db`         | Absolute path to the SQLite database file       |

---

## Admin

View waitlist signups:

```
GET /admin/waitlist
```

Returns JSON — open it in a browser or hit it with `curl`:

```bash
curl https://your-app.railway.app/admin/waitlist
```

---

## A note on SQLite in production

SQLite is a single file — simple and zero-config, which is why it works great here. The one constraint is that it lives on the same server as your app, so:

- **Railway with a volume** — fully persistent, works well for low-to-medium traffic
- **Render free tier** — database resets on redeploy; fine for demos, not for real users
- **Scaling later** — if you ever need multiple instances or a hosted database, migrate to [Railway Postgres](https://railway.app/new/template/postgres) or [Supabase](https://supabase.com). The query logic in `server.js` maps directly to Postgres with minimal changes.
