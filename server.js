// ============================================================
// UWAT Website Server
// Runs the website, saves registrations, and serves the admin
// dashboard. Start it with:  npm start
//
// Database:
//  - On your computer: saves to the file uwat.db (automatic)
//  - Online (Render):  uses the free Neon Postgres database
//    when the DATABASE_URL setting is present
// ============================================================
const express = require('express');
const path = require('path');
const crypto = require('crypto');

// ---------- SETTINGS (change the password here!) ----------
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'uwat@2026'; // <-- CHANGE THIS
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'uwat.db');
// -----------------------------------------------------------

// ---------- Database (works with SQLite locally, Postgres online) ----------
// query(sql, params) always returns an array of rows.
let query;
let dbReady;

if (process.env.DATABASE_URL) {
  // ----- Online: Neon Postgres -----
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  query = async (sql, params = []) => {
    let i = 0;
    const text = sql.replace(/\?/g, () => '$' + (++i));
    return (await pool.query(text, params)).rows;
  };
  dbReady = query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      gender TEXT,
      phone TEXT NOT NULL,
      residence TEXT,
      email TEXT,
      house_no TEXT,
      district TEXT,
      region TEXT,
      spouse_name TEXT,
      spouse_residence TEXT,
      spouse_phone TEXT,
      heir_name TEXT,
      heir_residence TEXT,
      heir_phone TEXT,
      last_park TEXT,
      retire_date TEXT,
      signature TEXT,
      status TEXT DEFAULT 'Inasubiri',
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    )
  `);
  console.log('Database: online Postgres (Neon)');
} else {
  // ----- Local: SQLite file -----
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH);
  query = async (sql, params = []) => {
    const stmt = db.prepare(sql);
    return /^\s*select/i.test(sql) ? stmt.all(...params) : (stmt.run(...params), []);
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      gender TEXT,
      phone TEXT NOT NULL,
      residence TEXT,
      email TEXT,
      house_no TEXT,
      district TEXT,
      region TEXT,
      spouse_name TEXT,
      spouse_residence TEXT,
      spouse_phone TEXT,
      heir_name TEXT,
      heir_residence TEXT,
      heir_phone TEXT,
      last_park TEXT,
      retire_date TEXT,
      signature TEXT,
      status TEXT DEFAULT 'Inasubiri',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  dbReady = Promise.resolve();
  console.log('Database: local file ' + DB_PATH);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Small helper so a database error never crashes the server
const safe = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Hitilafu ya seva. Jaribu tena baadaye.' });
  }
};

// ---------- Admin login cookie helpers ----------
function makeToken() {
  const expires = Date.now() + 12 * 60 * 60 * 1000; // valid 12 hours
  const sig = crypto.createHmac('sha256', SECRET).update(String(expires)).digest('hex');
  return `${expires}.${sig}`;
}

function isLoggedIn(req) {
  const cookie = (req.headers.cookie || '')
    .split(';').map(c => c.trim()).find(c => c.startsWith('uwat_admin='));
  if (!cookie) return false;
  const [expires, sig] = cookie.slice('uwat_admin='.length).split('.');
  if (!expires || !sig || Date.now() > Number(expires)) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(expires).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Haujaingia. Tafadhali ingia kwanza.' });
  next();
}

// ---------- Public: save a registration ----------
app.post('/api/register', safe(async (req, res) => {
  const b = req.body || {};
  const clean = v => (typeof v === 'string' ? v.trim().slice(0, 300) : '');
  const required = ['first_name', 'last_name', 'phone', 'district', 'region', 'heir_name', 'last_park', 'retire_date', 'signature'];
  for (const f of required) {
    if (!clean(b[f])) return res.status(400).json({ error: 'Sehemu muhimu hazijajazwa.' });
  }
  await query(`
    INSERT INTO registrations (
      first_name, middle_name, last_name, gender, phone, residence, email,
      house_no, district, region, spouse_name, spouse_residence, spouse_phone,
      heir_name, heir_residence, heir_phone, last_park, retire_date, signature
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    clean(b.first_name), clean(b.middle_name), clean(b.last_name), clean(b.gender),
    clean(b.phone), clean(b.residence), clean(b.email), clean(b.house_no),
    clean(b.district), clean(b.region), clean(b.spouse_name), clean(b.spouse_residence),
    clean(b.spouse_phone), clean(b.heir_name), clean(b.heir_residence), clean(b.heir_phone),
    clean(b.last_park), clean(b.retire_date), clean(b.signature)
  ]);
  res.json({ ok: true });
}));

// ---------- Admin: login / logout ----------
app.post('/api/admin/login', (req, res) => {
  const given = String((req.body || {}).password || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Nenosiri si sahihi.' });
  }
  res.setHeader('Set-Cookie', `uwat_admin=${makeToken()}; HttpOnly; Path=/; Max-Age=${12 * 60 * 60}; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'uwat_admin=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => res.json({ loggedIn: isLoggedIn(req) }));

// ---------- Admin: view / manage registrations ----------
app.get('/api/admin/registrations', requireAdmin, safe(async (req, res) => {
  const rows = await query('SELECT * FROM registrations ORDER BY id DESC');
  res.json(rows);
}));

app.patch('/api/admin/registrations/:id', requireAdmin, safe(async (req, res) => {
  const status = String((req.body || {}).status || '');
  const allowed = ['Inasubiri', 'Imekubaliwa', 'Imekataliwa'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Hali si sahihi.' });
  await query('UPDATE registrations SET status = ? WHERE id = ?', [status, Number(req.params.id)]);
  res.json({ ok: true });
}));

app.delete('/api/admin/registrations/:id', requireAdmin, safe(async (req, res) => {
  await query('DELETE FROM registrations WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- Admin: export to Excel (CSV) ----------
app.get('/api/admin/export.csv', requireAdmin, safe(async (req, res) => {
  const rows = await query('SELECT * FROM registrations ORDER BY id');
  const headers = ['ID', 'Jina la Kwanza', 'Jina la Kati', 'Jina la Ukoo', 'Jinsia', 'Simu', 'Makazi',
    'Barua Pepe', 'Namba ya Nyumba', 'Kijiji/Mtaa/Wilaya', 'Mkoa', 'Jina la Mwenza', 'Makazi ya Mwenza',
    'Simu ya Mwenza', 'Jina la Mrithi', 'Makazi ya Mrithi', 'Simu ya Mrithi', 'Hifadhi ya Mwisho',
    'Tarehe ya Kustaafu', 'Saini', 'Hali', 'Tarehe ya Maombi'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) {
    lines.push([r.id, r.first_name, r.middle_name, r.last_name, r.gender, r.phone, r.residence,
      r.email, r.house_no, r.district, r.region, r.spouse_name, r.spouse_residence,
      r.spouse_phone, r.heir_name, r.heir_residence, r.heir_phone, r.last_park,
      r.retire_date, r.signature, r.status, r.created_at].map(esc).join(','));
  }
  // The ﻿ marker (BOM) makes Excel open Swahili characters correctly
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="usajili-uwat.csv"');
  res.send('﻿' + lines.join('\r\n'));
}));

// ---------- Admin page ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

dbReady.then(() => {
  app.listen(PORT, () => {
    console.log(`UWAT website running at http://localhost:${PORT}`);
    console.log(`Admin dashboard:        http://localhost:${PORT}/admin`);
  });
}).catch(err => {
  console.error('Database connection failed:', err.message);
  process.exit(1);
});
