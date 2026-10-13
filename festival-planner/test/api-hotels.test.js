import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { testData } from './helpers.js';

const hotelCalls = [];
const flightCalls = [];
let hotelsBehavior = 'ok';

const fakeHotels = {
  name: 'fake-hotels',
  async cheapestStay(args) {
    hotelCalls.push(args);
    if (hotelsBehavior === 'error') throw new Error('upstream down');
    if (hotelsBehavior === 'empty') return null;
    return {
      nights: args.nights, rooms: args.rooms, nightly: 150, total: 150 * args.nights * args.rooms,
      source: 'liteapi', hotelName: 'Polo Suites', note: 'Cheapest room at Polo Suites.',
    };
  },
};

const fakeFlights = {
  name: 'fake-flights',
  async roundTrip(args) {
    flightCalls.push(args);
    return { total: 500, perPerson: 250, source: 'skyscanner', note: 'live' };
  },
};

const servers = [];

async function startApp(today) {
  const app = createApp({
    data: testData(), flights: fakeFlights, hotels: fakeHotels, today: () => today, liveRequestsPerMinute: 100,
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((resolve) => { server.once('listening', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return async (path) => {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: await res.json() };
  };
}

let get;
before(async () => { get = await startApp('2026-10-13'); });
after(() => Promise.all(servers.map((s) => new Promise((resolve) => { s.close(resolve); }))));

const reset = () => { hotelCalls.length = 0; flightCalls.length = 0; hotelsBehavior = 'ok'; };

test('config reports both live providers', async () => {
  assert.deepEqual((await get('/api/v1/config')).body, { live: { flights: 'fake-flights', hotels: 'fake-hotels' } });
});

test('projected dates get a live hotel preview but no live flight search', async () => {
  reset();
  const { body } = await get('/api/v1/festivals/desert-fest/trip?origin=JFK&travelers=3&live=1');
  assert.equal(body.edition.projected, true);
  assert.deepEqual(body.live, { flights: 'needs-confirmed-dates', hotels: 'ok' });
  assert.equal(flightCalls.length, 0);
  assert.deepEqual(hotelCalls, [{
    lat: 33.6823, lon: -116.2378, checkIn: '2027-04-09', checkOut: '2027-04-12', nights: 3, adults: 3, rooms: 2,
  }]);
  assert.equal(body.lodging.source, 'liteapi');
  assert.equal(body.lodging.total, 900);
  assert.equal(body.total, body.tickets.total + body.travel.total + 900);
});

test('rooms are capped at the number of people', async () => {
  reset();
  const { body } = await get('/api/v1/festivals/desert-fest/trip?origin=JFK&travelers=1&rooms=4&live=1');
  assert.equal(body.rooms, 1);
  assert.equal(hotelCalls[0].rooms, 1);
});

test('festivals without coordinates fall back to the hotel estimate', async () => {
  reset();
  const { body } = await get('/api/v1/festivals/lake-fest/trip?origin=JFK&live=1');
  assert.deepEqual(body.live, { flights: 'ok', hotels: 'no-location' });
  assert.equal(hotelCalls.length, 0);
  assert.equal(body.lodging.source, 'estimate');
  assert.equal(body.travel.source, 'skyscanner');
});

test('locals are not sent hotel searches', async () => {
  reset();
  const { body } = await get('/api/v1/festivals/desert-fest/trip?origin=PSP&live=1');
  assert.equal(body.travel.local, true);
  assert.equal(body.live.hotels, 'skipped');
  assert.equal(hotelCalls.length, 0);
  assert.equal(body.lodging.total, 0);
});

test('a failing hotel API falls back to the estimate', async () => {
  reset();
  hotelsBehavior = 'error';
  const { status, body } = await get('/api/v1/festivals/desert-fest/trip?origin=ORD&travelers=2&live=1');
  assert.equal(status, 200);
  assert.equal(body.live.hotels, 'error');
  assert.equal(body.lodging.source, 'estimate');
});

test('no hotel results fall back to the estimate', async () => {
  reset();
  hotelsBehavior = 'empty';
  const { body } = await get('/api/v1/festivals/desert-fest/trip?origin=JFK&travelers=5&live=1');
  assert.equal(body.live.hotels, 'no-results');
  assert.equal(body.lodging.source, 'estimate');
});

test('identical live hotel searches are cached, and the room count is part of the key', async () => {
  reset();
  const trip = (rooms) => get(`/api/v1/festivals/desert-fest/trip?origin=JFK&travelers=4&rooms=${rooms}&live=1`);
  await trip(1);
  await trip(1);
  assert.equal(hotelCalls.length, 1);

  const { body } = await trip(2);
  assert.deepEqual(hotelCalls.map((c) => c.rooms), [1, 2]);
  assert.equal(body.lodging.rooms, 2);
});

test('drive trips on projected dates do not claim flights need confirmed dates', async () => {
  reset();
  const { body } = await get('/api/v1/festivals/desert-fest/trip?origin=LAX&live=1');
  assert.equal(body.travel.mode, 'drive');
  assert.equal(body.live.flights, 'skipped');
});

test('a festival already under way is priced from today, not its first day', async () => {
  reset();
  const getMidFestival = await startApp('2026-04-11');
  const { body } = await getMidFestival('/api/v1/festivals/desert-fest/trip?origin=JFK&travelers=2&live=1');
  assert.equal(body.edition.label, 'Weekend 1');
  assert.equal(body.edition.projected, false);
  assert.deepEqual(body.dates, { checkIn: '2026-04-11', checkOut: '2026-04-13', nights: 2, shortened: false });
  assert.equal(hotelCalls[0].checkIn, '2026-04-11');
  assert.equal(hotelCalls[0].nights, 2);
  assert.equal(flightCalls[0].departDate, '2026-04-11');
});
