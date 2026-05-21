const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'wctg.db');

let _db = null;

function save() {
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}

function all(sql, params = []) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  _db.run(sql, params);
  const row = get('SELECT last_insert_rowid() as id');
  save();
  return { lastInsertRowid: row ? row.id : null };
}

function exec(sql) {
  _db.exec(sql);
  save();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  ntfy_topic    TEXT,
  display_order INTEGER NOT NULL,
  created_at    TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT
);

CREATE TABLE IF NOT EXISTS trades (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  writer_id         INTEGER NOT NULL REFERENCES players(id),
  counterparty_id   INTEGER NOT NULL REFERENCES players(id),
  status            TEXT    NOT NULL DEFAULT 'pending',
  confirm_token     TEXT    NOT NULL UNIQUE,
  reject_token      TEXT    NOT NULL UNIQUE,
  amended_from_id   INTEGER REFERENCES trades(id),
  note              TEXT,
  created_at        TEXT    DEFAULT (datetime('now')),
  updated_at        TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trade_legs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id      INTEGER NOT NULL REFERENCES trades(id),
  side          TEXT    NOT NULL,
  team_id       INTEGER NOT NULL REFERENCES teams(id),
  quantity      INTEGER NOT NULL,
  leg_type      TEXT    NOT NULL,
  cash_amount   INTEGER,
  swap_team_id  INTEGER REFERENCES teams(id),
  swap_quantity INTEGER
);

CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT,
  data       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     INTEGER NOT NULL REFERENCES players(id),
  old_player_id INTEGER REFERENCES players(id),
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  player_id  INTEGER REFERENCES players(id),
  detail     TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS draw_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  team_id    INTEGER NOT NULL REFERENCES teams(id),
  created_at TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_writer       ON trades(writer_id);
CREATE INDEX IF NOT EXISTS idx_trades_counterparty ON trades(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_trades_status       ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trade_legs_trade    ON trade_legs(trade_id);
`;

function migrate() {
  const additions = [
    `ALTER TABLE trades ADD COLUMN auto_confirmed_side TEXT`,
    `ALTER TABLE trades ADD COLUMN expires_at TEXT`,
    `ALTER TABLE security_events ADD COLUMN read INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE login_events ADD COLUMN read INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE trades ADD COLUMN ip_address TEXT`,
  ];
  for (const sql of additions) {
    try { _db.exec(sql); } catch (_) { /* column already exists */ }
  }
}

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    _db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _db = new SQL.Database();
  }
  _db.exec(SCHEMA);
  migrate();
  save();
  return { all, get, run, exec, save };
}

module.exports = { init };
