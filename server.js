const express = require('express');
const cors = require('cors');
require('./db');

const app = express();
app.set('trust proxy', false);
app.use(cors());
app.use('/data', express.json({ limit: '25mb' })); // cadangan data bisa besar (harus sebelum parser umum)
app.use(express.json({ limit: '2mb' })); // 2mb: foto profil dikirim sebagai base64

app.get('/', (req, res) => res.json({ app: 'Perpustakaan API', status: 'ok' }));
app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/books', require('./routes/books'));
app.use('/transactions', require('./routes/transactions'));
app.use('/reports', require('./routes/reports'));
app.use('/data', require('./routes/data'));
app.use('/settings', require('./routes/settings'));

// Semua error dijawab sebagai JSON (bukan halaman HTML) agar aplikasi bisa menampilkan pesannya
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Data terlalu besar' });
  if (err && err.status === 400) return res.status(400).json({ error: 'Format data tidak valid' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server jalan di http://0.0.0.0:${PORT}`));
