const Database = require('better-sqlite3');
const path = require('path');
const { hashPassword } = require('./security');

const db = new Database(path.join(__dirname, 'perpustakaan.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT    NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    total      INTEGER NOT NULL,
    paid       INTEGER NOT NULL,
    change     INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS transaction_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    book_id        INTEGER NOT NULL REFERENCES books(id),
    book_name      TEXT    NOT NULL,
    price          INTEGER NOT NULL,
    qty            INTEGER NOT NULL,
    discount       INTEGER NOT NULL DEFAULT 0,
    subtotal       INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    must_change INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL
  );
`);

// Migrasi: kolom akun tambahan (aman dijalankan berulang, juga untuk database lama)
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const addCol = (name, ddl) => { if (!userCols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`); };
addCol('role', "role TEXT NOT NULL DEFAULT 'admin'"); // admin | petugas | anggota
addCol('email', 'email TEXT');
addCol('google_id', 'google_id TEXT');
addCol('display_name', 'display_name TEXT');
addCol('photo', 'photo TEXT'); // URL foto Google atau data URI foto dari galeri
addCol('prefs', 'prefs TEXT'); // preferensi pribadi (JSON): mode gelap, cetak otomatis, lebar struk
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id) WHERE google_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email  ON users(email)     WHERE email IS NOT NULL;
`);

// Akun admin awal (WAJIB diganti lewat menu Setting setelah login pertama)
if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
  db.prepare("INSERT INTO users (username, password, must_change, role) VALUES (?, ?, 1, 'admin')").run('admin', hashPassword('admin123'));
}
db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

// Data contoh supaya aplikasi tidak kosong saat pertama dijalankan
if (db.prepare('SELECT COUNT(*) AS c FROM books').get().c === 0) {
  const ins = db.prepare('INSERT INTO books (name, price, stock) VALUES (?, ?, ?)');
  [
    ['Laskar Pelangi', 85000, 20],
    ['Bumi Manusia', 110000, 15],
    ['Filosofi Teras', 98000, 12],
    ['Atomic Habits', 120000, 10],
    ['Pemrograman JavaScript', 135000, 8],
    ['Cantik Itu Luka', 95000, 6],
  ].forEach((b) => ins.run(...b));
}

module.exports = db;
