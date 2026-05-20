const express = require('express');
const router = express.Router();
const multer = require('multer');
const { exportWorkbook, importWorkbook } = require('../lib/excel');

const upload = multer({ storage: multer.memoryStorage() });

function getDb(req) { return req.app.locals.db; }

function takeSnapshot(db, label) {
  const data = {
    players:    db.all('SELECT * FROM players'),
    teams:      db.all('SELECT * FROM teams'),
    trades:     db.all('SELECT * FROM trades'),
    trade_legs: db.all('SELECT * FROM trade_legs'),
  };
  db.run('INSERT INTO snapshots (label, data) VALUES (?,?)', [label, JSON.stringify(data)]);
}

router.get('/', (req, res) => {
  const db        = getDb(req);
  const snapshots = db.all('SELECT id, label, created_at FROM snapshots ORDER BY id DESC');
  const sar       = db.all(`
    SELECT le.created_at, le.ip_address, le.user_agent,
           pn.name AS new_player, po.name AS old_player
    FROM login_events le
    JOIN players pn ON le.player_id     = pn.id
    JOIN players po ON le.old_player_id = po.id
    ORDER BY le.id DESC
  `);
  res.render('admin', { title: 'Admin', snapshots, sar, error: null, success: null });
});

// Snapshots
router.post('/snapshot', (req, res) => {
  const db = getDb(req);
  takeSnapshot(db, req.body.label || `manual ${new Date().toISOString()}`);
  res.redirect('/admin');
});

router.post('/snapshot/:id/revert', (req, res) => {
  const db = getDb(req);
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
      [t.id,t.writer_id,t.counterparty_id,t.status,t.confirm_token,t.reject_token,t.amended_from_id||null,t.note||null,t.created_at,t.updated_at]
    );
  }
  for (const l of data.trade_legs) {
    db.run(
      'INSERT INTO trade_legs (id,trade_id,side,team_id,quantity,leg_type,cash_amount,swap_team_id,swap_quantity) VALUES (?,?,?,?,?,?,?,?,?)',
      [l.id,l.trade_id,l.side,l.team_id,l.quantity,l.leg_type,l.cash_amount||null,l.swap_team_id||null,l.swap_quantity||null]
    );
  }

  res.redirect('/admin');
});

// Excel export
router.get('/export.xlsx', async (req, res) => {
  const db = getDb(req);
  const wb = await exportWorkbook(db);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="wctg.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// Excel import
router.post('/import', upload.single('file'), async (req, res) => {
  const db = getDb(req);
  if (!req.file) return res.redirect('/admin');

  takeSnapshot(db, `pre-import ${new Date().toISOString()}`);
  const result = await importWorkbook(req.file.buffer, db);

  if (!result.ok) {
    const snapshots = db.all('SELECT id, label, created_at FROM snapshots ORDER BY id DESC');
    const sar       = db.all(`SELECT le.created_at, le.ip_address, le.user_agent, pn.name AS new_player, po.name AS old_player FROM login_events le JOIN players pn ON le.player_id = pn.id JOIN players po ON le.old_player_id = po.id ORDER BY le.id DESC`);
    return res.render('admin', { title: 'Admin', snapshots, sar, error: result.errors.join(' '), success: null });
  }

  res.redirect('/admin');
});

module.exports = router;
