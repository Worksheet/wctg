const express = require('express');
const router  = express.Router();
const { generateToken }    = require('../lib/tokens');
const { notify }           = require('../lib/notify');
const { logSecurityEvent } = require('./admin');
const { onTradeActivity }  = require('../lib/scheduler');

function getDb(req) { return req.app.locals.db; }

function cookiePlayer(req) {
  const db = getDb(req);
  const id = req.cookies && req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
  if (!id) return null;
  return db.get('SELECT * FROM players WHERE id = ?', [id]);
}

router.get('/', (req, res) => {
  const db            = getDb(req);
  const players       = db.all('SELECT * FROM players ORDER BY display_order');
  const teams         = db.all('SELECT * FROM teams ORDER BY name');
  const currentPlayer = cookiePlayer(req);
  res.render('trade', { title: 'New Trade', players, teams, error: null, currentPlayer });
});

router.post('/', async (req, res) => {
  const db = getDb(req);
  const { writer_id, counterparty_id, note } = req.body;

  const players       = db.all('SELECT * FROM players ORDER BY display_order');
  const teams         = db.all('SELECT * FROM teams ORDER BY name');
  const currentPlayer = cookiePlayer(req);

  const errors = [];
  if (!writer_id || !counterparty_id) errors.push('Writer and counterparty are required.');

  const sides          = [].concat(req.body.side          || []);
  const teamIds        = [].concat(req.body.team_id       || []);
  const quantities     = [].concat(req.body.quantity      || []);
  const legTypes       = [].concat(req.body.leg_type      || []);
  const cashAmounts    = [].concat(req.body.cash_amount   || []);
  const swapTeamIds    = [].concat(req.body.swap_team_id  || []);
  const swapQuantities = [].concat(req.body.swap_quantity || []);

  if (!sides.length) errors.push('At least one leg is required.');

  const legs = sides.map((side, i) => ({
    side,
    team_id:       parseInt(teamIds[i], 10),
    quantity:      parseInt(quantities[i], 10),
    leg_type:      legTypes[i],
    cash_amount:   legTypes[i] === 'cash' ? parseInt(cashAmounts[i], 10) : null,
    swap_team_id:  legTypes[i] === 'swap' ? parseInt(swapTeamIds[i], 10) : null,
    swap_quantity: legTypes[i] === 'swap' ? parseInt(swapQuantities[i], 10) : null,
  }));

  for (const [i, leg] of legs.entries()) {
    if (!leg.team_id)            errors.push(`Leg ${i+1}: team is required.`);
    if (!(leg.quantity > 0))     errors.push(`Leg ${i+1}: quantity must be a positive integer.`);
    if (leg.leg_type === 'cash' && !(leg.cash_amount >= 0)) errors.push(`Leg ${i+1}: cash amount must be 0 or more.`);
    if (leg.leg_type === 'swap' && !leg.swap_team_id)       errors.push(`Leg ${i+1}: swap team is required.`);
    if (leg.leg_type === 'swap' && !(leg.swap_quantity > 0)) errors.push(`Leg ${i+1}: swap quantity must be positive.`);
  }

  if (errors.length) {
    return res.render('trade', { title: 'New Trade', players, teams, error: errors.join(' '), currentPlayer });
  }

  const godMode      = req.cookies.wctg_god === '1';
  const confirmToken = generateToken();
  const rejectToken  = generateToken();

  const tradeIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const { lastInsertRowid: tradeId } = db.transaction(tx => {
    const { lastInsertRowid } = tx.run(
      `INSERT INTO trades (writer_id, counterparty_id, status, confirm_token, reject_token, note, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [parseInt(writer_id), parseInt(counterparty_id), godMode ? 'confirmed' : 'pending',
       confirmToken, rejectToken, note || null, tradeIp]
    );
    for (const leg of legs) {
      tx.run(
        `INSERT INTO trade_legs (trade_id, side, team_id, quantity, leg_type, cash_amount, swap_team_id, swap_quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [lastInsertRowid, leg.side, leg.team_id, leg.quantity, leg.leg_type, leg.cash_amount, leg.swap_team_id, leg.swap_quantity]
      );
    }
    return { lastInsertRowid };
  });

  const host       = `${req.protocol}://${req.get('host')}`;
  const confirmUrl = `${host}/trade/${tradeId}/confirm?token=${confirmToken}`;
  const rejectUrl  = `${host}/trade/${tradeId}/reject?token=${rejectToken}`;

  const cp = db.get('SELECT * FROM players WHERE id = ?', [parseInt(counterparty_id)]);
  const wr = db.get('SELECT * FROM players WHERE id = ?', [parseInt(writer_id)]);

  if (godMode) {
    onTradeActivity(db);
    return res.render('trade_submitted', { title: 'Trade Submitted', trade: { id: tradeId }, counterparty: cp, godMode: true, confirmUrl: null, rejectUrl: null, mailtoUrl: null, currentPlayer });
  }

  const tradeLegs = db.all(`
    SELECT tl.*, t.name as team_name, st.name as swap_team_name
    FROM trade_legs tl
    JOIN teams t ON tl.team_id = t.id
    LEFT JOIN teams st ON tl.swap_team_id = st.id
    WHERE tl.trade_id = ?`, [tradeId]);

  const bodyLines = tradeLegs.map(l => {
    const base = `${l.side} ${l.quantity}x ${l.team_name}`;
    return l.leg_type === 'cash' ? `${base} for £${l.cash_amount}` : `${base} / ${l.swap_quantity}x ${l.swap_team_name}`;
  });

  const emailBody = [
    `Trade from ${wr.name}:`,
    '',
    ...bodyLines,
    ...(note ? [`\nNote: ${note}`] : []),
    '',
    `Confirm: ${confirmUrl}`,
    `Reject:  ${rejectUrl}`,
  ].join('\n');

  const subject   = `WCTG trade from ${wr.name}`;
  const mailtoUrl = await notify(cp, subject, emailBody, confirmUrl, rejectUrl);

  res.render('trade_submitted', { title: 'Trade Submitted', trade: { id: tradeId }, counterparty: cp, mailtoUrl, confirmUrl, rejectUrl, currentPlayer });
});

