import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addDays, todayISO } from './dates.js';

const readJson = (relativePath) => JSON.parse(
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
);

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Shifting by 52 weeks keeps a Friday-Sunday festival on Friday-Sunday.
const ONE_YEAR_OF_WEEKS = 364;

// Festivals almost always return on the same weekend each year, so when next
// year's dates aren't announced we project the most recent year forward and
// flag the result as projected.
export function upcomingEditions(festival, today = todayISO()) {
  const confirmed = festival.editions.filter((e) => e.end >= today);
  if (confirmed.length > 0 || festival.status === 'hiatus' || festival.editions.length === 0) {
    return confirmed.map((e) => ({ ...e, projected: false }));
  }

  const latestYear = Math.max(...festival.editions.map((e) => e.year));
  let projected = festival.editions.filter((e) => e.year === latestYear);
  do {
    projected = projected.map((e) => ({
      ...e,
      start: addDays(e.start, ONE_YEAR_OF_WEEKS),
      end: addDays(e.end, ONE_YEAR_OF_WEEKS),
    }));
  } while (projected.every((e) => e.end < today));

  return projected
    .filter((e) => e.end >= today)
    .map((e) => ({ ...e, year: Number(e.start.slice(0, 4)), projected: true }));
}

export function loadData({
  festivals = readJson('../data/festivals.json'),
  airports = readJson('../data/airports.json'),
} = {}) {
  const airportsByCode = new Map(airports.map((a) => [a.iata, a]));

  const normalized = festivals.map((f) => ({
    ...f,
    stateName: STATE_NAMES[f.state] ?? f.state,
    // Only airports we have coordinates for can be priced.
    airports: f.airports.filter((code) => airportsByCode.has(code)),
    editions: [...f.editions].sort((a, b) => a.start.localeCompare(b.start)),
  }));

  // Median of verified paid GA prices, used for festivals without one.
  const prices = normalized.map((f) => f.ticket?.gaFrom).filter((p) => p > 0).sort((a, b) => a - b);
  const typicalTicketPrice = prices.length > 0 ? Math.round(prices[Math.floor(prices.length / 2)]) : 0;

  return {
    festivals: normalized,
    typicalTicketPrice,
    festivalsById: new Map(normalized.map((f) => [f.id, f])),
    airports,
    airportsByCode,
  };
}
