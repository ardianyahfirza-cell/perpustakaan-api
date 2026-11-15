const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword } = require('../security');
const { createSession, requireAuth } = require('../auth');
const router = express.Router();

const profile = (u, token, extra = {}) => ({
  ...(token ? { token } : {}),
  username: u.username,
  role: u.role,
  name: u.display_name || u.username,
  email: u.email || null,
  photo: u.photo || null,
  google: !!u.google_id,
  mustChange: !!u.must_change,
  ...extra,
});

// ---- Pembatas ----
// Login: maks 5 gagal per IP, lalu diblokir 5 menit
const fails = new Map();
const MAX_FAILS = 5;
const BLOCK_MS = 5 * 60 * 1000;
// Pendaftaran: maks 10 per IP per jam
const regHits = new Map();
function registerLimited(ip) {
  const now = Date.now();
  let f = regHits.get(ip);
  if (!f || now >= f.until) f = { count: 0, until: now + 60 * 60 * 1000 };
  f.count += 1;
  regHits.set(ip, f);
  return f.count > 10;
}

function uniqueUsername(email) {
  const base = (email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'anggota').slice(0, 24);
  let name = base;
  for (let i = 2; db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name); i++) name = `${base}${i}`;
  return name;
}

// ---- Daftar akun baru (email + password) -> role "anggota", langsung login ----
router.post('/register', (req, res) => {
  if (registerLimited(req.ip)) return res.status(429).json({ error: 'Terlalu banyak pendaftaran. Coba lagi nanti.' });

  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  let name = String(b.name || '').trim();

  if (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid' });
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  if (name.length > 50) return res.status(400).json({ error: 'Nama maksimal 50 karakter' });
  if (!name) name = email.split('@')[0];
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Email sudah terdaftar. Silakan login.' });

  const r = db
    .prepare("INSERT INTO users (username, password, must_change, role, email, display_name) VALUES (?, ?, 0, 'anggota', ?, ?)")
    .run(uniqueUsername(email), hashPassword(password), email, name);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json(profile(user, createSession(user.id)));
});

// ---- Login: boleh memakai username ATAU email ----
router.post('/login', (req, res) => {
  const ip = req.ip;
  const f = fails.get(ip);
  if (f && f.count >= MAX_FAILS && Date.now() < f.until) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' });
  }

  const { username, password } = req.body || {};
  const ident = String(username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ?').get(ident, ident.toLowerCase());
  if (!user || user.google_id || !verifyPassword(String(password || ''), user.password)) {
    const count = (f && Date.now() < f.until ? f.count : 0) + 1;
    fails.set(ip, { count, until: Date.now() + BLOCK_MS });
    return res.status(401).json({ error: 'Username/email atau password salah' });
  }

  fails.delete(ip);
  res.json(profile(user, createSession(user.id)));
});

// ---- Login Google ----
// Aplikasi mengirim ID token dari Google; server memverifikasinya ke Google lalu
// menyimpan email + username + foto. Akun Google selalu berperan "anggota".
const TOKENINFO_URL = process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

router.post('/google', async (req, res) => {
  const allowed = (process.env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) {
    return res.status(503).json({ error: 'Login Google belum dikonfigurasi di server (isi GOOGLE_CLIENT_IDS).' });
  }
  const idToken = String((req.body || {}).idToken || '');
  if (!idToken) return res.status(400).json({ error: 'ID token Google tidak ada' });

  let info;
  try {
    const r = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`);
    if (!r.ok) return res.status(401).json({ error: 'Token Google tidak valid atau sudah kedaluwarsa' });
    info = await r.json();
  } catch (e) {
    return res.status(502).json({ error: 'Server tidak bisa menghubungi Google' });
  }

  // Token harus untuk aplikasi KITA, dari Google, dengan email terverifikasi
  if (!allowed.includes(info.aud) || !GOOGLE_ISSUERS.includes(info.iss) || String(info.email_verified) !== 'true' || !info.sub || !info.email) {
    return res.status(401).json({ error: 'Token Google ditolak' });
  }

  const email = String(info.email).toLowerCase();
  const name = info.name || email.split('@')[0];
  const picture = /^https:\/\//.test(String(info.picture || '')) ? String(info.picture) : null;

  let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(info.sub);
  if (user) {
    // foto yang dipilih sendiri dari galeri (data URI) tidak ditimpa; foto Google selalu disegarkan
    const ownPhoto = user.photo && !/^https?:\/\//.test(user.photo);
    db.prepare('UPDATE users SET email = ?, display_name = COALESCE(display_name, ?), photo = ? WHERE id = ?')
      .run(email, name, ownPhoto ? user.photo : picture, user.id);
  } else {
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'Email ini sudah terdaftar pada akun lain. Login dengan email dan password.' });
    }
    const r = db
      .prepare("INSERT INTO users (username, password, must_change, role, email, google_id, display_name, photo) VALUES (?, '!', 0, 'anggota', ?, ?, ?, ?)")
      .run(uniqueUsername(email), email, info.sub, name, picture);
    user = { id: r.lastInsertRowid };
  }
  user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json(profile(user, createSession(user.id)));
});

// ---- Profil sendiri ----
router.get('/me', requireAuth, (req, res) => {
  res.json(profile(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

const MAX_PHOTO = 1400000; // karakter data URI (~1 MB gambar)
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// body: { name?, photo? } — photo: data URI gambar, atau null untuk menghapus
router.put('/me', requireAuth, (req, res) => {
  const b = req.body || {};
  const sets = [];
  const vals = [];

  if ('name' in b) {
    const n = String(b.name || '').trim();
    if (n.length < 1 || n.length > 50) return res.status(400).json({ error: 'Nama 1-50 karakter' });
    sets.push('display_name = ?'); vals.push(n);
  }
  if ('photo' in b) {
    if (b.photo === null) sets.push('photo = NULL');
    else {
      const p = String(b.photo);
      if (p.length > MAX_PHOTO || !PHOTO_RE.test(p)) return res.status(400).json({ error: 'Foto tidak valid atau terlalu besar' });
      sets.push('photo = ?'); vals.push(p);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'Tidak ada perubahan' });

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.user.id);
  res.json(profile(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.google_id) return res.status(400).json({ error: 'Akun Google tidak memakai password' });
  if (!verifyPassword(String(currentPassword || ''), user.password)) {
    return res.status(400).json({ error: 'Password lama salah' });
  }
  if (String(newPassword || '').length < 6) {
    return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
  }
  db.prepare('UPDATE users SET password = ?, must_change = 0 WHERE id = ?').run(hashPassword(newPassword), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, req.token);
  res.json({ ok: true });
});

module.exports = router;
