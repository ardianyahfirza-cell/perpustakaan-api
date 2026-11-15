const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const router = express.Router();

// Pengaturan BERSAMA (semua pengguna melihat nilai yang sama; hanya admin yang boleh mengubah)
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

const DEFAULT_GLOBAL = {
  libraryName: 'Perpustakaan',
  libraryAddress: '',
  libraryPhone: '',
  receiptFooter: 'Terima kasih!',
  defaultDiscount: '0',
  lowStock: '5',
};
// Preferensi PRIBADI (tiap akun punya sendiri, tersimpan di server)
const DEFAULT_PREFS = { darkMode: false, autoPrint: false, paperSize: '80' };

const intIn = (v, min, max) => {
  if (typeof v === 'boolean' || v === null || v === '' || (typeof v === 'string' && v.trim() === '')) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

// Validator: mengembalikan { value } atau { error }
const GLOBAL_RULES = {
  libraryName: (v) => { const s = String(v == null ? '' : v).trim(); return s.length >= 1 && s.length <= 80 ? { value: s } : { error: 'Nama perpustakaan 1-80 karakter' }; },
  libraryAddress: (v) => { const s = String(v == null ? '' : v).trim(); return s.length <= 200 ? { value: s } : { error: 'Alamat maksimal 200 karakter' }; },
  libraryPhone: (v) => { const s = String(v == null ? '' : v).trim(); return s.length <= 30 && /^[0-9+()\-.\s]*$/.test(s) ? { value: s } : { error: 'Nomor telepon tidak valid' }; },
  receiptFooter: (v) => { const s = String(v == null ? '' : v).trim(); return s.length <= 100 ? { value: s } : { error: 'Pesan penutup maksimal 100 karakter' }; },
  defaultDiscount: (v) => { const n = intIn(v, 0, 100); return n === null ? { error: 'Diskon default harus angka 0-100' } : { value: String(n) }; },
  lowStock: (v) => { const n = intIn(v, 0, 100000); return n === null ? { error: 'Batas stok menipis harus angka 0-100000' } : { value: String(n) }; },
};
const PREF_RULES = {
  darkMode: (v) => (typeof v === 'boolean' ? { value: v } : { error: 'Mode gelap harus true/false' }),
  autoPrint: (v) => (typeof v === 'boolean' ? { value: v } : { error: 'Cetak otomatis harus true/false' }),
  paperSize: (v) => (['58', '80', 'A4'].includes(v) ? { value: v } : { error: 'Lebar struk harus 58, 80, atau A4' }),
};

function getGlobal() {
  const out = { ...DEFAULT_GLOBAL };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (r.key in DEFAULT_GLOBAL) out[r.key] = r.value;
  return out;
}

function getPrefs(userId) {
  const row = db.prepare('SELECT prefs FROM users WHERE id = ?').get(userId);
  let stored = {};
  try { stored = JSON.parse((row && row.prefs) || '{}'); } catch (e) { stored = {}; }
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(PREF_RULES)) if (k in stored && !PREF_RULES[k](stored[k]).error) out[k] = stored[k];
  return out;
}

const merged = (userId) => ({ ...getGlobal(), ...getPrefs(userId) });

// Validasi isian: hanya kunci yang dikenal yang diproses; satu saja salah -> seluruh perubahan ditolak
function parse(body, rules) {
  const clean = {};
  for (const key of Object.keys(rules)) {
    if (!(key in (body || {}))) continue;
    const r = rules[key](body[key]);
    if (r.error) return { error: r.error };
    clean[key] = r.value;
  }
  if (!Object.keys(clean).length) return { error: 'Tidak ada perubahan' };
  return { clean };
}

// Semua akun yang login: pengaturan bersama + preferensi pribadinya
router.get('/', requireAuth, (req, res) => res.json(merged(req.user.id)));

// Admin: ubah pengaturan bersama
router.put('/', requireRole('admin'), (req, res) => {
  const { clean, error } = parse(req.body, GLOBAL_RULES);
  if (error) return res.status(400).json({ error });
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => { for (const [k, v] of Object.entries(clean)) up.run(k, v); })();
  res.json(merged(req.user.id));
});

// Semua akun yang login: ubah preferensi pribadinya
router.put('/me', requireAuth, (req, res) => {
  const { clean, error } = parse(req.body, PREF_RULES);
  if (error) return res.status(400).json({ error });
  const next = { ...getPrefs(req.user.id), ...clean };
  db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(next), req.user.id);
  res.json(merged(req.user.id));
});

module.exports = router;
