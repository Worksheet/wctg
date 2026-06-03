const express = require('express');
const router  = express.Router();
const { generateToken } = require('../lib/tokens');
const { notify }        = require('../lib/notify');

function getDb(req) { return req.app.locals.db; }

function cookiePlayer(req) {
  const db = getDb(req);
  const id = req.cookies && req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
  if (!id) return null;
  return db.get('SELECT * FROM players WHERE id = ?', [id]);
}

function expirePending(db) {
  db.run(`
    UPDATE trades SET status = 'expired', updated_at = datetime('now')
    WHERE status = 'pending'
    AND amended_from_id IS NOT NULL
    AND expires_at IS NOT NULL
    AND expires_at <= datetime('now')
  `);
}

function enrichTrade(trade, db) {
  trade.writer       = db.get('SELECT * FROM players WHERE id=?', [trade.writer_id]);
  trade.counterparty = db.get('SELECT * FROM players WHERE id=?', [trade.counterparty_id]);
  trade.legs = db.all(`
    SELECT tl.*, t.name AS team_name, st.name AS swap_team_name
    FROM trade_legs tl
    JOIN teams t ON tl.team_id = t.id
    LEFT JOIN teams st ON tl.swap_team_id = st.id
    WHERE tl.trade_id = ?
    ORDER BY tl.id`, [trade.id]);
  trade.pendingAmendment = db.get(
    `SELECT id, expires_at, confirm_token, reject_token, auto_confirmed_side
     FROM trades WHERE amended_from_id = ? AND status = 'pending'`,
    [trade.id]
  );
  return trade;
}

router.get('/', (req, res) => {
  const db = getDb(req);
  expirePending(db);

  const { status, player_id } = req.query;

  const godMode = req.cookies.wctg_god === '1';

  // Non-god-mode: deleted trades are hidden entirely.
  // Amendments that never completed surface as inline badges; only confirmed amendments get their own row.
  let sql = godMode
    ? `SELECT * FROM trades WHERE (amended_from_id IS NULL OR status IN ('confirmed','deleted'))`
    : `SELECT * FROM trades WHERE (amended_from_id IS NULL OR status = 'confirmed') AND status != 'deleted'`;
  const params = [];
  if (status)    { sql += ` AND status = ?`; params.push(status); }
  if (player_id) { sql += ` AND (writer_id = ? OR counterparty_id = ?)`; params.push(parseInt(player_id), parseInt(player_id)); }
  sql += ` ORDER BY id DESC`;

  const trades  = db.all(sql, params).map(t => enrichTrade(t, db));
  const players = db.all('SELECT * FROM players ORDER BY display_order');

  const statusOptions = ['pending', 'confirmed', 'rejected', 'amended', 'superseded', 'expired', ...(godMode ? ['deleted'] : [])];
  res.render('blotter', { title: 'Blotter', trades, players, filters: { status: status || '', player_id: player_id || '' }, statusOptions, godMode });
});

router.get('/:id', (req, res) => {
  const db      = getDb(req);
  const godMode = req.cookies.wctg_god === '1';
  expirePending(db);
  const trade = db.get('SELECT * FROM trades WHERE id=?', [parseInt(req.params.id)]);
  if (!trade) return res.status(404).render('error', { title: 'Not Found', message: 'Trade not found.' });
  if (trade.status === 'deleted' && !godMode) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Trade not found.' });
  }

  enrichTrade(trade, db);

  const chain = [];
  let cur = trade;
  while (cur.amended_from_id) {
    cur = db.get('SELECT * FROM trades WHERE id=?', [cur.amended_from_id]);
    if (cur) chain.push(enrichTrade(cur, db));
    else break;
  }

  // Compute exposures for just this trade
  const exposurePos = {};
  function addExposure(teamId, playerId, delta) {
    if (!exposurePos[teamId]) exposurePos[teamId] = {};
    exposurePos[teamId][playerId] = (exposurePos[teamId][playerId] || 0) + delta;
  }
  const teamNamesById = {};
  for (const leg of trade.legs) {
    teamNamesById[leg.team_id] = leg.team_name;
    if (leg.swap_team_id) teamNamesById[leg.swap_team_id] = leg.swap_team_name;
    const sign = leg.side === 'BUY' ? 1 : -1;
    addExposure(leg.team_id, trade.writer_id,       sign * leg.quantity);
    addExposure(leg.team_id, trade.counterparty_id, -sign * leg.quantity);
    if (leg.leg_type === 'swap' && leg.swap_team_id) {
      const swapSign = leg.side === 'BUY' ? -1 : 1;
      addExposure(leg.swap_team_id, trade.writer_id,       swapSign * leg.swap_quantity);
      addExposure(leg.swap_team_id, trade.counterparty_id, -swapSign * leg.swap_quantity);
    }
  }
  const exposureRows = Object.keys(exposurePos)
    .map(teamId => ({
      teamName: teamNamesById[parseInt(teamId)] || `Team ${teamId}`,
      writerQty:       exposurePos[teamId][trade.writer_id]       || 0,
      counterpartyQty: exposurePos[teamId][trade.counterparty_id] || 0,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));

  const host       = `${req.protocol}://${req.get('host')}`;
  const confirmUrl = trade.status === 'pending' ? `${host}/trade/${trade.id}/confirm?token=${trade.confirm_token}` : null;
  const rejectUrl  = trade.status === 'pending' ? `${host}/trade/${trade.id}/reject?token=${trade.reject_token}`  : null;
  res.render('trade_detail', { title: `Trade #${trade.id}`, trade, chain, confirmUrl, rejectUrl, godMode, exposureRows });
});

