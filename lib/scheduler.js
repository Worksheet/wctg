// Scheduled and trade-triggered DB snapshots.
// Times are in Europe/London (UK) timezone — the server is deployed in lhr.

const SCHEDULED_HOURS = [8, 12, 18]; // 8am, 12pm, 6pm UK
const FIRE_WINDOW_MINUTES = 5;       // fire within first N mins of target hour
const OFF_HOURS_DELAY_MS  = 60 * 60 * 1000; // 1 hour

const snapFired = new Set(); // tracks 'YYYY-MM-DD-HH' keys already snapped
let offHoursTimer = null;

function snapshot(db, label) {
  const data = {
    players:    db.all('SELECT * FROM players'),
    teams:      db.all('SELECT * FROM teams'),
    trades:     db.all('SELECT * FROM trades'),
    trade_legs: db.all('SELECT * FROM trade_legs'),
  };
  db.run('INSERT INTO snapshots (label, data) VALUES (?,?)', [label, JSON.stringify(data)]);
}

function getUKParts(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: 'numeric',
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    ukDate:    `${parts.year}-${parts.month}-${parts.day}`,
    hour:      parseInt(parts.hour, 10),
    minute:    parseInt(parts.minute, 10),
    isWeekend: parts.weekday === 'Saturday' || parts.weekday === 'Sunday',
  };
}

function isOffHours(date) {
  const { hour, isWeekend } = getUKParts(date);
  if (isWeekend) return true;
  return hour < 7 || hour >= 18; // before 7am or from 6pm onwards
}

function startScheduler(db) {
  setInterval(() => {
    const now = new Date();
    const { ukDate, hour, minute, isWeekend } = getUKParts(now);

    if (isWeekend) return;
    if (!SCHEDULED_HOURS.includes(hour)) return;
    if (minute > FIRE_WINDOW_MINUTES) return;

    const key = `${ukDate}-${hour}`;
    if (snapFired.has(key)) return;
    snapFired.add(key);

    // Prune keys from other dates
    for (const k of snapFired) {
      if (!k.startsWith(ukDate)) snapFired.delete(k);
    }

    const label = `scheduled ${String(hour).padStart(2, '0')}:00 UK ${now.toISOString()}`;
    snapshot(db, label);
    console.log(`[scheduler] Snapshot: ${label}`);
  }, 60_000);
}

// Call this whenever a trade is confirmed. If it's off-hours, a snapshot is
// taken 1 hour after the most recent trade (timer resets on each call).
function onTradeActivity(db) {
  if (!isOffHours(new Date())) return;

  if (offHoursTimer) clearTimeout(offHoursTimer);
  offHoursTimer = setTimeout(() => {
    offHoursTimer = null;
    const label = `trade-triggered off-hours ${new Date().toISOString()}`;
    snapshot(db, label);
    console.log(`[scheduler] Snapshot: ${label}`);
  }, OFF_HOURS_DELAY_MS);
}

module.exports = { startScheduler, onTradeActivity };
