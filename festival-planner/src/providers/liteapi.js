// LiteAPI hotel rates (v3.0).
// Docs: https://docs.liteapi.travel/reference/post_hotels-rates
// Spec: https://github.com/liteapi-travel/mcp-server/blob/main/openapi-schemas/search.json
//
// One POST /hotels/rates call searches every hotel within a radius of the
// festival and returns each hotel's cheapest offer. An offer's
// `offerRetailRate` is the sum of its rates, one rate per requested room, and is
// treated as the price of the whole stay; `npm run check:liteapi` confirms that
// against a real key.

import { distanceMiles } from '../geo.js';

const BASE_URL = 'https://api.liteapi.travel/v3.0';

// Searched in order until one finds rooms: near the venue, then the wider area
// for rural festivals.
const DEFAULT_RADII_METERS = [15_000, 40_000];

const NO_AVAILABILITY = 2001;

// Most hotels LiteAPI prices per search (its default is 200, maximum 5,000).
// Big cities have hundreds of hotels within the radius, and the cheapest room
// can only be found among the hotels that get priced.
const DEFAULT_LIMIT = 1000;

// Spreads adults across rooms as evenly as possible; every room needs an adult.
export function splitIntoRooms(adults, rooms) {
  const count = Math.max(1, Math.min(rooms, adults));
  return Array.from({ length: count }, (_, i) => ({
    adults: Math.floor(adults / count) + (i < adults % count ? 1 : 0),
  }));
}

export function buildRatesBody({
  lat, lon, radiusMeters, checkIn, checkOut, occupancies, currency, guestNationality, limit,
}) {
  return {
    latitude: lat,
    longitude: lon,
    radius: radiusMeters,
    checkin: checkIn,
    checkout: checkOut,
    occupancies,
    currency,
    guestNationality,
    maxRatesPerHotel: 1,
    sort: [{ field: 'price', direction: 'ascending' }],
    limit,
    // Seconds LiteAPI waits for suppliers; the docs recommend 6-12.
    timeout: 12,
  };
}

// The spec types offer-level prices as arrays of { amount, currency }, but its
// example responses return a single object, so accept both.
const amountIn = (prices, currency) => {
  const list = Array.isArray(prices) ? prices : [prices];
  const match = list.find((p) => p?.currency === currency);
  return Number.isFinite(match?.amount) ? match.amount : null;
};

// Fees marked `included: false` (resort and facility fees) are paid at the
// hotel on top of the offer price, so they belong in the trip cost.
const feesPaidAtHotel = (roomType, currency) => (roomType.rates ?? [])
  .flatMap((rate) => rate.retailRate?.taxesAndFees ?? [])
  .filter((fee) => fee.included === false && fee.currency === currency && Number.isFinite(fee.amount))
  .reduce((sum, fee) => sum + fee.amount, 0);

// Finds the cheapest offer, counting fees paid at the hotel, in a rates response.
export function cheapestOffer(response, currency) {
  const hotels = new Map((response?.hotels ?? []).map((h) => [h.id, h]));

  let best = null;
  for (const hotel of response?.data ?? []) {
    for (const roomType of hotel.roomTypes ?? []) {
      const price = amountIn(roomType.offerRetailRate, currency);
      if (price == null) continue;
      const fees = feesPaidAtHotel(roomType, currency);
      if (!best || price + fees < best.total) best = { total: price + fees, fees, hotelId: hotel.hotelId };
    }
  }
  if (!best) return null;

  const info = hotels.get(best.hotelId);
  return {
    ...best,
    hotelName: info?.name ?? null,
    hotelCity: info?.city_name ?? null,
    hotelLocation: Number.isFinite(info?.latitude) && Number.isFinite(info?.longitude)
      ? { lat: info.latitude, lon: info.longitude }
      : null,
    sandbox: response.sandbox === true,
  };
}

const KM_PER_MILE = 1.609;

// LiteAPI's search radius is approximate (hotels a few km past it come back),
// so describe the hotel by its real distance from the venue when known.
function describeHotel(offer, venue, radiusMeters) {
  if (!offer.hotelName) return `Cheapest room found within about ${radiusMeters / 1000} km`;
  const where = offer.hotelCity ? `${offer.hotelName}, ${offer.hotelCity}` : offer.hotelName;
  if (!offer.hotelLocation) return `Cheapest room: ${where} (searched within ${radiusMeters / 1000} km)`;
  const km = Math.max(1, Math.round(distanceMiles(venue, offer.hotelLocation) * KM_PER_MILE));
  return `Cheapest room: ${where}, ${km} km from the venue`;
}

// POST /hotels/rates. Resolves to null when nothing is available (HTTP 204 or
// error code 2001) and throws on any other error.
export async function requestRates({
  apiKey, body, fetchImpl = fetch, timeoutMs = 20_000,
}) {
  const res = await fetchImpl(`${BASE_URL}/hotels/rates`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return null;

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  if (json?.error?.code === NO_AVAILABILITY) return null;
  if (!res.ok || !json || json.error) {
    throw new Error(`LiteAPI rates returned HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return json;
}

export function createLiteApiHotels({
  apiKey,
  fetchImpl = fetch,
  currency = 'USD',
  guestNationality = 'US',
  radiiMeters = DEFAULT_RADII_METERS,
  limit = DEFAULT_LIMIT,
  requestTimeoutMs = 20_000,
}) {
  return {
    name: 'liteapi',

    async cheapestStay({ lat, lon, checkIn, checkOut, nights, adults, rooms }) {
      const occupancies = splitIntoRooms(adults, rooms);
      for (const radiusMeters of radiiMeters) {
        const response = await requestRates({
          apiKey,
          fetchImpl,
          timeoutMs: requestTimeoutMs,
          body: buildRatesBody({
            lat, lon, radiusMeters, checkIn, checkOut, occupancies, currency, guestNationality, limit,
          }),
        });
        const offer = response && cheapestOffer(response, currency);
        if (!offer) continue;

        const total = Math.round(offer.total);
        const roomCount = occupancies.length;
        const fees = offer.fees > 0 ? `, incl. $${Math.round(offer.fees)} paid at the hotel` : '';
        return {
          nights,
          rooms: roomCount,
          nightly: Math.round(total / nights / roomCount),
          total,
          source: 'liteapi',
          hotelName: offer.hotelName,
          sandbox: offer.sandbox,
          note: `${describeHotel(offer, { lat, lon }, radiusMeters)}${fees}.`
            + (offer.sandbox ? ' Sandbox test price.' : ''),
        };
      }
      return null;
    },
  };
}
