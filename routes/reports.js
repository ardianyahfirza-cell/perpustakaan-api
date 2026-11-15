const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const { dateParam } = require('../utils');
const router = express.Router();

// Jumlah terjual per buku dalam rentang tanggal (buku tanpa penjualan tetap muncul dengan 0)
router.get('/sales', requireRole('admin'), (req, res) => {
  const p = { from: dateParam(req.query.from), to: dateParam(req.query.to) };
  const books = db
    .prepare(`
      SELECT b.id, b.name, COALESCE(SUM(x.qty), 0) AS sold
      FROM books b
      LEFT JOIN (
        SELECT ti.book_id, ti.qty
        FROM transaction_items ti
        JOIN transactions t ON t.id = ti.transaction_id
        WHERE (@from IS NULL OR date(t.created_at) >= @from) AND (@to IS NULL OR date(t.created_at) <= @to)
      ) x ON x.book_id = b.id
      GROUP BY b.id
      ORDER BY sold DESC, b.name ASC`)
    .all(p);

  const summary = db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM transactions
              WHERE (@from IS NULL OR date(created_at) >= @from) AND (@to IS NULL OR date(created_at) <= @to)`)
    .get(p);

  res.json({ summary, books });
});

module.exports = router;
