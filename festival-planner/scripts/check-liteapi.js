// Checks how LiteAPI prices a stay, using your key from .env:
//   npm run check:liteapi
//
// It prices the same hotel for 1 night and for 3 nights. The app treats
// LiteAPI's offer price as the whole stay, so the 3-night price should be
// roughly 3x the 1-night price. If the two are about equal, prices are per
// night and src/providers/liteapi.js needs to multiply by the number of nights.

import { buildRatesBody, cheapestOffer } from '../src/providers/liteapi.js';
import { addDays, todayISO } from '../src/dates.js';

const apiKey = process.env.LITEAPI_API_KEY;
if (!apiKey) {
  console.error('Set LITEAPI_API_KEY in .env first.');
  process.exit(1);
}

// Downtown Nashville: plenty of hotels on any night.
const where = { lat: 36.1627, lon: -86.7816 };
const checkIn = addDays(todayISO(), 45);

async function rates(body) {
  const res = await fetch('https://api.liteapi.travel/v3.0/hotels/rates', {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const base = { checkIn, occupancies: [{ adults: 2 }], currency: 'USD', guestNationality: 'US' };

const oneNight = await rates(buildRatesBody({
  ...where, ...base, checkOut: addDays(checkIn, 1), radiusMeters: 5000, limit: 50,
}));
const first = cheapestOffer(oneNight, 'USD');
if (!first) {
  console.log('No rooms came back for the 1-night search; try again later.');
  process.exit(1);
}

const threeNights = await rates({
  hotelIds: [first.hotelId],
  checkin: checkIn,
  checkout: addDays(checkIn, 3),
  occupancies: base.occupancies,
  currency: 'USD',
  guestNationality: 'US',
  maxRatesPerHotel: 1,
  includeHotelData: true,
  timeout: 8,
});
const second = cheapestOffer(threeNights, 'USD');
if (!second) {
  console.log(`${first.hotelName ?? first.hotelId} had no 3-night availability; run it again.`);
  process.exit(1);
}

const ratio = second.total / first.total;
console.log(`Hotel: ${first.hotelName ?? first.hotelId} (sandbox: ${first.sandbox})`);
console.log(`1 night from ${checkIn}: $${first.total.toFixed(2)}`);
console.log(`3 nights from ${checkIn}: $${second.total.toFixed(2)} (${ratio.toFixed(2)}x)`);
console.log(ratio > 2
  ? 'Prices cover the whole stay, which is what the app assumes.'
  : 'Prices look per-night: update cheapestStay() in src/providers/liteapi.js.');
