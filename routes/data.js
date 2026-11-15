const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const router = express.Router();

router.use(requireRole('admin'));

// Ringkasan data
router.get('/stats', (req, res) => {
  const b = db.prepare('SELECT COUNT(*) AS books, COALESCE(SUM(stock), 0) AS stock FROM books').get();
  const t = db.prepare('SELECT COUNT(*) AS transactions, COALESCE(SUM(total), 0) AS revenue FROM transactions').get();
  const u = db.prepare('SELECT COUNT(*) AS users FROM users').get();
  res.json({ books: b.books, stock: b.stock, transactions: t.transactions, revenue: t.revenue, users: u.users });
});

// Cadangan: buku + riwayat transaksi. Akun, password, dan foto TIDAK ikut.
router.get('/export', (req, res) => {
  res.json({
    app: 'perpustakaan',
    version: 1,
    exported_at: new Date().toISOString(),
    books: db.prepare('SELECT id, name, price, stock FROM books ORDER BY id').all(),
    transactions: db.prepare('SELECT id, total, paid, change, created_at FROM transactions ORDER BY id').all(),
    items: db.prepare('SELECT transaction_id, book_id, book_name, price, qty, discount, subtotal FROM transaction_items ORDER BY id').all(),
  });
});

const int = (v) => Number.isInteger(v);
const str = (v) => typeof v === 'string' && v.trim().length > 0;

function validate(data) {
  if (!data || data.app !== 'perpustakaan' || !Array.isArray(data.books) || !Array.isArray(data.transactions) || !Array.isArray(data.items)) {
    return 'Teks cadangan tidak dikenali';
  }
  if (data.version !== 1) return 'Versi cadangan tidak didukung';
  if (data.books.length > 20000 || data.transactions.length > 100000 || data.items.length > 400000) return 'Data cadangan terlalu besar';

  const bookIds = new Set();
  for (const b of data.books) {
    if (!b || !int(b.id) || b.id < 1 || !str(b.name) || !int(b.price) || b.price < 0 || !int(b.stock) || b.stock < 0 || bookIds.has(b.id)) {
      return 'Data buku pada cadangan tidak valid';
    }
    bookIds.add(b.id);
  }
  const trxIds = new Set();
  for (const t of data.transactions) {
    if (!t || !int(t.id) || t.id < 1 || !int(t.total) || !int(t.paid) || !int(t.change) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(t.created_at)) || trxIds.has(t.id)) {
      return 'Data transaksi pada cadangan tidak valid';
    }
    trxIds.add(t.id);
  }
  for (const i of data.items) {
    if (!i || !trxIds.has(i.transaction_id) || !bookIds.has(i.book_id) || !str(i.book_name) || !int(i.price) || !int(i.qty) || i.qty < 1 ||
        !int(i.discount) || i.discount < 0 || i.discount > 100 || !int(i.subtotal)) {
      return 'Data item transaksi pada cadangan tidak valid';
    }
  }
  return null;
}

// Mengganti SEMUA buku & riwayat transaksi dengan isi cadangan (atomik: gagal = tidak ada yang berubah)
const restore = db.transaction((data) => {
  db.prepare('DELETE FROM transaction_items').run();
  db.prepare('DELETE FROM transactions').run();
  db.prepare('DELETE FROM books').run();
  const insBook = db.prepare('INSERT INTO books (id, name, price, stock) VALUES (?, ?, ?, ?)');
  const insTrx = db.prepare('INSERT INTO transactions (id, total, paid, change, created_at) VALUES (?, ?, ?, ?, ?)');
  const insItem = db.prepare('INSERT INTO transaction_items (transaction_id, book_id, book_name, price, qty, discount, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const b of data.books) insBook.run(b.id, b.name.trim(), b.price, b.stock);
  for (const t of data.transactions) insTrx.run(t.id, t.total, t.paid, t.change, t.created_at);
  for (const i of data.items) insItem.run(i.transaction_id, i.book_id, i.book_name, i.price, i.qty, i.discount, i.subtotal);
});

router.post('/import', (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });
  restore(req.body);
  res.json({ books: req.body.books.length, transactions: req.body.transactions.length });
});

// Menghapus semua riwayat transaksi (stok buku tidak berubah)
router.post('/reset-transactions', (req, res) => {
  const deleted = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  db.transaction(() => {
    db.prepare('DELETE FROM transaction_items').run();
    db.prepare('DELETE FROM transactions').run();
  })();
  res.json({ deleted });
});

module.exports = router;
