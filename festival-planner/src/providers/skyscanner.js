// Skyscanner Flights Live Prices API (v3).
// Docs: https://developers.skyscanner.net/docs/flights-live-prices/overview
//
// A search is two calls: `create` starts it and returns the first results plus a
// sessionToken; `poll` returns the full, growing result set until the status is
// RESULT_STATUS_COMPLETE.

const BASE_URL = 'https://partners.api.skyscanner.net/apiservices/v3/flights/live/search';

// Prices come back as integer strings in a stated unit.
const PRICE_UNITS = {
  PRICE_UNIT_WHOLE: 1,
  PRICE_UNIT_CENTI: 100,
  PRICE_UNIT_MILLI: 1000,
  PRICE_UNIT_MICRO: 1_000_000,
};

const dateParts = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
};

export function priceToNumber(price) {
  const divisor = PRICE_UNITS[price?.unit];
  const amount = Number(price?.amount);
  if (!divisor || !price.amount || !Number.isFinite(amount)) return null;
  return amount / divisor;
}

export function buildSearchBody({ origin, destination, departDate, returnDate, adults, market, locale, currency }) {
  return {
    query: {
      market,
      locale,
      currency,
      queryLegs: [
        { originPlaceId: { iata: origin }, destinationPlaceId: { iata: destination }, date: dateParts(departDate) },
        { originPlaceId: { iata: destination }, destinationPlaceId: { iata: origin }, date: dateParts(returnDate) },
      ],
      adults,
      cabinClass: 'CABIN_CLASS_ECONOMY',
    },
  };
}

// Finds the cheapest itinerary in a create/poll response. Prices are for all
// adults in the search combined.
export function cheapestQuote(response, adults) {
  const results = response?.content?.results;
  const itineraries = results?.itineraries ?? {};

  let best = null;
  for (const [itineraryId, itinerary] of Object.entries(itineraries)) {
    for (const option of itinerary.pricingOptions ?? []) {
      const total = priceToNumber(option.price);
      if (total == null || (best && total >= best.total)) continue;
      best = { itineraryId, itinerary, option, total };
    }
  }
  if (!best) return null;

  const carrierIds = new Set(best.itinerary.legIds
    ?.flatMap((legId) => results.legs?.[legId]?.marketingCarrierIds ?? []) ?? []);
  const carriers = [...carrierIds].map((id) => results.carriers?.[id]?.name).filter(Boolean);
  const deepLink = best.option.items?.find((item) => item.deepLink)?.deepLink ?? null;

  const total = Math.round(best.total);
  return {
    total,
    perPerson: Math.round(best.total / adults),
    deepLink,
    carriers,
    source: 'skyscanner',
    note: carriers.length > 0 ? `Cheapest round trip on ${carriers.join(', ')}.` : 'Cheapest round trip found.',
  };
}

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function createSkyscannerFlights({
  apiKey,
  fetchImpl = fetch,
  market = 'US',
  locale = 'en-US',
  currency = 'USD',
  maxPolls = 6,
  pollIntervalMs = 2000,
  requestTimeoutMs = 15_000,
  sleep = delay,
}) {
  async function call(path, body) {
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Skyscanner ${path.split('/')[1]} returned HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    return res.json();
  }

  return {
    name: 'skyscanner',

    async roundTrip({ origin, destination, departDate, returnDate, adults }) {
      let response = await call('/create', buildSearchBody({
        origin, destination, departDate, returnDate, adults, market, locale, currency,
      }));

      for (let i = 0; i < maxPolls && response.status === 'RESULT_STATUS_INCOMPLETE'; i += 1) {
        await sleep(pollIntervalMs);
        response = await call(`/poll/${encodeURIComponent(response.sessionToken)}`);
      }
      return cheapestQuote(response, adults);
    },
  };
}
