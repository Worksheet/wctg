const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const crypto  = require('crypto');
const { exportWorkbook, importWorkbook } = require('../lib/excel');

const upload     = multer({ storage: multer.memoryStorage() });
const ADMIN_PASS = process.env.WCTG_ADMIN_PASS || 'changeme';

// Cookie stores an HMAC of the passphrase rather than the passphrase itself.
// Stateless — no session table needed. Invalidates automatically if ADMIN_PASS changes.
function adminToken() {
  return crypto.createHmac('sha256', ADMIN_PASS).update('wctg-admin-session').digest('hex');
}

function getDb(req)   { return req.app.locals.db; }
function isAdmin(req) { return req.cookies.wctg_admin === adminToken(); }
function getIp(req)   { return req.headers['x-forwarded-for'] || req.socket.remoteAddress; }

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).render('error', { title: 'Admin required', message: 'You must be logged in as admin to do that.' });
  }
  next();
}

function takeSnapshot(db, label) {
  const data = {
    players:    db.all('SELECT * FROM players'),
    teams:      db.all('SELECT * FROM teams'),
    trades:     db.all('SELECT * FROM trades'),
    trade_legs: db.all('SELECT * FROM trade_legs'),
  };
  db.run('INSERT INTO snapshots (label, data) VALUES (?,?)', [label, JSON.stringify(data)]);
}

function logSecurityEvent(db, req, eventType, playerId, detail) {
  db.run(
    'INSERT INTO security_events (event_type, player_id, detail, ip_address, user_agent) VALUES (?,?,?,?,?)',
    [eventType, playerId || null, detail || null, getIp(req), req.headers['user-agent'] || '']
  );
}

function getSar(db, eventFilter) {
  const rows = db.all(`
    SELECT le.created_at, 'identity-switch' AS event_type,
           pn.name AS actor, 'Was: ' || po.name AS detail,
           le.ip_address, le.user_agent
    FROM login_events le
    JOIN players pn ON le.player_id     = pn.id
    JOIN players po ON le.old_player_id = po.id
    WHERE le.read = 0
    UNION ALL
    SELECT se.created_at, se.event_type,
           COALESCE(p.name, '—') AS actor, COALESCE(se.detail, '') AS detail,
           se.ip_address, se.user_agent
    FROM security_events se
    LEFT JOIN players p ON se.player_id = p.id
    WHERE se.read = 0
    ORDER BY 1 DESC
  `);
  if (eventFilter) return rows.filter(r => r.event_type === eventFilter);
  return rows;
}

function getIpActivity(db) {
  return db.all(`
    SELECT ip, GROUP_CONCAT(DISTINCT player_name) AS players, GROUP_CONCAT(DISTINCT trade_id) AS trades
    FROM (
      SELECT le.ip_address AS ip, p.name AS player_name, NULL AS trade_id
      FROM login_events le JOIN players p ON le.player_id = p.id
      WHERE le.ip_address IS NOT NULL
      UNION ALL
      SELECT t.ip_address AS ip, p.name AS player_name, CAST(t.id AS TEXT) AS trade_id
      FROM trades t JOIN players p ON t.writer_id = p.id
      WHERE t.ip_address IS NOT NULL
    )
    GROUP BY ip
    ORDER BY ip
  `);
}

function renderAdmin(res, db, req, extra = {}) {
  const snapshots     = db.all('SELECT id, label, created_at FROM snapshots ORDER BY id DESC');
  const eventFilter   = (req.query && req.query.event) || '';
  const sar           = getSar(db, eventFilter);
  const sarEventTypes = getSar(db).map(r => r.event_type).filter((v, i, a) => a.indexOf(v) === i).sort();
  const admin         = isAdmin(req);
  const players       = admin ? db.all('SELECT * FROM players ORDER BY display_order') : [];
  const ipActivity    = admin ? getIpActivity(db) : [];
  res.render('admin', { title: 'Admin', snapshots, sar, sarEventTypes, sarEventFilter: eventFilter, players, isAdmin: admin, ipActivity, loginError: false, error: null, ...extra });
}

// ── God mode (admin only) ─────────────────────────────────────────────────────

router.post('/godmode', requireAdmin, (req, res) => {
  if (req.body.enable === '1') {
    res.cookie('wctg_god', '1', { httpOnly: true, sameSite: 'Lax' });
    logSecurityEvent(getDb(req), req, 'god-mode-on',
      req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null, null);
  } else {
    res.clearCookie('wctg_god');
  }
  res.redirect('/admin');
});

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const db = getDb(req);
  if (req.body.password === ADMIN_PASS) {
    res.cookie('wctg_admin', adminToken(), { httpOnly: true, sameSite: 'Lax', secure: process.env.NODE_ENV !== 'development' });
    return res.redirect('/admin');
  }
  logSecurityEvent(db, req, 'failed-admin-login', null, null);
  renderAdmin(res, db, req, { loginError: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('wctg_admin');
  res.redirect('/admin');
});

// ── Main page ─────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  renderAdmin(res, getDb(req), req);
});

// ── Players (admin only) ──────────────────────────────────────────────────────

