import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingEditions } from '../src/data.js';
import { parseISODate } from '../src/dates.js';
import { testData } from './helpers.js';

const data = testData();
const byId = (id) => data.festivalsById.get(id);

test('loadData drops airports without coordinates and sorts editions', () => {
  assert.deepEqual(byId('lake-fest').airports, ['ORD']);
  assert.deepEqual(byId('desert-fest').editions.map((e) => e.label), ['Weekend 1', 'Weekend 2']);
  assert.equal(byId('desert-fest').stateName, 'California');
});

test('confirmed future editions are returned as-is', () => {
  const editions = upcomingEditions(byId('lake-fest'), '2026-10-13');
  assert.deepEqual(editions, [{ year: 2027, start: '2027-07-29', end: '2027-08-01', label: null, projected: false }]);
});

test('past festivals are projected 52 weeks ahead on the same weekdays', () => {
  const editions = upcomingEditions(byId('desert-fest'), '2026-10-13');
  assert.deepEqual(editions.map((e) => [e.start, e.end, e.label, e.projected, e.year]), [
    ['2027-04-09', '2027-04-11', 'Weekend 1', true, 2027],
    ['2027-04-16', '2027-04-18', 'Weekend 2', true, 2027],
  ]);
  for (const e of editions) {
    assert.equal(parseISODate(e.start).getUTCDay(), 5, 'still starts on a Friday');
  }
});

test('an in-progress edition still counts as upcoming', () => {
  const editions = upcomingEditions(byId('desert-fest'), '2026-04-11');
  assert.deepEqual(editions.map((e) => e.label), ['Weekend 1', 'Weekend 2']);
  assert.ok(editions.every((e) => !e.projected));
});

test('festivals on hiatus are not projected', () => {
  assert.deepEqual(upcomingEditions(byId('sleepy-fest'), '2026-10-13'), []);
});
