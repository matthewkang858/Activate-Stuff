// Guards data/festivals.json, which is edited by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, STATE_NAMES } from '../src/data.js';
import { isISODate } from '../src/dates.js';
import { distanceMiles } from '../src/geo.js';

const GENRES = new Set([
  'rock', 'alternative', 'indie', 'pop', 'hip-hop', 'rnb', 'electronic', 'country', 'folk', 'bluegrass',
  'jam', 'jazz', 'blues', 'metal', 'punk', 'emo', 'latin', 'reggae', 'eclectic',
]);
const STATUSES = new Set(['active', 'hiatus']);

const { festivals, airportsByCode } = loadData();

test('festival ids are unique slugs', () => {
  const ids = festivals.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

for (const f of festivals) {
  test(`${f.id} is well formed`, () => {
    assert.ok(f.name, 'name');
    assert.ok(f.city, 'city');
    assert.ok(STATE_NAMES[f.state], `state ${f.state}`);
    assert.ok(STATUSES.has(f.status), `status ${f.status}`);
    assert.ok(f.genres.length > 0 && f.genres.every((g) => GENRES.has(g)), `genres ${f.genres}`);
    assert.ok(f.airports.length > 0, 'at least one known airport');
    assert.ok(f.airports.every((code) => airportsByCode.has(code)));
    if (f.website) assert.match(f.website, /^https:\/\//);
    // Venue coordinates drive the hotel search; a typo would search the wrong town.
    assert.ok(Number.isFinite(f.lat) && Number.isFinite(f.lon), 'coordinates');
    const miles = distanceMiles(f, airportsByCode.get(f.airports[0]));
    assert.ok(miles < 150, `venue is ${Math.round(miles)} miles from ${f.airports[0]}`);
    if (f.ticket) assert.ok(Number.isFinite(f.ticket.gaFrom) && f.ticket.gaFrom >= 0 && f.ticket.note, 'ticket price and note');

    assert.ok(f.editions.length > 0, 'has dates');
    for (const e of f.editions) {
      assert.ok(isISODate(e.start) && isISODate(e.end), `dates ${e.start} ${e.end}`);
      assert.ok(e.start <= e.end, `${e.start} <= ${e.end}`);
      assert.equal(e.year, Number(e.start.slice(0, 4)));
    }
  });
}
