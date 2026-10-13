import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildRatesBody, cheapestOffer, createLiteApiHotels, splitIntoRooms,
} from '../src/providers/liteapi.js';

// The 'Search response' example for POST /hotels/rates from LiteAPI's OpenAPI spec, verbatim.
const specExample = JSON.parse(readFileSync(new URL('./fixtures/liteapi-rates.json', import.meta.url), 'utf8'));

// Same shape as the spec example: offer-level price is an object, rate-level prices are arrays.
const roomType = (amount, fees = []) => ({
  offerId: `offer-${amount}`,
  offerRetailRate: { amount, currency: 'USD' },
  rates: [{ retailRate: { total: [{ amount, currency: 'USD' }], taxesAndFees: fees } }],
});

const ratesResponse = ({ sandbox = false } = {}) => ({
  data: [
    { hotelId: 'lp1', roomTypes: [roomType(612.4)] },
    { hotelId: 'lp2', roomTypes: [roomType(540, [{ included: false, description: 'Resort fee', amount: 90, currency: 'USD' }])] },
    { hotelId: 'lp3', roomTypes: [roomType(575.25, [{ included: true, description: 'Tax', amount: 60, currency: 'USD' }])] },
    { hotelId: 'lp4', roomTypes: [{ offerRetailRate: { amount: 100, currency: 'EUR' } }] },
  ],
  hotels: [
    { id: 'lp1', name: 'Desert Inn' },
    { id: 'lp2', name: 'Resort With Fees' },
    // About 3.8 km north of the stay's venue below.
    { id: 'lp3', name: 'Polo Suites', city_name: 'Indio', latitude: 33.7165, longitude: -116.2378 },
  ],
  sandbox,
});

const stay = { lat: 33.6823, lon: -116.2378, checkIn: '2027-04-09', checkOut: '2027-04-12', nights: 3 };

test('splitIntoRooms spreads adults evenly and never leaves a room empty', () => {
  assert.deepEqual(splitIntoRooms(2, 1), [{ adults: 2 }]);
  assert.deepEqual(splitIntoRooms(5, 2), [{ adults: 3 }, { adults: 2 }]);
  assert.deepEqual(splitIntoRooms(4, 3), [{ adults: 2 }, { adults: 1 }, { adults: 1 }]);
  assert.deepEqual(splitIntoRooms(1, 3), [{ adults: 1 }]);
});

test('buildRatesBody searches around the festival for the cheapest rate per hotel', () => {
  const body = buildRatesBody({
    ...stay, radiusMeters: 15000, occupancies: [{ adults: 2 }], currency: 'USD', guestNationality: 'US', limit: 100,
  });
  assert.deepEqual(body, {
    latitude: 33.6823,
    longitude: -116.2378,
    radius: 15000,
    checkin: '2027-04-09',
    checkout: '2027-04-12',
    occupancies: [{ adults: 2 }],
    currency: 'USD',
    guestNationality: 'US',
    maxRatesPerHotel: 1,
    sort: [{ field: 'price', direction: 'ascending' }],
    limit: 100,
    timeout: 12,
  });
});

test("cheapestOffer reads LiteAPI's documented example response", () => {
  const offer = cheapestOffer(specExample, 'USD');
  // $163.66 offer plus the $43.61 facility fee marked included: false.
  assert.equal(offer.total.toFixed(2), '207.27');
  assert.equal(offer.fees, 43.61);
  assert.equal(offer.hotelId, 'lp1897');
  assert.equal(offer.hotelName, 'Hotel Example NYC');
  assert.equal(offer.sandbox, true);
});

test('cheapestOffer also accepts offer prices as arrays, as the spec schema declares', () => {
  const response = {
    data: [{ hotelId: 'a', roomTypes: [{ offerRetailRate: [{ amount: 80, currency: 'EUR' }, { amount: 90, currency: 'USD' }] }] }],
  };
  assert.equal(cheapestOffer(response, 'USD').total, 90);
});

test('cheapestOffer adds the fees for every room in a multi-room offer', () => {
  const resortFee = { included: false, description: 'Resort fee', amount: 90, currency: 'USD' };
  const response = {
    data: [{
      hotelId: 'lpR',
      roomTypes: [{
        offerRetailRate: { amount: 400, currency: 'USD' },
        rates: [
          { occupancyNumber: 1, retailRate: { total: [{ amount: 200, currency: 'USD' }], taxesAndFees: [resortFee] } },
          { occupancyNumber: 2, retailRate: { total: [{ amount: 200, currency: 'USD' }], taxesAndFees: [resortFee] } },
        ],
      }],
    }],
  };
  assert.deepEqual(cheapestOffer(response, 'USD'), {
    total: 580, fees: 180, hotelId: 'lpR', hotelName: null, hotelCity: null, hotelLocation: null, sandbox: false,
  });
});

