import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchBody, cheapestQuote, createSkyscannerFlights, priceToNumber,
} from '../src/providers/skyscanner.js';

const response = (status, itineraries) => ({
  sessionToken: 'token/with+chars',
  status,
  action: 'RESULT_ACTION_REPLACED',
  content: {
    results: {
      itineraries,
      legs: {
        'leg-out': { marketingCarrierIds: ['c1'] },
        'leg-back': { marketingCarrierIds: ['c1', 'c2'] },
      },
      carriers: { c1: { name: 'Alpha Air' }, c2: { name: 'Beta Jet' } },
    },
    sortingOptions: { cheapest: [] },
  },
});

const itinerary = (amount, deepLink = 'https://skyscanner.example/book') => ({
  legIds: ['leg-out', 'leg-back'],
  pricingOptions: [{
    price: { amount, unit: 'PRICE_UNIT_MILLI', updateStatus: 'PRICE_UPDATE_STATUS_UNSPECIFIED' },
    items: [{ deepLink }],
  }],
});

test('priceToNumber converts unit-scaled integer strings', () => {
  assert.equal(priceToNumber({ amount: '412500', unit: 'PRICE_UNIT_MILLI' }), 412.5);
  assert.equal(priceToNumber({ amount: '41250', unit: 'PRICE_UNIT_CENTI' }), 412.5);
  assert.equal(priceToNumber({ amount: '', unit: 'PRICE_UNIT_MILLI' }), null);
  assert.equal(priceToNumber({ amount: '1', unit: 'PRICE_UNIT_UNSPECIFIED' }), null);
});

test('buildSearchBody asks for an economy round trip by IATA code', () => {
  const body = buildSearchBody({
    origin: 'JFK', destination: 'PSP', departDate: '2027-04-09', returnDate: '2027-04-12',
    adults: 2, market: 'US', locale: 'en-US', currency: 'USD',
  });
  assert.deepEqual(body.query.queryLegs, [
    { originPlaceId: { iata: 'JFK' }, destinationPlaceId: { iata: 'PSP' }, date: { year: 2027, month: 4, day: 9 } },
    { originPlaceId: { iata: 'PSP' }, destinationPlaceId: { iata: 'JFK' }, date: { year: 2027, month: 4, day: 12 } },
  ]);
  assert.equal(body.query.adults, 2);
  assert.equal(body.query.cabinClass, 'CABIN_CLASS_ECONOMY');
});

test('cheapestQuote picks the lowest price and reports carriers and booking link', () => {
  const quote = cheapestQuote(response('RESULT_STATUS_COMPLETE', {
    a: itinerary('980000'),
    b: itinerary('812400', 'https://skyscanner.example/cheap'),
  }), 2);
  assert.deepEqual(quote, {
    total: 812,
    perPerson: 406,
    deepLink: 'https://skyscanner.example/cheap',
    carriers: ['Alpha Air', 'Beta Jet'],
    source: 'skyscanner',
    note: 'Cheapest round trip on Alpha Air, Beta Jet.',
  });
});

test('cheapestQuote returns null when there are no priced itineraries', () => {
  assert.equal(cheapestQuote(response('RESULT_STATUS_COMPLETE', {}), 1), null);
  assert.equal(cheapestQuote({}, 1), null);
});

test('roundTrip creates a search, then polls until it completes', async () => {
  const calls = [];
  const replies = [
    response('RESULT_STATUS_INCOMPLETE', { a: itinerary('500000') }),
    response('RESULT_STATUS_INCOMPLETE', { a: itinerary('500000') }),
    response('RESULT_STATUS_COMPLETE', { a: itinerary('500000'), b: itinerary('300000') }),
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  };

  const flights = createSkyscannerFlights({ apiKey: 'test-key', fetchImpl, sleep: async () => {} });
  const quote = await flights.roundTrip({
    origin: 'JFK', destination: 'PSP', departDate: '2027-04-09', returnDate: '2027-04-12', adults: 1,
  });

  assert.equal(quote.total, 300);
  assert.deepEqual(calls.map((c) => c.url), [
    'https://partners.api.skyscanner.net/apiservices/v3/flights/live/search/create',
    'https://partners.api.skyscanner.net/apiservices/v3/flights/live/search/poll/token%2Fwith%2Bchars',
    'https://partners.api.skyscanner.net/apiservices/v3/flights/live/search/poll/token%2Fwith%2Bchars',
  ]);
  assert.equal(calls[0].init.headers['x-api-key'], 'test-key');
  assert.equal(JSON.parse(calls[0].init.body).query.adults, 1);
  assert.equal(calls[1].init.body, undefined);
});

test('roundTrip surfaces HTTP errors', async () => {
  const fetchImpl = async () => new Response('{"message":"Unauthorized"}', { status: 401 });
  const flights = createSkyscannerFlights({ apiKey: 'bad', fetchImpl });
  await assert.rejects(
    flights.roundTrip({ origin: 'JFK', destination: 'PSP', departDate: '2027-04-09', returnDate: '2027-04-12', adults: 1 }),
    /HTTP 401/,
  );
});
