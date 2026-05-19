const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');
const { Eta }      = require('eta');
const { init }     = require('./db');

const app = express();
const eta = new Eta({ views: path.join(__dirname, 'templates'), cache: false });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Eta render helper
app.use((req, res, next) => {
  res.render = (template, data) => {
    const html = eta.render(`./${template}`, data || {});
    res.send(html);
  };
  next();
});

// Login — set player cookie and log switches
app.post('/login', (req, res) => {
  const db          = req.app.locals.db;
  const newId       = parseInt(req.body.player_id, 10);
  const oldId       = req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
  const ip          = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ua          = req.headers['user-agent'] || '';

  const player = db.get('SELECT id FROM players WHERE id = ?', [newId]);
  if (!player) return res.redirect('/trade');

  // Log every switch (old cookie existed and was a different player)
  if (oldId && oldId !== newId) {
    db.run(
      'INSERT INTO login_events (player_id, old_player_id, ip_address, user_agent) VALUES (?,?,?,?)',
      [newId, oldId, ip, ua]
    );
  }

  res.cookie('wctg_player', String(newId), {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
  });

  const redirect = req.body.next || '/trade';
  res.redirect(redirect);
});

// Client-side suspicious activity reports (devtools detection etc.)
app.post('/api/suspicious', (req, res) => {
  const db       = req.app.locals.db;
  const { type } = req.body;
  if (!type) return res.sendStatus(400);
  const playerId = req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
  const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ua       = req.headers['user-agent'] || '';
  db.run('INSERT INTO security_events (event_type, player_id, ip_address, user_agent) VALUES (?,?,?,?)',
    [type, playerId || null, ip, ua]);
  res.sendStatus(200);
});

app.use('/trade',     require('./routes/trade'));
app.use('/blotter',   require('./routes/blotter'));
app.use('/positions', require('./routes/positions'));
app.use('/report',    require('./routes/report'));
app.use('/players',   require('./routes/players'));
app.use('/admin',     require('./routes/admin'));

app.get('/', (req, res) => res.redirect('/trade'));

app.use((req, res) => {
  res.status(404).render('error', { title: '404', message: 'Page not found.' });
});

const PORT = process.env.PORT || 3000;

init().then(db => {
  app.locals.db = db;
  app.listen(PORT, () => console.log(`WCTG running on http://localhost:${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
