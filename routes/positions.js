const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { computePositions } = require('../lib/positions');

function computeUserTradePositions(db, playerId) {
  if (!playerId) return { trades: [], teamIds: [] };

  const legs = db.all(`
    SELECT tl.trade_id, tl.side, tl.team_id, tl.quantity,
           tl.leg_type, tl.swap_team_id, tl.swap_quantity,
           t.writer_id, t.counterparty_id
    FROM trade_legs tl
    JOIN trades t ON tl.trade_id = t.id
    WHERE t.status = 'confirmed'
      AND (t.writer_id = ? OR t.counterparty_id = ?)
  `, [playerId, playerId]);

  const tradeMap = {};

  function add(tradeId, teamId, delta) {
    if (!tradeMap[tradeId]) tradeMap[tradeId] = {};
    tradeMap[tradeId][teamId] = (tradeMap[tradeId][teamId] || 0) + delta;
  }

  for (const leg of legs) {
    const isWriter = leg.writer_id === playerId;
    const sign = leg.side === 'BUY' ? 1 : -1;
    const playerSign = isWriter ? sign : -sign;

    add(leg.trade_id, leg.team_id, playerSign * leg.quantity);

    if (leg.leg_type === 'swap' && leg.swap_team_id) {
      const swapSign = leg.side === 'BUY' ? -1 : 1;
      const playerSwapSign = isWriter ? swapSign : -swapSign;
      add(leg.trade_id, leg.swap_team_id, playerSwapSign * leg.swap_quantity);
    }
  }

  const teamIdSet = new Set();
  for (const positions of Object.values(tradeMap)) {
    for (const [teamId, qty] of Object.entries(positions)) {
      if (qty !== 0) teamIdSet.add(parseInt(teamId));
    }
  }

  const tradeIds = Object.keys(tradeMap).map(Number).sort((a, b) => a - b);
  const trades = tradeIds.map(tradeId => ({
    id: tradeId,
    positions: tradeMap[tradeId] || {}
  }));

  return { trades, teamIds: [...teamIdSet] };
}

router.get('/', (req, res) => {
  const db      = req.app.locals.db;
  const teams   = db.all('SELECT * FROM teams ORDER BY name');
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  const pos     = computePositions(db);

  const currentPlayerId = res.locals.currentPlayerId;
  const currentPlayer   = currentPlayerId
    ? db.get('SELECT * FROM players WHERE id = ?', [currentPlayerId])
    : null;
  const userTradePos = computeUserTradePositions(db, currentPlayerId);
  const userTeams    = teams.filter(t => userTradePos.teamIds.includes(t.id));

  res.render('positions', { title: 'Positions', teams, players, pos, currentPlayer, userTradePos, userTeams });
});

router.get('/download', async (req, res) => {
  const db      = req.app.locals.db;
  const teams   = db.all('SELECT * FROM teams ORDER BY name');
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  const pos     = computePositions(db);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Positions');

  sheet.addRow(['Team', ...players.map(p => p.name)]);

  for (const team of teams) {
    const row = players.map(p => (pos[team.id] || {})[p.id] || 0);
    if (row.some(v => v !== 0)) {
      sheet.addRow([team.name, ...row.map(v => v !== 0 ? v : '')]);
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="positions.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

router.get('/player-download/:id', async (req, res) => {
  const db       = req.app.locals.db;
  const playerId = parseInt(req.params.id, 10);
  const player   = db.get('SELECT * FROM players WHERE id = ?', [playerId]);
  if (!player) return res.status(404).send('Player not found');

  const teams        = db.all('SELECT * FROM teams ORDER BY name');
  const userTradePos = computeUserTradePositions(db, playerId);
  const userTeams    = teams.filter(t => userTradePos.teamIds.includes(t.id));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${player.name}`);

  sheet.addRow(['Trade', ...userTeams.map(t => t.name)]);

  for (const trade of userTradePos.trades) {
    sheet.addRow([`#${trade.id}`, ...userTeams.map(t => {
      const v = trade.positions[t.id] || 0;
      return v !== 0 ? v : '';
    })]);
  }

  const totals = userTeams.map(t =>
    userTradePos.trades.reduce((sum, trd) => sum + (trd.positions[t.id] || 0), 0)
  );
  sheet.addRow(['Total', ...totals.map(v => v !== 0 ? v : '')]);

  const safeName = player.name.replace(/[^a-z0-9]/gi, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_positions.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

router.get('/player-data/:id', (req, res) => {
  const db       = req.app.locals.db;
  const playerId = parseInt(req.params.id, 10);
  const player   = db.get('SELECT * FROM players WHERE id = ?', [playerId]);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const teams        = db.all('SELECT * FROM teams ORDER BY name');
  const userTradePos = computeUserTradePositions(db, playerId);
  const userTeams    = teams.filter(t => userTradePos.teamIds.includes(t.id));

  res.json({ player, userTradePos, userTeams });
});

module.exports = router;
