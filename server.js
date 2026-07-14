// ============================================================
// UWAT Website Server
// Runs the website, saves registrations, and serves the admin
// dashboard. Start it with:  npm start
//
// Accounts:
//  - Super admin: username/password come from settings below
//    (or Render environment variables). Can manage everything,
//    including creating/removing normal admins.
//  - Normal admins: stored in the database, created by the
//    super admin from the dashboard.
//
// Database:
//  - On your computer: saves to the file uwat.db (automatic)
//  - Online (Render):  uses the free Neon Postgres database
//    when the DATABASE_URL setting is present
// ============================================================
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

// ---------- SETTINGS ----------
const PORT = process.env.PORT || 3000;
// Super admin username: only lowercase letters, numbers and _ (no dots/spaces)
const SUPER_USER = (process.env.SUPER_ADMIN_USER || 'superadmin').toLowerCase();
// Super admin password: set SUPER_ADMIN_PASSWORD on Render (falls back to the
// older ADMIN_PASSWORD setting so existing deployments keep working)
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'uwat@2026';
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'uwat.db');
// ------------------------------

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
  // Tables are created one by one — Neon's connection pooler
  // does not accept several commands in a single query.
  dbReady = (async () => {
    await pool.query(`
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
    )`);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    )`);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      username TEXT,
      action TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    )`);
  })();
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
    );
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      action TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
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

// ---------- Password hashing (for normal admins) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + '$' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  try { return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test); }
  catch { return false; }
}

function sameText(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- Activity log ----------
async function logAction(username, action) {
  try { await query('INSERT INTO activity_log (username, action) VALUES (?, ?)', [username, action]); }
  catch (err) { console.error('log failed:', err.message); }
}

// ---------- Login cookie helpers ----------
// Session lasts 30 minutes without activity. Every authenticated
// request refreshes it ("sliding" session), so active admins stay in.
const SESSION_MINUTES = 30;

// Cookie value: expires.username.role.signature
function makeToken(username, role) {
  const expires = Date.now() + SESSION_MINUTES * 60 * 1000;
  const sig = crypto.createHmac('sha256', SECRET)
    .update(`${expires}|${username}|${role}`).digest('hex');
  return `${expires}.${username}.${role}.${sig}`;
}

function readToken(req) {
  const cookie = (req.headers.cookie || '')
    .split(';').map(c => c.trim()).find(c => c.startsWith('uwat_admin='));
  if (!cookie) return null;
  const parts = cookie.slice('uwat_admin='.length).split('.');
  if (parts.length !== 4) return null;
  const [expires, username, role, sig] = parts;
  if (Date.now() > Number(expires)) return null;
  const expected = crypto.createHmac('sha256', SECRET)
    .update(`${expires}|${username}|${role}`).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  return { username, role };
}

function setLoginCookie(res, username, role) {
  res.setHeader('Set-Cookie',
    `uwat_admin=${makeToken(username, role)}; HttpOnly; Path=/; Max-Age=${SESSION_MINUTES * 60}; SameSite=Lax`);
}

// Any logged-in admin. Also re-checks that a normal admin still exists,
// so removed admins lose access immediately.
async function authAdmin(req, res, next) {
  const user = readToken(req);
  if (!user) return res.status(401).json({ error: 'Haujaingia. Tafadhali ingia kwanza.' });
  if (user.role === 'admin') {
    const rows = await query('SELECT id FROM admins WHERE username = ?', [user.username]);
    if (!rows.length) return res.status(401).json({ error: 'Akaunti yako imeondolewa.' });
  }
  req.admin = user;
  setLoginCookie(res, user.username, user.role); // refresh the 30-minute session
  next();
}

function authSuper(req, res, next) {
  if (!req.admin || req.admin.role !== 'super') {
    return res.status(403).json({ error: 'Huduma hii ni ya msimamizi mkuu pekee.' });
  }
  next();
}

const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;

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

// ---------- Login / logout ----------
app.post('/api/admin/login', safe(async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Jaza jina la mtumiaji na nenosiri.' });

  // Super admin?
  if (username === SUPER_USER) {
    if (!sameText(password, SUPER_PASSWORD)) {
      return res.status(401).json({ error: 'Jina la mtumiaji au nenosiri si sahihi.' });
    }
    setLoginCookie(res, username, 'super');
    await logAction(username, 'aliingia (msimamizi mkuu)');
    return res.json({ ok: true, username, role: 'super' });
  }

  // Normal admin?
  const rows = await query('SELECT * FROM admins WHERE username = ?', [username]);
  if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
    return res.status(401).json({ error: 'Jina la mtumiaji au nenosiri si sahihi.' });
  }
  setLoginCookie(res, username, 'admin');
  await logAction(username, 'aliingia');
  res.json({ ok: true, username, role: 'admin' });
}));

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'uwat_admin=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  const user = readToken(req);
  if (user) setLoginCookie(res, user.username, user.role); // refresh the 30-minute session
  res.json(user ? { loggedIn: true, username: user.username, role: user.role } : { loggedIn: false });
});

