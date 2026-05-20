const express = require('express');
const router = express.Router();
const { computePositions } = require('../lib/positions');

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const teams   = db.all('SELECT * FROM teams ORDER BY name');
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  const pos     = computePositions(db);

  res.render('positions', { title: 'Positions', teams, players, pos });
});

module.exports = router;
