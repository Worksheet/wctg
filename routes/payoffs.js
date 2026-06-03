const express = require('express');
const router  = express.Router();

const PAYOFFS = [
  { label: 'First',                                                      value: 55 },
  { label: '2nd',                                                        value: 30 },
  { label: 'Team containing top goal scorer (golden boot)',              value: 20 },
  { label: 'Average number of goals scored per game',                   value: 15 },
  { label: 'Total number of saves made by team',                        value: 15 },
  { label: 'Average number of cards per game (1 red = 2 yellow)',       value: 30 },
  { label: 'Average number of goals conceded per game',                 value: 30 },
  { label: 'Largest losing margin in a single game (excluding penalties)', value: 45 },
];

router.get('/', (req, res) => {
  res.render('payoffs', { title: 'Payoffs', payoffs: PAYOFFS });
});

module.exports = router;
