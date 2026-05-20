const express = require('express');
const router = express.Router();
const { computePositions } = require('../lib/positions');
const { buildMailto } = require('../lib/notify');

router.get('/', (req, res) => {
  const db      = req.app.locals.db;
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  const teams   = db.all('SELECT * FROM teams ORDER BY name');
  const pos     = computePositions(db);

  // Trades from today
  const trades = db.all(`
    SELECT t.*, pw.name AS writer_name, pc.name AS cp_name
    FROM trades t
    JOIN players pw ON t.writer_id = pw.id
    JOIN players pc ON t.counterparty_id = pc.id
    ORDER BY t.id DESC
    LIMIT 50
  `);

  for (const t of trades) {
    t.legs = db.all(`
      SELECT tl.*, tm.name AS team_name, st.name AS swap_team_name
      FROM trade_legs tl
      JOIN teams tm ON tl.team_id = tm.id
      LEFT JOIN teams st ON tl.swap_team_id = st.id
      WHERE tl.trade_id = ?`, [t.id]);
  }

  // Build text for email
  const lines = [
    `WCTG Daily Report — ${new Date().toDateString()}`,
    '',
    '=== Recent Trades ===',
  ];
  for (const t of trades) {
    const legStr = t.legs.map(l => {
      const base = `${l.side} ${l.quantity}x ${l.team_name}`;
      return l.leg_type === 'cash' ? `${base} £${l.cash_amount}` : `${base} / ${l.swap_quantity}x ${l.swap_team_name}`;
    }).join(', ');
    lines.push(`#${t.id} [${t.status}] ${t.writer_name} / ${t.cp_name}: ${legStr}`);
  }

  lines.push('', '=== Positions ===');
  for (const team of teams) {
    const row = players.map(p => {
      const v = (pos[team.id] || {})[p.id] || 0;
      return v !== 0 ? `${p.name.split(' ')[0]}:${v}` : null;
    }).filter(Boolean);
    if (row.length) lines.push(`${team.name}: ${row.join(', ')}`);
  }

  const reportText = lines.join('\n');
  const recipientEmails = players.map(p => p.email).join(',');
  const mailtoUrl = buildMailto(recipientEmails, 'WCTG Daily Report', reportText);

  res.render('report', { title: 'Report', trades, teams, players, pos, reportText, mailtoUrl });
});

router.get('/email', (req, res) => {
  const db      = req.app.locals.db;
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  const teams   = db.all('SELECT * FROM teams ORDER BY name');
  const pos     = computePositions(db);

  const trades = db.all(`
    SELECT t.*, pw.name AS writer_name, pc.name AS cp_name
    FROM trades t
    JOIN players pw ON t.writer_id = pw.id
    JOIN players pc ON t.counterparty_id = pc.id
    ORDER BY t.id DESC
    LIMIT 50
  `);
  for (const t of trades) {
    t.legs = db.all(`
      SELECT tl.*, tm.name AS team_name, st.name AS swap_team_name
      FROM trade_legs tl
      JOIN teams tm ON tl.team_id = tm.id
      LEFT JOIN teams st ON tl.swap_team_id = st.id
      WHERE tl.trade_id = ?`, [t.id]);
  }

  const dateStr = new Date().toDateString();
  res.render('report_email', { title: `WCTG Report — ${dateStr}`, trades, teams, players, pos, dateStr });
});

function fetchReportData(req) {
  const db      = req.app.locals.db;
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  const teams   = db.all('SELECT * FROM teams ORDER BY name');
  const pos     = computePositions(db);
  const trades  = db.all(`
    SELECT t.*, pw.name AS writer_name, pc.name AS cp_name
    FROM trades t
    JOIN players pw ON t.writer_id = pw.id
    JOIN players pc ON t.counterparty_id = pc.id
    ORDER BY t.id DESC LIMIT 50
  `);
  for (const t of trades) {
    t.legs = db.all(`
      SELECT tl.*, tm.name AS team_name, st.name AS swap_team_name
      FROM trade_legs tl
      JOIN teams tm ON tl.team_id = tm.id
      LEFT JOIN teams st ON tl.swap_team_id = st.id
      WHERE tl.trade_id = ?`, [t.id]);
  }
  return { db, players, teams, pos, trades };
}

router.get('/email.eml', (req, res) => {
  const { players, teams, pos, trades } = fetchReportData(req);
  const dateStr = new Date().toDateString();
  const subject = `WCTG Daily Report — ${dateStr}`;
  const to      = players.map(p => p.email).filter(Boolean).join(', ');

  const htmlBody = req.app.locals.eta.render('./report_email', {
    title: subject, trades, teams, players, pos, dateStr,
  });

  const textLines = [`WCTG Daily Report — ${dateStr}`, '', '=== Trades ==='];
  for (const t of trades) {
    const legs = t.legs.map(l => {
      const base = `${l.side} ${l.quantity}x ${l.team_name}`;
      return l.leg_type === 'cash' ? `${base} £${l.cash_amount}` : `${base} / ${l.swap_quantity}x ${l.swap_team_name}`;
    }).join(', ');
    textLines.push(`#${t.id} [${t.status}] ${t.writer_name} / ${t.cp_name}: ${legs}`);
  }
  textLines.push('', '=== Positions ===');
  for (const team of teams) {
    const row = players.map(p => {
      const v = (pos[team.id] || {})[p.id] || 0;
      return v !== 0 ? `${p.name.split(' ')[0]}:${v}` : null;
    }).filter(Boolean);
    if (row.length) textLines.push(`${team.name}: ${row.join(', ')}`);
  }
  const textBody = textLines.join('\r\n');

  const boundary = `wctg_${Date.now()}`;
  const eml = [
    'MIME-Version: 1.0',
    `Date: ${new Date().toUTCString()}`,
    `Subject: ${subject}`,
    `To: ${to}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  res.setHeader('Content-Type', 'message/rfc822');
  res.setHeader('Content-Disposition', `attachment; filename="wctg-report.eml"`);
  res.send(eml);
});

module.exports = router;
