/**
 * Returns { [teamId]: { [playerId]: netQty } } from confirmed trades.
 *
 * For each leg (from writer's perspective):
 *   BUY  primary: writer +qty,      counterparty -qty
 *   SELL primary: writer -qty,      counterparty +qty
 *   SWAP (BUY):   writer -swapQty of swapTeam, counterparty +swapQty
 *   SWAP (SELL):  writer +swapQty of swapTeam, counterparty -swapQty
 */
function computePositions(db) {
  const legs = db.all(`
    SELECT tl.trade_id, tl.side, tl.team_id, tl.quantity,
           tl.leg_type, tl.swap_team_id, tl.swap_quantity,
           t.writer_id, t.counterparty_id
    FROM trade_legs tl
    JOIN trades t ON tl.trade_id = t.id
    WHERE t.status = 'confirmed'
  `);

  const pos = {};

  function add(teamId, playerId, delta) {
    if (!pos[teamId]) pos[teamId] = {};
    pos[teamId][playerId] = (pos[teamId][playerId] || 0) + delta;
  }

  for (const leg of legs) {
    const sign = leg.side === 'BUY' ? 1 : -1;
    add(leg.team_id, leg.writer_id,       sign * leg.quantity);
    add(leg.team_id, leg.counterparty_id, -sign * leg.quantity);

    if (leg.leg_type === 'swap' && leg.swap_team_id) {
      // writer gives swap team when buying, receives when selling
      const swapSign = leg.side === 'BUY' ? -1 : 1;
      add(leg.swap_team_id, leg.writer_id,       swapSign * leg.swap_quantity);
      add(leg.swap_team_id, leg.counterparty_id, -swapSign * leg.swap_quantity);
    }
  }

  return pos;
}

module.exports = { computePositions };