test('cheapestOffer counts fees paid at the hotel and ignores other currencies', () => {
  assert.deepEqual(cheapestOffer(ratesResponse(), 'USD'), {
    total: 575.25,
    fees: 0,
    hotelId: 'lp3',
    hotelName: 'Polo Suites',
    hotelCity: 'Indio',
    hotelLocation: { lat: 33.7165, lon: -116.2378 },
    sandbox: false,
  });
  assert.equal(cheapestOffer({ data: [] }, 'USD'), null);
  assert.equal(cheapestOffer({}, 'USD'), null);
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('cheapestStay prices the whole stay and reports a nightly rate per room', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(ratesResponse({ sandbox: true }));
  };
  const hotels = createLiteApiHotels({ apiKey: 'sand_test', fetchImpl });
  const quote = await hotels.cheapestStay({ ...stay, adults: 3, rooms: 2 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.liteapi.travel/v3.0/hotels/rates');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-API-Key'], 'sand_test');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    latitude: 33.6823,
    longitude: -116.2378,
    radius: 15000,
    checkin: '2027-04-09',
    checkout: '2027-04-12',
    occupancies: [{ adults: 2 }, { adults: 1 }],
    currency: 'USD',
    guestNationality: 'US',
    maxRatesPerHotel: 1,
    sort: [{ field: 'price', direction: 'ascending' }],
    limit: 1000,
    timeout: 12,
  });
  assert.deepEqual(quote, {
    nights: 3,
    rooms: 2,
    nightly: 96,
    total: 575,
    source: 'liteapi',
    hotelName: 'Polo Suites',
    sandbox: true,
    note: 'Cheapest room: Polo Suites, Indio, 4 km from the venue. Sandbox test price.',
  });
});

test("cheapestStay prices LiteAPI's documented example response", async () => {
  const fetchImpl = async () => jsonResponse(specExample);
  const quote = await createLiteApiHotels({ apiKey: 'k', fetchImpl }).cheapestStay({ ...stay, adults: 2, rooms: 1 });
  assert.equal(quote.total, 207);
  assert.equal(quote.nightly, 69);
  // The spec example has no hotel coordinates, so the note falls back to the search radius.
  assert.equal(quote.note, 'Cheapest room: Hotel Example NYC (searched within 15 km), incl. $44 paid at the hotel. Sandbox test price.');
});

test('cheapestStay widens the search when nothing is available nearby', async () => {
  const radii = [];
  const replies = [
    new Response(null, { status: 204 }),
    jsonResponse({ error: { code: 2001, message: 'no availability found' } }),
    jsonResponse({ data: [{ hotelId: 'lp2', roomTypes: [roomType(540, [{ included: false, amount: 90, currency: 'USD' }])] }], hotels: [] }),
  ];
  const fetchImpl = async (url, init) => {
    radii.push(JSON.parse(init.body).radius);
    return replies.shift();
  };
  const hotels = createLiteApiHotels({ apiKey: 'k', fetchImpl, radiiMeters: [10000, 30000, 60000] });
  const quote = await hotels.cheapestStay({ ...stay, adults: 2, rooms: 1 });

  assert.deepEqual(radii, [10000, 30000, 60000]);
  assert.equal(quote.total, 630);
  assert.equal(quote.note, 'Cheapest room found within about 60 km, incl. $90 paid at the hotel.');
});

test('cheapestStay returns null when no radius has rooms', async () => {
  const fetchImpl = async () => new Response(null, { status: 204 });
  const hotels = createLiteApiHotels({ apiKey: 'k', fetchImpl });
  assert.equal(await hotels.cheapestStay({ ...stay, adults: 1, rooms: 1 }), null);
});

test('cheapestStay surfaces API errors', async () => {
  const unauthorized = async () => jsonResponse({ error: { code: 401, message: 'invalid api key' } }, 401);
  await assert.rejects(
    createLiteApiHotels({ apiKey: 'bad', fetchImpl: unauthorized }).cheapestStay({ ...stay, adults: 1, rooms: 1 }),
    /HTTP 401/,
  );
  const garbled = async () => new Response('<html>gateway timeout</html>', { status: 200 });
  await assert.rejects(
    createLiteApiHotels({ apiKey: 'k', fetchImpl: garbled }).cheapestStay({ ...stay, adults: 1, rooms: 1 }),
    /HTTP 200/,
  );
});
