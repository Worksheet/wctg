const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const { Eta }      = require('eta');
const { init }     = require('./db');

const app = express();
const eta = new Eta({ views: path.join(__dirname, 'templates'), cache: false });
app.locals.eta = eta;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Globals available in every template as it.godMode etc.
app.use((req, res, next) => {
  res.locals.godMode        = req.cookies.wctg_god === '1';
  res.locals.currentPlayerId = req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
  next();
});

// Eta render helper — merges res.locals so layout always has godMode
app.use((req, res, next) => {
  res.render = (template, data) => {
    const html = eta.render(`./${template}`, { ...res.locals, ...(data || {}) });
    res.send(html);
  };
  next();
});

// ── Login ─────────────────────────────────────────────────────────────────────

app.post('/login', (req, res) => {
  const db    = req.app.locals.db;
  const newId = parseInt(req.body.player_id, 10);
  const oldId = req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
  const ip    = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ua    = req.headers['user-agent'] || '';

  const player = db.get('SELECT id FROM players WHERE id = ?', [newId]);
  if (!player) return res.redirect('/trade');

  if (oldId && oldId !== newId) {
    db.run(
      'INSERT INTO login_events (player_id, old_player_id, ip_address, user_agent) VALUES (?,?,?,?)',
      [newId, oldId, ip, ua]
    );
  }

  res.cookie('wctg_player', String(newId), { httpOnly: true, sameSite: 'Lax', maxAge: 365*24*60*60*1000 });
  res.clearCookie('wctg_god'); // logging in as a player exits god mode

  res.redirect(req.body.next || '/trade');
});

// ── Devtools probe (sourcemap request means Sources panel was opened) ─────────

app.get('/devtools-probe.map', (req, res) => {
  const db       = req.app.locals.db;
  const playerId = req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
  const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  db.run('INSERT INTO security_events (event_type, player_id, ip_address, user_agent) VALUES (?,?,?,?)',
    ['devtools-sources', playerId, ip, req.headers['user-agent'] || '']);
  res.type('application/json').json({ version: 3, sources: [], mappings: '' });
});

// ── Client-side suspicious activity reports ───────────────────────────────────

app.post('/api/suspicious', (req, res) => {
  const db       = req.app.locals.db;
  const { type } = req.body;
  if (!type) return res.sendStatus(400);
  const playerId = req.cookies.wctg_player ? parseInt(req.cookies.wctg_player, 10) : null;
  const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  db.run('INSERT INTO security_events (event_type, player_id, ip_address, user_agent) VALUES (?,?,?,?)',
    [type, playerId || null, ip, req.headers['user-agent'] || '']);
  res.sendStatus(200);
});

// ── Routes ────────────────────────────────────────────────────────────────────

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

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

init().then(db => {
  // Auto-seed teams on first run
  if (!db.all('SELECT id FROM teams LIMIT 1').length) {
    const lines = fs.readFileSync(path.join(__dirname, 'teams.txt'), 'utf8')
      .split('\n').map(l => l.trim()).filter(Boolean);
    for (const name of lines) db.run('INSERT INTO teams (name) VALUES (?)', [name]);
    console.log(`Auto-seeded ${lines.length} teams.`);
  }

  app.locals.db = db;
  app.listen(PORT, () => console.log(`WCTG running on http://localhost:${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