router.post('/:id/delete', (req, res) => {
  if (req.cookies.wctg_god !== '1') {
    return res.status(403).render('error', { title: 'God Mode required', message: 'Only God Mode can delete trades.' });
  }
  const db    = getDb(req);
  const trade = db.get('SELECT * FROM trades WHERE id=?', [parseInt(req.params.id)]);
  if (!trade) return res.status(404).render('error', { title: 'Not Found', message: 'Trade not found.' });
  db.run(`UPDATE trades SET status='deleted', updated_at=datetime('now') WHERE id=?`, [trade.id]);
  res.redirect('/blotter');
});

function checkAmendAuth(req, trade, res) {
  const cookie = cookiePlayer(req);
  if (!cookie) {
    res.render('error', { title: 'Login required', message: 'You must be logged in to submit an amendment. Select your name on the New Trade page.' });
    return false;
  }
  return true;
}

router.get('/:id/amend', (req, res) => {
  const db = getDb(req);
  const trade = db.get('SELECT * FROM trades WHERE id=?', [parseInt(req.params.id)]);
  if (!trade) return res.status(404).render('error', { title: 'Not Found', message: 'Trade not found.' });
  if (!['pending', 'confirmed'].includes(trade.status)) {
    return res.render('error', { title: 'Cannot Amend', message: `Trade #${trade.id} cannot be amended in its current state.` });
  }
  if (!checkAmendAuth(req, trade, res)) return;
  enrichTrade(trade, db);
  const teams = db.all('SELECT * FROM teams ORDER BY name');
  res.render('amend', { title: `Amend Trade #${trade.id}`, trade, teams, error: null });
});

