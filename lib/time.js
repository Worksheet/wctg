// Converts a UTC datetime string (from SQLite) to Europe/London time.
// Returns 'YYYY-MM-DD HH:MM' or, if dateOnly is true, 'YYYY-MM-DD'.
function toLondonTime(dtStr, dateOnly) {
  if (!dtStr) return '';
  const isoStr = dtStr.replace(' ', 'T');
  const utcStr = /[Z+]/.test(isoStr) ? isoStr : isoStr + 'Z';
  const date = new Date(utcStr);
  if (isNaN(date)) return String(dtStr);
  const opts = { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' };
  if (!dateOnly) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
    opts.hour12 = false;
  }
  const parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(date);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  return dateOnly ? `${p.year}-${p.month}-${p.day}` : `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Returns a human-readable string for the current date in London time.
function londonDateStr() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    dateStyle: 'long',
  }).format(new Date());
}

module.exports = { toLondonTime, londonDateStr };
