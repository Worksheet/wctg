const express = require('express');
const router  = express.Router();

function getDb(req) { return req.app.locals.db; }

router.get('/', (req, res) => {
  const db      = getDb(req);
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  res.render('players', { title: 'Players', players, error: null, added: null });
});

router.post('/', (req, res) => {
  const db = getDb(req);
  const { name, email } = req.body;
  if (!name || !email) {
    const players = db.all('SELECT * FROM players ORDER BY display_order');
    return res.render('players', { title: 'Players', players, error: 'Name and email are required.', added: null });
  }
  const order = (db.get('SELECT MAX(display_order) AS m FROM players') || {}).m || 0;
  db.run('INSERT INTO players (name,email,display_order) VALUES (?,?,?)', [name, email, order + 1]);
  res.redirect('/players');
});

// Only name and ntfy_topic are user-editable; email and delete are admin-only
router.post('/:id', (req, res) => {
  const db = getDb(req);
  const { name, ntfy_topic } = req.body;
  db.run('UPDATE players SET name=?, ntfy_topic=? WHERE id=?',
    [name, ntfy_topic || null, parseInt(req.params.id)]);
  res.redirect('/players');
});

module.exports = router;
