import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { testData } from './helpers.js';

const TODAY = '2026-10-13';
const flightCalls = [];
let flightsBehavior = 'ok';

const fakeFlights = {
  name: 'fake-flights',
  async roundTrip(args) {
    flightCalls.push(args);
    if (flightsBehavior === 'error') throw new Error('upstream down');
    if (flightsBehavior === 'empty') return null;
    return { total: 600, perPerson: 300, deepLink: 'https://book.example', carriers: [], source: 'skyscanner', note: 'live' };
  },
};

let server;
let baseUrl;

before(async () => {
  const app = createApp({
    data: testData(), flights: fakeFlights, today: () => TODAY, liveRequestsPerMinute: 100,
  });
  server = app.listen(0);
  await new Promise((resolve) => { server.once('listening', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => { server.close(resolve); }));

const get = async (path) => {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
};

test('GET /api/v1/festivals lists every festival with its upcoming editions', async () => {
  const { status, body } = await get('/api/v1/festivals');
  assert.equal(status, 200);
  assert.deepEqual(body.map((f) => [f.id, f.upcoming.length]), [['desert-fest', 2], ['lake-fest', 1], ['sleepy-fest', 0]]);
});

test('festival filters combine', async () => {
  assert.deepEqual((await get('/api/v1/festivals?genre=rock,country')).body.map((f) => f.id), ['lake-fest', 'sleepy-fest']);
  assert.deepEqual((await get('/api/v1/festivals?state=ca')).body.map((f) => f.id), ['desert-fest']);
  assert.deepEqual((await get('/api/v1/festivals?projected=0')).body.map((f) => f.id), ['lake-fest']);
  assert.deepEqual((await get('/api/v1/festivals?from=2027-06-01&to=2027-12-31')).body.map((f) => f.id), ['lake-fest']);
  assert.deepEqual((await get('/api/v1/festivals?q=indio')).body.map((f) => f.id), ['desert-fest']);
});

test('GET /api/v1/festivals/:id returns one festival or 404', async () => {
  assert.equal((await get('/api/v1/festivals/lake-fest')).body.name, 'Lake Fest');
  assert.equal((await get('/api/v1/festivals/nope')).status, 404);
});

test('GET /api/v1/states counts festivals per state', async () => {
  const { body } = await get('/api/v1/states');
  assert.deepEqual(body, [
    { state: 'CA', name: 'California', festivals: 1 },
    { state: 'IL', name: 'Illinois', festivals: 1 },
    { state: 'TN', name: 'Tennessee', festivals: 1 },
  ]);
});

test('GET /api/v1/plan ranks plannable festivals by cost per person', async () => {
  const { status, body } = await get('/api/v1/plan?origin=jfk&travelers=2');
  assert.equal(status, 200);
  assert.equal(body.origin, 'JFK');
  assert.deepEqual(body.results.map((r) => r.festival.id).sort(), ['desert-fest', 'lake-fest']);
  const costs = body.results.map((r) => r.trip.perPerson);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
  assert.ok(body.results.every((r) => r.trip.travel.source === 'estimate'));
  assert.equal(flightCalls.length, 0, 'planning never calls live APIs');
});

test('GET /api/v1/plan applies the budget cap', async () => {
  const all = (await get('/api/v1/plan?origin=JFK')).body.results;
  const cheapest = Math.min(...all.map((r) => r.trip.perPerson));
  const capped = (await get(`/api/v1/plan?origin=JFK&maxPerPerson=${cheapest}`)).body.results;
  assert.equal(capped.length, 1);
});

test('bad input is a 400 with a readable message', async () => {
  const badOrigin = await get('/api/v1/plan?origin=ZZZ');
  assert.equal(badOrigin.status, 400);
  assert.match(badOrigin.body.error, /origin/);
  assert.equal((await get('/api/v1/plan?origin=JFK&travelers=0')).status, 400);
  assert.equal((await get('/api/v1/festivals?from=April')).status, 400);
  assert.equal((await get('/api/v1/festivals/desert-fest/trip?origin=JFK&start=2030-01-01')).status, 400);
});

test('trip without live=1 is an estimate and skips the API', async () => {
  flightCalls.length = 0;
  const { body } = await get('/api/v1/festivals/desert-fest/trip?origin=JFK&travelers=2&start=2027-04-16');
  assert.equal(body.edition.label, 'Weekend 2');
  assert.equal(body.edition.projected, true);
  assert.equal(body.travel.source, 'estimate');
  assert.deepEqual(body.live, { flights: 'needs-confirmed-dates', hotels: 'not-configured' });
  assert.equal(flightCalls.length, 0);
});

test('live trip uses the flight quote for the right dates', async () => {
  flightsBehavior = 'ok';
  flightCalls.length = 0;
  const { body } = await get('/api/v1/festivals/lake-fest/trip?origin=JFK&travelers=2&live=1&arriveEarly=1');
  assert.deepEqual(flightCalls, [{
    origin: 'JFK', destination: 'ORD', departDate: '2027-07-28', returnDate: '2027-08-02', adults: 2,
  }]);
  assert.equal(body.travel.source, 'skyscanner');
  assert.equal(body.travel.total, 600);
  assert.equal(body.live.flights, 'ok');
  assert.equal(body.tickets.source, 'estimate');
  assert.equal(body.total, 600 + body.tickets.total + body.lodging.total);
});

test('live trip falls back to the estimate when the flight API fails', async () => {
  flightsBehavior = 'error';
  const { status, body } = await get('/api/v1/festivals/lake-fest/trip?origin=LAX&live=1');
  assert.equal(status, 200);
  assert.equal(body.travel.source, 'estimate');
  assert.equal(body.live.flights, 'error');

  flightsBehavior = 'empty';
  const empty = await get('/api/v1/festivals/lake-fest/trip?origin=LAX&travelers=3&live=1');
  assert.equal(empty.body.live.flights, 'no-results');
  assert.equal(empty.body.travel.source, 'estimate');
});

test('live prices are never fetched for projected dates', async () => {
  flightsBehavior = 'ok';
  flightCalls.length = 0;
  const { body } = await get('/api/v1/festivals/desert-fest/trip?origin=JFK&live=1');
  assert.equal(body.edition.projected, true);
  assert.equal(body.travel.source, 'estimate');
  assert.equal(body.live.flights, 'needs-confirmed-dates');
  assert.equal(flightCalls.length, 0);
});

test('festivals with nothing upcoming cannot be priced', async () => {
  assert.equal((await get('/api/v1/festivals/sleepy-fest/trip?origin=JFK')).status, 404);
});

test('the website is served from /', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Festival Planner/);
});
