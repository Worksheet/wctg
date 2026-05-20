const { init } = require('./db');
const fs = require('fs');
const path = require('path');

async function seed() {
  const db = await init();

  const existingTeams = db.all('SELECT id FROM teams');
  if (!existingTeams.length) {
    const lines = fs.readFileSync(path.join(__dirname, 'teams.txt'), 'utf8')
      .split('\n').map(l => l.trim()).filter(Boolean);
    for (const name of lines) {
      db.run('INSERT INTO teams (name) VALUES (?)', [name]);
    }
    console.log(`Seeded ${lines.length} teams.`);
  } else {
    console.log(`Teams already seeded (${existingTeams.length}).`);
  }

  const players = [
    { name: 'Alice Martin',  email: 'alice.martin@example.com' },
    { name: 'Bob Clarke',    email: 'bob.clarke@example.com' },
    { name: 'Carol Davies',  email: 'carol.davies@example.com' },
    { name: 'Dan Evans',     email: 'dan.evans@example.com' },
    { name: 'Eve Foster',    email: 'eve.foster@example.com' },
  ];

  for (const [i, p] of players.entries()) {
    const exists = db.get('SELECT id FROM players WHERE email=?', [p.email]);
    if (!exists) {
      db.run('INSERT INTO players (name,email,display_order) VALUES (?,?,?)', [p.name, p.email, i + 1]);
      console.log(`Added player: ${p.name}`);
    }
  }

  console.log('Seed complete.');
}

seed().catch(err => { console.error(err); process.exit(1); });
