const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const router = express.Router();

function validate(body) {
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  const stock = Number(body.stock);
  if (!name) return { error: 'Nama buku wajib diisi' };
  if (!Number.isInteger(price) || price < 0) return { error: 'Harga tidak valid' };
  if (!Number.isInteger(stock) || stock < 0) return { error: 'Stok tidak valid' };
  return { name, price, stock };
}

// Membaca daftar buku terbuka (dipakai kasir); mengubah data khusus admin
router.get('/', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM books ORDER BY id DESC').all());
});

router.post('/', requireRole('admin'), (req, res) => {
  const v = validate(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const r = db.prepare('INSERT INTO books (name, price, stock) VALUES (?, ?, ?)').run(v.name, v.price, v.stock);
  res.status(201).json({ id: r.lastInsertRowid, ...v });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const v = validate(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const r = db.prepare('UPDATE books SET name=?, price=?, stock=? WHERE id=?').run(v.name, v.price, v.stock, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Buku tidak ditemukan' });
  res.json({ id: Number(req.params.id), ...v });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  try {
    const r = db.prepare('DELETE FROM books WHERE id=?').run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Buku tidak ditemukan' });
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: 'Buku sudah punya riwayat transaksi, tidak bisa dihapus' });
  }
});

module.exports = router;
