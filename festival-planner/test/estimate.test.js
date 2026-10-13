import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSUMPTIONS, buildTrip, estimateTravel, tripDates } from '../src/estimate.js';
import { testData } from './helpers.js';

const data = testData();
const airport = (code) => data.airportsByCode.get(code);
const desert = data.festivalsById.get('desert-fest');
const lake = data.festivalsById.get('lake-fest');
const weekend1 = desert.editions[0];

test('trip dates cover the festival, optionally arriving a night early', () => {
  assert.deepEqual(tripDates(weekend1), { checkIn: '2026-04-10', checkOut: '2026-04-13', nights: 3, shortened: false });
  assert.deepEqual(tripDates(weekend1, { arriveEarly: true }), { checkIn: '2026-04-09', checkOut: '2026-04-13', nights: 4, shortened: false });
});

test('long festivals are priced as a capped stay', () => {
  const tenDays = { start: '2026-07-31', end: '2026-08-09' };
  assert.deepEqual(tripDates(tenDays), {
    checkIn: '2026-07-31', checkOut: '2026-08-05', nights: ASSUMPTIONS.maxNights, shortened: true,
  });
});

test('nearby origins drive to the main airport, not the closest alternate', () => {
  const travel = estimateTravel({
    originAirport: airport('LAX'), festivalAirports: [airport('PSP'), airport('LAX')], travelers: 5,
  });
  assert.equal(travel.mode, 'drive');
  assert.equal(travel.destination, 'PSP');
  // LAX to Palm Springs is ~110 straight-line miles.
  assert.ok(travel.miles > 120 && travel.miles < 150, `got ${travel.miles}`);
  const cars = 2;
  assert.equal(travel.total, Math.round((travel.miles * 2 * ASSUMPTIONS.fuelPerMile * cars) / 5) * 5);
});

test('locals skip the hotel', () => {
  const trip = buildTrip({
    festival: lake,
    edition: lake.editions[1],
    originAirport: airport('ORD'),
    festivalAirports: [airport('ORD')],
    travelers: 2,
    rooms: 1,
    typicalTicketPrice: 300,
  });
  assert.equal(trip.travel.local, true);
  assert.equal(trip.lodging.total, 0);
  assert.equal(trip.total, 600);
});

test('far origins fly into the festival airport', () => {
  const travel = estimateTravel({
    originAirport: airport('JFK'), festivalAirports: [airport('PSP'), airport('LAX')], travelers: 2,
  });
  assert.equal(travel.mode, 'fly');
  assert.equal(travel.destination, 'PSP');
  assert.ok(travel.miles > 2000);
  const expected = Math.round(((ASSUMPTIONS.fareBase + ASSUMPTIONS.farePerMile * travel.miles)
    * ASSUMPTIONS.regionalAirportMultiplier) / 5) * 5;
  assert.equal(travel.perPerson, expected);
  assert.equal(travel.total, expected * 2);
});

test('buildTrip totals tickets, travel and lodging', () => {
  const trip = buildTrip({
    festival: desert,
    edition: weekend1,
    originAirport: airport('JFK'),
    festivalAirports: [airport('PSP'), airport('LAX')],
    travelers: 2,
    rooms: 1,
    typicalTicketPrice: 300,
  });
  assert.equal(trip.tickets.total, 1000);
  assert.equal(trip.tickets.source, 'festival');
  assert.equal(trip.lodging.nights, 3);
  assert.equal(trip.total, trip.tickets.total + trip.travel.total + trip.lodging.total);
  assert.equal(trip.perPerson, Math.round(trip.total / 2));
});

test('live quotes replace estimates and unknown tickets use the typical price', () => {
  const trip = buildTrip({
    festival: lake,
    edition: lake.editions[1],
    originAirport: airport('JFK'),
    festivalAirports: [airport('ORD')],
    travelers: 1,
    rooms: 1,
    typicalTicketPrice: 300,
    travel: { mode: 'fly', destination: 'ORD', total: 321, perPerson: 321, source: 'skyscanner', note: 'live' },
  });
  assert.equal(trip.travel.source, 'skyscanner');
  assert.equal(trip.tickets.total, 300);
  assert.equal(trip.tickets.source, 'estimate');
  assert.equal(trip.total, 321 + 300 + trip.lodging.total);
});
