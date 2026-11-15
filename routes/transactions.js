const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { dateParam } = require('../utils');
const router = express.Router();

// body: { items: [{ book_id, qty, discount(%) }], paid }
const checkout = db.transaction((items, paid) => {
  const getBook = db.prepare('SELECT * FROM books WHERE id = ?');
  const lines = [];
  const remaining = {}; // sisa stok per buku (menangani buku yang sama di beberapa baris)
  let total = 0;

  for (const it of items) {
    const book = getBook.get(it.book_id);
    const qty = Number(it.qty);
    const discount = Math.min(100, Math.max(0, Number(it.discount) || 0));
    if (!book) throw new Error('Buku tidak ditemukan');
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`Jumlah "${book.name}" tidak valid`);
    if (remaining[book.id] === undefined) remaining[book.id] = book.stock;
    if (remaining[book.id] < qty) throw new Error(`Stok "${book.name}" tidak cukup (sisa ${remaining[book.id]})`);
    remaining[book.id] -= qty;
    // harga dihitung ulang di server, jadi tidak bisa dimanipulasi dari aplikasi
    const subtotal = Math.round(book.price * qty * (1 - discount / 100));
    total += subtotal;
    lines.push({ book, qty, discount, subtotal });
  }

  if (!Number.isFinite(paid) || paid < total) throw new Error('Uang bayar kurang dari total');
  const change = paid - total;

  const trx = db.prepare('INSERT INTO transactions (total, paid, change) VALUES (?, ?, ?)').run(total, paid, change);
  const insItem = db.prepare(
    'INSERT INTO transaction_items (transaction_id, book_id, book_name, price, qty, discount, subtotal) VALUES (?,?,?,?,?,?,?)'
  );
  const cut = db.prepare('UPDATE books SET stock = stock - ? WHERE id = ?');
  for (const l of lines) {
    insItem.run(trx.lastInsertRowid, l.book.id, l.book.name, l.book.price, l.qty, l.discount, l.subtotal);
    cut.run(l.qty, l.book.id);
  }

  return {
    id: trx.lastInsertRowid,
    total, paid, change,
    created_at: db.prepare('SELECT created_at FROM transactions WHERE id=?').get(trx.lastInsertRowid).created_at,
    items: lines.map((l) => ({ name: l.book.name, price: l.book.price, qty: l.qty, discount: l.discount, subtotal: l.subtotal })),
  };
});

// Kasir: semua akun yang sudah login
router.post('/', requireAuth, (req, res) => {
  const { items, paid } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Keranjang kosong' });
  try {
    res.status(201).json(checkout(items, Number(paid)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Riwayat: admin & petugas. Query opsional ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', requireRole('admin', 'petugas'), (req, res) => {
  const from = dateParam(req.query.from);
  const to = dateParam(req.query.to);
  const rows = db
    .prepare(`SELECT * FROM transactions
              WHERE (@from IS NULL OR date(created_at) >= @from) AND (@to IS NULL OR date(created_at) <= @to)
              ORDER BY id DESC LIMIT 200`)
    .all({ from, to });

  const getItems = db.prepare('SELECT book_name AS name, price, qty, discount, subtotal FROM transaction_items WHERE transaction_id = ?');
  const list = rows.map((t) => ({ ...t, items: getItems.all(t.id) }));
  const summary = list.reduce((s, t) => ({ count: s.count + 1, revenue: s.revenue + t.total }), { count: 0, revenue: 0 });
  res.json({ summary, transactions: list });
});

module.exports = router;
