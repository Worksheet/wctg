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

function parseCSVRow(line) {
  const result = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  result.push(field.trim());
  return result;
}

async function parsePlayersFile(buffer, filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();

  let nameIdx = -1;
  let emailIdx = -1;
  const players = [];

  if (ext === 'csv') {
    const lines = buffer.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (!lines.length) return { ok: false, error: 'Empty file.' };

    const header = parseCSVRow(lines[0]).map(h => h.toLowerCase());
    nameIdx  = header.indexOf('name');
    emailIdx = header.indexOf('email');

    if (nameIdx === -1 || emailIdx === -1) {
      return { ok: false, error: 'File must have "Name" and "Email" headers in the first row.' };
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      const name  = cols[nameIdx]  ? cols[nameIdx].trim()  : '';
      const email = cols[emailIdx] ? cols[emailIdx].trim() : '';
      if (name && email) players.push({ name, email });
    }
  } else if (ext === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet(1);
    if (!ws) return { ok: false, error: 'No worksheet found in file.' };

    ws.eachRow((row, i) => {
      if (i === 1) {
        row.eachCell((cell, colNum) => {
          const val = cell.value ? cell.value.toString().toLowerCase().trim() : '';
          if (val === 'name')  nameIdx  = colNum;
          if (val === 'email') emailIdx = colNum;
        });
        return;
      }
      if (nameIdx === -1 || emailIdx === -1) return;
      const name  = row.getCell(nameIdx).value;
      const email = row.getCell(emailIdx).value;
      if (name && email) {
        players.push({ name: name.toString().trim(), email: email.toString().trim() });
      }
    });

    if (nameIdx === -1 || emailIdx === -1) {
      return { ok: false, error: 'File must have "Name" and "Email" headers in the first row.' };
    }
  } else {
    return { ok: false, error: 'Only .csv and .xlsx files are supported.' };
  }

  return { ok: true, players };
}

module.exports = { exportWorkbook, importWorkbook, parsePlayersFile };
