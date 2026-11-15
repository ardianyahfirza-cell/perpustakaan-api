const express = require('express');
const db = require('../db');
const { hashPassword } = require('../security');
const { requireRole } = require('../auth');
const router = express.Router();

router.use(requireRole('admin'));

router.get('/', (req, res) => {
  const rows = db
    .prepare(`SELECT id, username, role, email, display_name,
                     CASE WHEN google_id IS NULL THEN 0 ELSE 1 END AS google
              FROM users ORDER BY role, username`)
    .all();
  res.json(rows);
});

// Buat akun petugas (atau admin tambahan) dengan username + password
router.post('/', (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  const password = String((req.body || {}).password || '');
  const role = (req.body || {}).role === 'admin' ? 'admin' : 'petugas';
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) {
    return res.status(400).json({ error: 'Username 3-30 karakter (huruf, angka, titik, strip, garis bawah)' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    return res.status(409).json({ error: 'Username sudah dipakai' });
  }
  const r = db
    .prepare('INSERT INTO users (username, password, must_change, role) VALUES (?, ?, 1, ?)')
    .run(username, hashPassword(password), role);
  res.status(201).json({ id: r.lastInsertRowid, username, role });
});

router.post('/:id/reset-password', (req, res) => {
  const newPassword = String((req.body || {}).newPassword || '');
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  if (u.google_id) return res.status(400).json({ error: 'Akun Google tidak memakai password' });
  db.prepare('UPDATE users SET password = ?, must_change = 1 WHERE id = ?').run(hashPassword(newPassword), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'Anda tidak bisa menghapus akun yang sedang dipakai' });
  if (u.role === 'admin' && db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c <= 1) {
    return res.status(400).json({ error: 'Minimal harus ada satu admin' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

module.exports = router;
