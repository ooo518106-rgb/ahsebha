// Calendar periods use UTC and clamp the day to the destination month.
export function extendUntil(current, period, now = Date.now()) {
  const base = new Date(Math.max(now, current));
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + (period === 'year' ? 12 : 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, last));
  return base.getTime();
}

// Read the latest deadline inside the transaction, avoiding lost concurrent renewals.
export function extendUntilSql(period, now, trialDays) {
  const months = period === 'year' ? 12 : 1;
  const base = `MAX(${Math.trunc(now)}, COALESCE(active_until, created_at + ${trialDays * 86400000}))`;
  const date = `datetime((${base}) / 1000, 'unixepoch')`;
  const day = `MIN(CAST(strftime('%d', ${date}) AS INTEGER), CAST(strftime('%d', ${date}, 'start of month', '+${months + 1} months', '-1 day') AS INTEGER)) - 1`;
  return `CAST(strftime('%s', ${date}, 'start of month', '+${months} months', '+' || (${day}) || ' days') AS INTEGER) * 1000 + (${base}) % 86400000`;
}
