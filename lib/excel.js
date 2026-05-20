const ExcelJS = require('exceljs');

async function exportWorkbook(db) {
  const wb = new ExcelJS.Workbook();

  function addSheet(name, rows, cols) {
    const ws = wb.addWorksheet(name);
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true };
    for (const row of rows) ws.addRow(cols.map(c => row[c]));
    return ws;
  }

  const players = db.all('SELECT * FROM players ORDER BY display_order');
  addSheet('players', players, ['id','name','email','ntfy_topic','display_order','created_at']);

  const teams = db.all('SELECT * FROM teams ORDER BY id');
  addSheet('teams', teams, ['id','name','code']);

  const trades = db.all('SELECT * FROM trades ORDER BY id');
  addSheet('trades', trades, ['id','writer_id','counterparty_id','status','confirm_token','reject_token','amended_from_id','note','created_at','updated_at']);

  const legs = db.all('SELECT * FROM trade_legs ORDER BY id');
  addSheet('trade_legs', legs, ['id','trade_id','side','team_id','quantity','leg_type','cash_amount','swap_team_id','swap_quantity']);

  return wb;
}

async function importWorkbook(buffer, db) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  function sheetRows(name, cols) {
    const ws = wb.getWorksheet(name);
    if (!ws) return [];
    const rows = [];
    ws.eachRow((row, i) => {
      if (i === 1) return; // header
      const obj = {};
      cols.forEach((c, j) => { obj[c] = row.getCell(j + 1).value; });
      rows.push(obj);
    });
    return rows;
  }

  const players  = sheetRows('players',    ['id','name','email','ntfy_topic','display_order','created_at']);
  const teams    = sheetRows('teams',      ['id','name','code']);
  const trades   = sheetRows('trades',     ['id','writer_id','counterparty_id','status','confirm_token','reject_token','amended_from_id','note','created_at','updated_at']);
  const legs     = sheetRows('trade_legs', ['id','trade_id','side','team_id','quantity','leg_type','cash_amount','swap_team_id','swap_quantity']);

  // Basic validation
  const errors = [];
  if (!players.length) errors.push('players sheet is empty');
  if (!teams.length)   errors.push('teams sheet is empty');
  if (errors.length) return { ok: false, errors };

  // Overwrite — snapshot is taken by caller before this runs
  db.exec(`
    DELETE FROM trade_legs;
    DELETE FROM trades;
    DELETE FROM players;
    DELETE FROM teams;
    DELETE FROM snapshots;
  `);

  for (const p of players) {
    db.run(
      'INSERT INTO players (id,name,email,ntfy_topic,display_order,created_at) VALUES (?,?,?,?,?,?)',
      [p.id, p.name, p.email, p.ntfy_topic || null, p.display_order, p.created_at]
    );
  }
  for (const t of teams) {
    db.run('INSERT INTO teams (id,name,code) VALUES (?,?,?)', [t.id, t.name, t.code || null]);
  }
  for (const t of trades) {
    db.run(
      'INSERT INTO trades (id,writer_id,counterparty_id,status,confirm_token,reject_token,amended_from_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [t.id,t.writer_id,t.counterparty_id,t.status,t.confirm_token,t.reject_token,t.amended_from_id||null,t.note||null,t.created_at,t.updated_at]
    );
  }
  for (const l of legs) {
    db.run(
      'INSERT INTO trade_legs (id,trade_id,side,team_id,quantity,leg_type,cash_amount,swap_team_id,swap_quantity) VALUES (?,?,?,?,?,?,?,?,?)',
      [l.id,l.trade_id,l.side,l.team_id,l.quantity,l.leg_type,l.cash_amount||null,l.swap_team_id||null,l.swap_quantity||null]
    );
  }

  return { ok: true };
}

module.exports = { exportWorkbook, importWorkbook };
