// Builds data/airports.json from an OurAirports airports dataset (public domain).
//
// Usage: node scripts/build-airports.js <path-to-ourairports-airports.json>
//
// The input is the JSON form of https://davidmegginson.github.io/ourairports-data/airports.csv
// (for example data/airports.json from the `airports-json` npm package). Only US airports
// with scheduled airline service and an IATA code are kept.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/build-airports.js <ourairports-airports.json>');
  process.exit(1);
}

const rows = JSON.parse(readFileSync(input, 'utf8'));

const airports = rows
  .filter((r) => r.iso_country === 'US'
    && r.scheduled_service === 'yes'
    && /^[A-Z]{3}$/.test(r.iata_code)
    && (r.type === 'large_airport' || r.type === 'medium_airport'))
  .map((r) => ({
    iata: r.iata_code,
    name: r.name,
    city: r.municipality,
    state: r.iso_region.replace('US-', ''),
    lat: Number(Number(r.latitude_deg).toFixed(4)),
    lon: Number(Number(r.longitude_deg).toFixed(4)),
    size: r.type === 'large_airport' ? 'large' : 'medium',
  }))
  .sort((a, b) => a.iata.localeCompare(b.iata));

const out = fileURLToPath(new URL('../data/airports.json', import.meta.url));
writeFileSync(out, JSON.stringify(airports, null, 0).replace(/},{/g, '},\n{') + '\n');
console.log(`Wrote ${airports.length} airports to ${out}`);