// ── Confirm / Reject ──────────────────────────────────────────────────────────

function applyResponse(db, trade, status) {
  db.run(`UPDATE trades SET status=?, updated_at=datetime('now') WHERE id=?`, [status, trade.id]);
}

function checkExpiry(db, trade, res) {
  if (!trade.expires_at) return false;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (trade.expires_at <= now) {
    db.run(`UPDATE trades SET status='expired', updated_at=datetime('now') WHERE id=?`, [trade.id]);
    res.render('error', { title: 'Link Expired', message: `This amendment (trade #${trade.id}) expired on ${trade.expires_at.slice(0, 16)}.` });
    return true;
  }
  return false;
}

// Writer is blocked from confirming/rejecting unless they are the expected responder.
// auto_confirmed_side='counterparty' means the counterparty already confirmed their side
// by submitting the amendment, so the writer IS the expected responder.
function isWriterSelf(cookie, trade) {
  return cookie && cookie.id === trade.writer_id && trade.auto_confirmed_side !== 'counterparty';
}

router.get('/:id/confirm', (req, res) => {
  const db    = getDb(req);
  const trade = db.get('SELECT * FROM trades WHERE id = ?', [parseInt(req.params.id)]);
  if (!trade) return res.status(404).render('error', { title: 'Not Found', message: 'Trade not found.' });
  if (trade.confirm_token !== req.query.token) {
    logSecurityEvent(db, req, 'wrong-confirm-token', cookiePlayer(req)?.id, `Trade #${trade.id}`);
    return res.status(403).render('error', { title: 'Invalid Link', message: 'This confirmation link is invalid.' });
  }
  if (trade.status !== 'pending') return res.render('token_used', { title: 'Already Responded', trade });
  if (checkExpiry(db, trade, res)) return;

  const cookie  = cookiePlayer(req);
  const godMode = req.cookies.wctg_god === '1';
  if (!godMode) {
    if (isWriterSelf(cookie, trade)) {
      const host = `${req.protocol}://${req.get('host')}`;
      return res.render('writer_self', {
        title: 'Wrong link',
        writer:       db.get('SELECT * FROM players WHERE id=?', [trade.writer_id]),
        counterparty: db.get('SELECT * FROM players WHERE id=?', [trade.counterparty_id]),
        confirmUrl: `${host}/trade/${trade.id}/confirm?token=${trade.confirm_token}`,
        rejectUrl:  `${host}/trade/${trade.id}/reject?token=${trade.reject_token}`,
      });
    }
    if (cookie && cookie.id !== trade.writer_id && cookie.id !== trade.counterparty_id) {
      logSecurityEvent(db, req, 'blocked-confirm', cookie.id, `Trade #${trade.id}`);
      return res.render('error', { title: 'Not your trade', message: `You are logged in as ${cookie.name}, who is not a party to this trade.` });
    }
  }

  db.transaction(tx => {
    tx.run(`UPDATE trades SET status=?, updated_at=datetime('now') WHERE id=?`, ['confirmed', trade.id]);
    // When an amendment is confirmed, mark the original trade as amended atomically
    if (trade.amended_from_id) {
      tx.run(`UPDATE trades SET status='amended', updated_at=datetime('now') WHERE id=?`, [trade.amended_from_id]);
    }
  });
  onTradeActivity(db);
  notify(
    db.get('SELECT * FROM players WHERE id=?', [trade.writer_id]),
    `Trade #${trade.id} confirmed`,
    `${db.get('SELECT name FROM players WHERE id=?', [trade.counterparty_id]).name} confirmed your trade.`
  );
  res.render('confirmed', { title: 'Trade Confirmed', trade });
});

