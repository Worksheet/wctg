const express = require('express');
const router  = express.Router();

function getDb(req) { return req.app.locals.db; }

function currentPlayerId(req) {
  return req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
}

router.get('/', (req, res) => {
  const db      = getDb(req);
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  res.render('players', { title: 'Players', players, error: null });
});

router.post('/', (req, res) => {
  const db = getDb(req);
  const { name, email } = req.body;
  if (!name || !email) {
    const players = db.all('SELECT * FROM players ORDER BY display_order');
    return res.render('players', { title: 'Players', players, error: 'Name and email are required.' });
  }
  const order = (db.get('SELECT MAX(display_order) AS m FROM players') || {}).m || 0;
  db.run('INSERT INTO players (name,email,display_order) VALUES (?,?,?)', [name, email, order + 1]);
  res.redirect('/players');
});

// Privacy model for the public players page:
//   - Emails: rendered in the template as first-3 + CSS-blurred middle + last-3 characters.
//     The full address is in the HTML source but not readable without DevTools (which is logged).
//     Full email editing is admin-only (/admin).
//   - Ntfy topics: same blur treatment for other players' rows. Your own row shows a plain
//     editable input, matched by the wctg_player cookie via res.locals.currentPlayerId.
//     This POST handler enforces the same rule server-side: ntfy_topic is only written when
//     the logged-in player matches the row being saved, so saving someone else's name cannot
//     accidentally clear their topic.
router.post('/:id', (req, res) => {
  const db    = getDb(req);
  const rowId = parseInt(req.params.id, 10);
  const myId  = currentPlayerId(req);
  const { name, ntfy_topic } = req.body;
  if (myId === rowId) {
    db.run('UPDATE players SET name=?, ntfy_topic=? WHERE id=?', [name, ntfy_topic || null, rowId]);
  } else {
    db.run('UPDATE players SET name=? WHERE id=?', [name, rowId]);
  }
  res.redirect('/players');
});

module.exports = router;
