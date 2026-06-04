const express = require('express');
const router = express.Router();
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

module.exports = router;