router.post('/players', requireAdmin, (req, res) => {
  const db = getDb(req);
  const { name, email, ntfy_topic } = req.body;
  if (!name || !email) {
    return renderAdmin(res, db, req, { error: 'Name and email are required.' });
  }
  const order = (db.get('SELECT MAX(display_order) AS m FROM players') || {}).m || 0;
  db.run('INSERT INTO players (name,email,ntfy_topic,display_order) VALUES (?,?,?,?)',
    [name, email, ntfy_topic || null, order + 1]);
  res.redirect('/admin');
});

router.post('/players/:id', requireAdmin, (req, res) => {
  const db = getDb(req);
  const { name, email, ntfy_topic } = req.body;
  db.run('UPDATE players SET name=?, email=?, ntfy_topic=? WHERE id=?',
    [name, email, ntfy_topic || null, parseInt(req.params.id)]);
  res.redirect('/admin');
});

router.post('/players/:id/delete', requireAdmin, (req, res) => {
  const db = getDb(req);
  db.run('DELETE FROM players WHERE id=?', [parseInt(req.params.id)]);
  res.redirect('/admin');
});

// ── SAR clear (admin only) ────────────────────────────────────────────────────

router.post('/sar/clear', requireAdmin, (req, res) => {
  const db = getDb(req);
  db.exec('UPDATE security_events SET read=1; UPDATE login_events SET read=1');
  res.redirect('/admin');
});

// ── Snapshots (admin only) ────────────────────────────────────────────────────

router.post('/snapshot', requireAdmin, (req, res) => {
  const db = getDb(req);
  takeSnapshot(db, req.body.label || `manual ${new Date().toISOString()}`);
  res.redirect('/admin');
});

router.post('/snapshot/:id/revert', requireAdmin, (req, res) => {
  const db   = getDb(req);
  const snap = db.get('SELECT * FROM snapshots WHERE id=?', [parseInt(req.params.id)]);
  if (!snap) return res.status(404).render('error', { title: 'Not Found', message: 'Snapshot not found.' });

  takeSnapshot(db, `pre-revert to #${snap.id}`);

  const data = JSON.parse(snap.data);
  db.exec('DELETE FROM trade_legs; DELETE FROM trades; DELETE FROM players; DELETE FROM teams;');

  for (const p of data.players) {
    db.run('INSERT INTO players (id,name,email,ntfy_topic,display_order,created_at) VALUES (?,?,?,?,?,?)',
      [p.id, p.name, p.email, p.ntfy_topic || null, p.display_order, p.created_at]);
  }
  for (const t of data.teams) {
    db.run('INSERT INTO teams (id,name,code) VALUES (?,?,?)', [t.id, t.name, t.code || null]);
  }
  for (const t of data.trades) {
    db.run(
      'INSERT INTO trades (id,writer_id,counterparty_id,status,confirm_token,reject_token,amended_from_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [t.id,t.writer_id,t.counterparty_id,t.status,t.confirm_token,t.reject_token,
       t.amended_from_id||null,t.note||null,t.created_at,t.updated_at]
    );
  }
  for (const l of data.trade_legs) {
    db.run(
      'INSERT INTO trade_legs (id,trade_id,side,team_id,quantity,leg_type,cash_amount,swap_team_id,swap_quantity) VALUES (?,?,?,?,?,?,?,?,?)',
      [l.id,l.trade_id,l.side,l.team_id,l.quantity,l.leg_type,
       l.cash_amount||null,l.swap_team_id||null,l.swap_quantity||null]
    );
  }

  res.redirect('/admin');
});

// ── Tournament reset (admin only) ─────────────────────────────────────────────

router.post('/clear', requireAdmin, (req, res) => {
  const db = getDb(req);
  const sel = {
    trades:       !!req.body.clear_trades,
    sar:          !!req.body.clear_sar,
    draw_results: !!req.body.clear_draw_results,
    players:      !!req.body.clear_players,
    teams:        !!req.body.clear_teams,
  };

  if (!Object.values(sel).some(Boolean)) {
    return renderAdmin(res, db, req, { error: 'Select at least one item to clear.' });
  }

  takeSnapshot(db, `pre-clear ${new Date().toISOString()}`);

  const stmts = [];
  // FK-safe order: dependents first
  if (sel.trades)       stmts.push('DELETE FROM trade_legs', 'DELETE FROM trades');
  if (sel.sar)          stmts.push('DELETE FROM security_events', 'DELETE FROM login_events');
  if (sel.draw_results) stmts.push('DELETE FROM draw_results');
  if (sel.players)      stmts.push('DELETE FROM players');
  if (sel.teams)        stmts.push('DELETE FROM teams');

  db.exec(stmts.join('; '));
  logSecurityEvent(db, req, 'admin-db-clear', null, JSON.stringify(sel));
  res.redirect('/admin');
});

// ── Excel (admin only) ────────────────────────────────────────────────────────

router.get('/export.xlsx', requireAdmin, async (req, res) => {
  const db = getDb(req);
  const wb = await exportWorkbook(db);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="wctg.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.post('/import', requireAdmin, upload.single('file'), async (req, res) => {
  const db = getDb(req);
  if (!req.file) return res.redirect('/admin');

  takeSnapshot(db, `pre-import ${new Date().toISOString()}`);
  const result = await importWorkbook(req.file.buffer, db);

  if (!result.ok) {
    return renderAdmin(res, db, req, { error: result.errors.join(' ') });
  }
  res.redirect('/admin');
});

module.exports = router;
module.exports.logSecurityEvent = logSecurityEvent;
