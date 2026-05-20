const express = require('express');
const router  = express.Router();

function getDb(req) { return req.app.locals.db; }

router.get('/', (req, res) => {
  const db      = getDb(req);
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  res.render('players', { title: 'Players', players, error: null, success: null });
});

router.post('/', (req, res) => {
  const db = getDb(req);
  const { name, email, ntfy_topic } = req.body;
  if (!name || !email) {
    const players = db.all('SELECT * FROM players ORDER BY display_order');
    return res.render('players', { title: 'Players', players, error: 'Name and email are required.', success: null });
  }
  const order = (db.get('SELECT MAX(display_order) AS m FROM players') || {}).m || 0;
  db.run('INSERT INTO players (name,email,ntfy_topic,display_order) VALUES (?,?,?,?)',
    [name, email, ntfy_topic || null, order + 1]);
  res.redirect('/players');
});

router.post('/:id', (req, res) => {
  const db = getDb(req);
  const { name, email, ntfy_topic } = req.body;
  db.run('UPDATE players SET name=?, email=?, ntfy_topic=? WHERE id=?',
    [name, email, ntfy_topic || null, parseInt(req.params.id)]);
  res.redirect('/players');
});

router.post('/:id/delete', (req, res) => {
  const db = getDb(req);
  db.run('DELETE FROM players WHERE id=?', [parseInt(req.params.id)]);
  res.redirect('/players');
});

module.exports = router;
