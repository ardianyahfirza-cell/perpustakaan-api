const crypto = require('crypto');
const db = require('./db');

const SESSION_DAYS = 7;

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(token, userId);
  return token;
}

// Middleware: harus sudah login (role apa pun)
function requireAuth(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: 'Login diperlukan' });
  const row = db
    .prepare(`SELECT u.id, u.username, u.role, u.email, u.display_name
              FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token = ? AND s.expires_at > datetime('now')`)
    .get(m[1]);
  if (!row) return res.status(401).json({ error: 'Sesi berakhir, silakan login lagi' });
  req.user = row;
  req.token = m[1];
  next();
}

// Middleware: harus login DAN salah satu dari role yang diizinkan, contoh requireRole('admin', 'petugas')
function requireRole(...roles) {
  return [
    requireAuth,
    (req, res, next) =>
      roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Akun Anda tidak punya izin untuk fitur ini' }),
  ];
}

module.exports = { createSession, requireAuth, requireRole };
