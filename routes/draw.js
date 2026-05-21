const express = require('express');
const router  = express.Router();

router.get('/', (req, res) => {
  const db      = req.app.locals.db;
  const teams   = db.all('SELECT * FROM teams ORDER BY name');
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  if (!players.length) {
    return res.render('error', { title: 'Cannot run draw', message: 'Add players before running the draw.' });
  }
  const drawDone = !!db.get('SELECT id FROM draw_results LIMIT 1');
  res.render('draw', { title: 'Draw', teams, players, drawDone });
});

router.post('/result', (req, res) => {
  const db          = req.app.locals.db;
  const assignments = JSON.parse(req.body.assignments || '[]');
  db.exec('DELETE FROM draw_results');
  for (const { team_id, player_id } of assignments) {
    if (team_id && player_id) {
      db.run('INSERT INTO draw_results (team_id, player_id) VALUES (?,?)',
        [parseInt(team_id, 10), parseInt(player_id, 10)]);
    }
  }
  res.redirect('/draw/results');
});

router.get('/results', (req, res) => {
  const db      = req.app.locals.db;
  const players = db.all('SELECT * FROM players ORDER BY display_order');
  const results = db.all(`
    SELECT dr.*, t.name AS team_name, p.name AS player_name
    FROM draw_results dr
    JOIN teams t ON dr.team_id = t.id
    JOIN players p ON dr.player_id = p.id
    ORDER BY p.display_order, t.name
  `);
  res.render('draw_results', { title: 'Draw Results', players, results });
});

module.exports = router;