router.get('/:id/reject', (req, res) => {
  const db    = getDb(req);
  const trade = db.get('SELECT * FROM trades WHERE id = ?', [parseInt(req.params.id)]);
  if (!trade) return res.status(404).render('error', { title: 'Not Found', message: 'Trade not found.' });
  if (trade.reject_token !== req.query.token) {
    logSecurityEvent(db, req, 'wrong-reject-token', cookiePlayer(req)?.id, `Trade #${trade.id}`);
    return res.status(403).render('error', { title: 'Invalid Link', message: 'This rejection link is invalid.' });
  }
  if (trade.status !== 'pending') return res.render('token_used', { title: 'Already Responded', trade });
  if (checkExpiry(db, trade, res)) return;

  const cookie  = cookiePlayer(req);
  const godMode = req.cookies.wctg_god === '1';
  if (!godMode) {
    if (isWriterSelf(cookie, trade)) {
      const host = `${req.protocol}://${req.get('host')}`;
      return res.render('writer_self', {
        title: 'Wrong link',
        writer:       db.get('SELECT * FROM players WHERE id=?', [trade.writer_id]),
        counterparty: db.get('SELECT * FROM players WHERE id=?', [trade.counterparty_id]),
        confirmUrl: `${host}/trade/${trade.id}/confirm?token=${trade.confirm_token}`,
        rejectUrl:  `${host}/trade/${trade.id}/reject?token=${trade.reject_token}`,
      });
    }
    if (cookie && cookie.id !== trade.writer_id && cookie.id !== trade.counterparty_id) {
      logSecurityEvent(db, req, 'blocked-reject', cookie.id, `Trade #${trade.id}`);
      return res.render('error', { title: 'Not your trade', message: `You are logged in as ${cookie.name}, who is not a party to this trade.` });
    }
  }

  applyResponse(db, trade, 'rejected');
  notify(
    db.get('SELECT * FROM players WHERE id=?', [trade.writer_id]),
    `Trade #${trade.id} rejected`,
    `${db.get('SELECT name FROM players WHERE id=?', [trade.counterparty_id]).name} rejected your trade.`
  );
  res.render('rejected', { title: 'Trade Rejected', trade });
});

module.exports = router;
