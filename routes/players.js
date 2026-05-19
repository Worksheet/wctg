const express = require('express');
const router  = express.Router();

function getDb(req) { return req.app.locals.db; }

router.get('/', (req, res) => {
  const db      = getDb(req);
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  res.render('players', { title: 'Players', players, error: null });
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