// ---------- Registrations (any admin) ----------
app.get('/api/admin/registrations', authAdmin, safe(async (req, res) => {
  const rows = await query('SELECT * FROM registrations ORDER BY id DESC');
  res.json(rows);
}));

// Approve / reject (any admin)
app.patch('/api/admin/registrations/:id', authAdmin, safe(async (req, res) => {
  const status = String((req.body || {}).status || '');
  const allowed = ['Inasubiri', 'Imekubaliwa', 'Imekataliwa'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Hali si sahihi.' });
  const id = Number(req.params.id);
  await query('UPDATE registrations SET status = ? WHERE id = ?', [status, id]);
  const verb = status === 'Imekubaliwa' ? 'alikubali' : status === 'Imekataliwa' ? 'alikataa' : 'alirudisha kusubiri';
  await logAction(req.admin.username, `${verb} ombi #${id}`);
  res.json({ ok: true });
}));

// Delete (super admin only)
app.delete('/api/admin/registrations/:id', authAdmin, authSuper, safe(async (req, res) => {
  const id = Number(req.params.id);
  await query('DELETE FROM registrations WHERE id = ?', [id]);
  await logAction(req.admin.username, `alifuta ombi #${id}`);
  res.json({ ok: true });
}));

// ---------- PDF report (any admin) ----------
app.get('/api/admin/export.pdf', authAdmin, safe(async (req, res) => {
  const rows = await query('SELECT * FROM registrations ORDER BY id');
  await logAction(req.admin.username, 'alipakua ripoti ya usajili (PDF)');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="usajili-uwat.pdf"');

  const FOREST = '#1B4332', GOLD = '#C9A227', DARK = '#222222', MUTED = '#5c6b62';
  const PW = 841.89, PH = 595.28; // A4 landscape
  const M2 = 40;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M2, bufferPages: true });
  doc.pipe(res);

  const logoPath = path.join(__dirname, 'public', 'images', 'uwat logo.png');
  const cols = [
    { key: 'na',     label: 'Na.',              w: 34 },
    { key: 'name',   label: 'Jina Kamili',      w: 150 },
    { key: 'gender', label: 'Jinsia',           w: 42 },
    { key: 'phone',  label: 'Simu',             w: 95 },
    { key: 'region', label: 'Mkoa',             w: 95 },
    { key: 'park',   label: 'Hifadhi',          w: 85 },
    { key: 'retire', label: 'Kustaafu',         w: 80 },
    { key: 'status', label: 'Hali',             w: 80 },
    { key: 'date',   label: 'Tarehe ya Ombi',   w: 92 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const startX = M2;
  const rowH = 22;

  function pageHeader() {
    try { doc.image(logoPath, M2, 24, { width: 42 }); } catch (e) { }
    doc.fillColor(FOREST).font('Helvetica-Bold').fontSize(15);
    doc.text('UWAT — Orodha ya Usajili wa Wanachama', M2 + 54, 28, { lineBreak: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5);
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    doc.text(`Imetolewa: ${now}  ·  Jumla ya maombi: ${rows.length}  ·  uwat.onrender.com`, M2 + 54, 47, { lineBreak: false });
    doc.rect(0, 70, PW, 3).fill(GOLD);
    doc.y = 84;
  }

  function tableHead(y) {
    let x = startX;
    doc.rect(startX, y, tableW, rowH).fill(FOREST);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
    for (const c of cols) {
      doc.text(c.label, x + 5, y + 7, { width: c.w - 10, lineBreak: false });
      x += c.w;
    }
    return y + rowH;
  }

  pageHeader();
  let y = tableHead(doc.y);
  rows.forEach((r, i) => {
    if (y + rowH > PH - 46) { // new page
      doc.addPage();
      pageHeader();
      y = tableHead(doc.y);
    }
    doc.rect(startX, y, tableW, rowH).fill(i % 2 === 0 ? '#ffffff' : '#F4F1E8');
    const name = [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ');
    const vals = {
      na: String(i + 1), name, gender: r.gender || '-', phone: r.phone || '-',
      region: r.region || '-', park: r.last_park || '-', retire: r.retire_date || '-',
      status: r.status || '-', date: (r.created_at || '').slice(0, 10)
    };
    let x = startX;
    for (const c of cols) {
      if (c.key === 'status') {
        doc.fillColor(vals.status === 'Imekubaliwa' ? '#2D7A4F' : vals.status === 'Imekataliwa' ? '#C0392B' : '#94700e');
        doc.font('Helvetica-Bold');
      } else {
        doc.fillColor(DARK).font('Helvetica');
      }
      doc.fontSize(8.5);
      doc.text(vals[c.key], x + 5, y + 7, { width: c.w - 10, height: rowH - 8, ellipsis: true, lineBreak: false });
      x += c.w;
    }
    y += rowH;
  });
  // page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8);
    doc.text(`Ukurasa ${i + 1} kati ya ${range.count}`, PW - M2 - 120, PH - 30, { width: 120, align: 'right', lineBreak: false });
    doc.text('Tunza Urithi, Enzi Utumishi', M2, PH - 30, { lineBreak: false });
  }
  doc.end();
}));

// ---------- Change own password (normal admins) ----------
app.post('/api/admin/password', authAdmin, safe(async (req, res) => {
  if (req.admin.role === 'super') {
    return res.status(400).json({ error: 'Nenosiri la msimamizi mkuu linabadilishwa kwenye mipangilio ya Render (SUPER_ADMIN_PASSWORD).' });
  }
  const b = req.body || {};
  const oldPw = String(b.old_password || '');
  const newPw = String(b.new_password || '');
  if (newPw.length < 6) return res.status(400).json({ error: 'Nenosiri jipya liwe na angalau herufi 6.' });
  const rows = await query('SELECT * FROM admins WHERE username = ?', [req.admin.username]);
  if (!rows.length || !verifyPassword(oldPw, rows[0].password_hash)) {
    return res.status(401).json({ error: 'Nenosiri la zamani si sahihi.' });
  }
  await query('UPDATE admins SET password_hash = ? WHERE username = ?', [hashPassword(newPw), req.admin.username]);
  await logAction(req.admin.username, 'alibadilisha nenosiri lake');
  res.json({ ok: true });
}));

// ---------- Manage admins (super admin only) ----------
app.get('/api/admin/admins', authAdmin, authSuper, safe(async (req, res) => {
  const rows = await query('SELECT id, username, created_at FROM admins ORDER BY id');
  res.json(rows);
}));

app.post('/api/admin/admins', authAdmin, authSuper, safe(async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!USERNAME_RULE.test(username)) {
    return res.status(400).json({ error: 'Jina la mtumiaji liwe herufi ndogo 3–20 (a-z, 0-9, _), bila nafasi.' });
  }
  if (username === SUPER_USER) return res.status(400).json({ error: 'Jina hilo limehifadhiwa.' });
  if (password.length < 6) return res.status(400).json({ error: 'Nenosiri liwe na angalau herufi 6.' });
  const exists = await query('SELECT id FROM admins WHERE username = ?', [username]);
  if (exists.length) return res.status(400).json({ error: 'Jina hilo la mtumiaji tayari lipo.' });
  await query('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, hashPassword(password)]);
  await logAction(req.admin.username, `aliongeza msimamizi '${username}'`);
  res.json({ ok: true });
}));

app.post('/api/admin/admins/:id/reset', authAdmin, authSuper, safe(async (req, res) => {
  const password = String((req.body || {}).password || '');
  if (password.length < 6) return res.status(400).json({ error: 'Nenosiri liwe na angalau herufi 6.' });
  const rows = await query('SELECT username FROM admins WHERE id = ?', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Msimamizi hajapatikana.' });
  await query('UPDATE admins SET password_hash = ? WHERE id = ?', [hashPassword(password), Number(req.params.id)]);
  await logAction(req.admin.username, `alibadilisha nenosiri la '${rows[0].username}'`);
  res.json({ ok: true });
}));

app.delete('/api/admin/admins/:id', authAdmin, authSuper, safe(async (req, res) => {
  const rows = await query('SELECT username FROM admins WHERE id = ?', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Msimamizi hajapatikana.' });
  await query('DELETE FROM admins WHERE id = ?', [Number(req.params.id)]);
  await logAction(req.admin.username, `aliondoa msimamizi '${rows[0].username}'`);
  res.json({ ok: true });
}));

// ---------- Activity log (super admin only) ----------
app.get('/api/admin/logs', authAdmin, authSuper, safe(async (req, res) => {
  const rows = await query('SELECT * FROM activity_log ORDER BY id DESC LIMIT 300');
  res.json(rows);
}));

// ---------- Admin page ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

dbReady.then(() => {
  app.listen(PORT, () => {
    console.log(`UWAT website running at http://localhost:${PORT}`);
    console.log(`Admin dashboard:        http://localhost:${PORT}/admin`);
    console.log(`Super admin username:   ${SUPER_USER}`);
  });
}).catch(err => {
  console.error('Database connection failed:', err.message);
  process.exit(1);
});
