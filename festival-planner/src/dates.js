// Date helpers that work on plain ISO calendar dates ("2026-04-10") in UTC, so
// festival dates never shift with the server's time zone.

const DAY_MS = 24 * 60 * 60 * 1000;

export const parseISODate = (iso) => new Date(`${iso}T00:00:00Z`);

export const toISODate = (date) => date.toISOString().slice(0, 10);

export const addDays = (iso, days) => toISODate(new Date(parseISODate(iso).getTime() + days * DAY_MS));

export const daysBetween = (fromIso, toIso) => Math.round((parseISODate(toIso) - parseISODate(fromIso)) / DAY_MS);

export const todayISO = () => toISODate(new Date());

export const isISODate = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && toISODate(parseISODate(value)) === value;