router.post('/:id/amend', async (req, res) => {
  const db       = getDb(req);
  const original = db.get('SELECT * FROM trades WHERE id=?', [parseInt(req.params.id)]);
  if (!original) return res.status(404).render('error', { title: 'Not Found', message: 'Trade not found.' });
  if (!['pending', 'confirmed'].includes(original.status)) {
    return res.render('error', { title: 'Cannot Amend', message: `Trade #${original.id} cannot be amended in its current state.` });
  }
  if (!checkAmendAuth(req, original, res)) return;

  const { note } = req.body;
  const sides          = [].concat(req.body.side          || []);
  const teamIds        = [].concat(req.body.team_id       || []);
  const quantities     = [].concat(req.body.quantity      || []);
  const legTypes       = [].concat(req.body.leg_type      || []);
  const cashAmounts    = [].concat(req.body.cash_amount   || []);
  const swapTeamIds    = [].concat(req.body.swap_team_id  || []);
  const swapQuantities = [].concat(req.body.swap_quantity || []);

  const errors = [];
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
    if (!leg.team_id)            errors.push(`Leg ${i+1}: team required.`);
    if (!(leg.quantity > 0))     errors.push(`Leg ${i+1}: quantity must be positive.`);
    if (leg.leg_type === 'cash' && !(leg.cash_amount >= 0)) errors.push(`Leg ${i+1}: cash amount must be 0 or more.`);
    if (leg.leg_type === 'swap' && !leg.swap_team_id)       errors.push(`Leg ${i+1}: swap team required.`);
    if (leg.leg_type === 'swap' && !(leg.swap_quantity > 0)) errors.push(`Leg ${i+1}: swap qty must be positive.`);
  }

  if (errors.length) {
    const teams = db.all('SELECT * FROM teams ORDER BY name');
    enrichTrade(original, db);
    return res.render('amend', { title: `Amend Trade #${original.id}`, trade: original, teams, error: errors.join(' ') });
  }

  // Supersede any existing pending amendment on this trade (for audit, not deleted)
  db.run(
    `UPDATE trades SET status = 'superseded', updated_at = datetime('now')
     WHERE amended_from_id = ? AND status = 'pending'`,
    [original.id]
  );

  const godMode = req.cookies.wctg_god === '1';

  // Detect which side the amender is on (ignored in god mode)
  const cookie = cookiePlayer(req);
  let autoSide = null;
  if (!godMode && cookie) {
    if (cookie.id === original.writer_id)            autoSide = 'writer';
    else if (cookie.id === original.counterparty_id) autoSide = 'counterparty';
  }

  const confirmToken = generateToken();
  const rejectToken  = generateToken();

  let newId;
  if (godMode) {
    ({ lastInsertRowid: newId } = db.run(
      `INSERT INTO trades (writer_id, counterparty_id, status, confirm_token, reject_token,
                           amended_from_id, note, auto_confirmed_side, expires_at)
       VALUES (?, ?, 'confirmed', ?, ?, ?, ?, null, null)`,
      [original.writer_id, original.counterparty_id, confirmToken, rejectToken, original.id, note || null]
    ));
    db.run(`UPDATE trades SET status='amended', updated_at=datetime('now') WHERE id=?`, [original.id]);
    return res.redirect(`/blotter/${newId}`);
  }

  ({ lastInsertRowid: newId } = db.run(
    `INSERT INTO trades (writer_id, counterparty_id, status, confirm_token, reject_token,
                         amended_from_id, note, auto_confirmed_side, expires_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, datetime('now', '+24 hours'))`,
    [original.writer_id, original.counterparty_id, confirmToken, rejectToken, original.id, note || null, autoSide]
  ));

  for (const leg of legs) {
    db.run(
      `INSERT INTO trade_legs (trade_id, side, team_id, quantity, leg_type, cash_amount, swap_team_id, swap_quantity)
       VALUES (?,?,?,?,?,?,?,?)`,
      [newId, leg.side, leg.team_id, leg.quantity, leg.leg_type, leg.cash_amount, leg.swap_team_id, leg.swap_quantity]
    );
  }

  const host       = `${req.protocol}://${req.get('host')}`;
  const confirmUrl = `${host}/trade/${newId}/confirm?token=${confirmToken}`;
  const rejectUrl  = `${host}/trade/${newId}/reject?token=${rejectToken}`;

  const wr = db.get('SELECT * FROM players WHERE id=?', [original.writer_id]);
  const cp = db.get('SELECT * FROM players WHERE id=?', [original.counterparty_id]);

  const subject = `WCTG trade #${original.id} amended`;
  const body    = `Trade #${original.id} has been amended (new trade #${newId}).\n\nConfirm: ${confirmUrl}\nReject: ${rejectUrl}`;

  // Only notify the other party when amender is identified; otherwise notify both
  let writerMailto, cpMailto;
  if (autoSide === 'writer') {
    cpMailto     = await notify(cp, subject, body, confirmUrl, rejectUrl);
    writerMailto = null;
  } else if (autoSide === 'counterparty') {
    writerMailto = await notify(wr, subject, body, confirmUrl, rejectUrl);
    cpMailto     = null;
  } else {
    [writerMailto, cpMailto] = await Promise.all([
      notify(wr, subject, body, confirmUrl, rejectUrl),
      notify(cp, subject, body, confirmUrl, rejectUrl),
    ]);
  }

  res.render('amend_submitted', {
    title: 'Amendment Submitted',
    originalId: original.id,
    newId,
    autoSide,
    writerMailto,
    cpMailto,
    writer: wr,
    counterparty: cp,
    confirmUrl,
    rejectUrl,
  });
});

module.exports = router;
