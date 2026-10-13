import express from 'express';
import { fileURLToPath } from 'node:url';
import { STATE_NAMES, upcomingEditions } from './data.js';
import { buildTrip, defaultRooms, tripDates } from './estimate.js';
import { createCache, createRateLimiter } from './cache.js';
import { isISODate, todayISO } from './dates.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

class BadRequest extends Error {}

const listParam = (value) => (typeof value === 'string' && value.trim()
  ? value.split(',').map((v) => v.trim()).filter(Boolean)
  : []);

function intParam(value, { name, min, max, fallback }) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequest(`${name} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function dateParam(value, name) {
  if (value === undefined || value === '') return undefined;
  if (!isISODate(value)) throw new BadRequest(`${name} must be a date like 2027-04-09`);
  return value;
}

export function createApp({
  data,
  flights = null,
  hotels = null,
  today = todayISO,
  liveCacheTtlMs = 10 * 60 * 1000,
  liveRequestsPerMinute = 20,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const liveCache = createCache({ ttlMs: liveCacheTtlMs });
  const allowLive = createRateLimiter({ limit: liveRequestsPerMinute, windowMs: 60_000 });

  const summarize = (festival) => ({
    id: festival.id,
    name: festival.name,
    city: festival.city,
    state: festival.state,
    stateName: festival.stateName,
    venue: festival.venue,
    genres: festival.genres,
    website: festival.website,
    camping: festival.camping,
    airports: festival.airports,
    ticket: festival.ticket,
    status: festival.status,
    statusNote: festival.statusNote ?? null,
    editions: festival.editions,
    upcoming: upcomingEditions(festival, today()),
  });

  function originParam(value) {
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    const airport = data.airportsByCode.get(code);
    if (!airport) throw new BadRequest('origin must be a US airport code like JFK');
    return airport;
  }

  function tripOptions(query) {
    const travelers = intParam(query.travelers, { name: 'travelers', min: 1, max: 12, fallback: 1 });
    return {
      originAirport: originParam(query.origin),
      typicalTicketPrice: data.typicalTicketPrice,
      travelers,
      rooms: intParam(query.rooms, { name: 'rooms', min: 1, max: 6, fallback: defaultRooms(travelers) }),
      arriveEarly: query.arriveEarly === '1' || query.arriveEarly === 'true',
    };
  }

  const festivalAirports = (festival) => festival.airports.map((code) => data.airportsByCode.get(code));

  // Filters shared by the listing and planning endpoints. Date filters narrow
  // each festival's upcoming editions and drop festivals left with none.
  function matchingFestivals(query, { requireUpcoming }) {
    const states = listParam(query.state).map((s) => s.toUpperCase());
    const genres = listParam(query.genre).map((g) => g.toLowerCase());
    const from = dateParam(query.from, 'from');
    const to = dateParam(query.to, 'to');
    const includeProjected = query.projected !== '0';
    const search = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
    const filterDates = requireUpcoming || from || to || !includeProjected;

    return data.festivals
      .map(summarize)
      .map((f) => ({
        ...f,
        upcoming: f.upcoming.filter((e) => (includeProjected || !e.projected)
          && (!from || e.end >= from)
          && (!to || e.start <= to)),
      }))
      .filter((f) => (!filterDates || f.upcoming.length > 0)
        && (states.length === 0 || states.includes(f.state))
        && (genres.length === 0 || f.genres.some((g) => genres.includes(g)))
        && (!search || `${f.name} ${f.city} ${f.stateName}`.toLowerCase().includes(search)));
  }

  app.get('/api/v1/config', (req, res) => {
    res.json({ live: { flights: flights?.name ?? null, hotels: hotels?.name ?? null } });
  });

  app.get('/api/v1/airports', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(data.airports.map(({ iata, name, city, state }) => ({ iata, name, city, state })));
  });

  app.get('/api/v1/states', (req, res) => {
    const counts = new Map();
    for (const f of data.festivals) counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
    res.json([...counts]
      .map(([state, festivals]) => ({ state, name: STATE_NAMES[state] ?? state, festivals }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  });

  app.get('/api/v1/states/:state/festivals', (req, res) => {
    const state = req.params.state.toUpperCase();
    res.json(data.festivals.filter((f) => f.state === state).map(summarize));
  });

  // ?state=CA,NV&genre=rock,indie&from=2027-01-01&to=2027-06-30&q=coach&projected=0
  app.get('/api/v1/festivals', (req, res) => {
    res.json(matchingFestivals(req.query, { requireUpcoming: false }));
  });

  app.get('/api/v1/festivals/:id', (req, res) => {
    const festival = data.festivalsById.get(req.params.id);
    if (!festival) return res.status(404).json({ error: `No festival with id "${req.params.id}"` });
    res.json({ ...summarize(festival), sources: festival.sources, dataNotes: festival.dataNotes ?? null });
  });

  // Ranks matching festivals by estimated cost per person from the visitor's home
  // airport. Estimates only, so it's instant and never spends API quota.
  // ?origin=JFK&travelers=2&rooms=1&maxPerPerson=1500 plus the /festivals filters.
  app.get('/api/v1/plan', (req, res) => {
    const options = tripOptions(req.query);
    const maxPerPerson = intParam(req.query.maxPerPerson, { name: 'maxPerPerson', min: 1, max: 100_000, fallback: Infinity });

    const results = matchingFestivals(req.query, { requireUpcoming: true })
      .map((festival) => ({
        festival,
        trip: buildTrip({
          festival,
          edition: festival.upcoming[0],
          festivalAirports: festivalAirports(festival),
          ...options,
        }),
      }))
      .filter((r) => r.trip.perPerson <= maxPerPerson)
      .sort((a, b) => a.trip.perPerson - b.trip.perPerson);

    res.json({ origin: options.originAirport.iata, travelers: options.travelers, results });
  });

  // One festival's trip cost for its next dates, or the upcoming edition that
  // begins on ?start=2027-04-16. With ?live=1, flights and hotels come from the
  // configured price APIs, falling back to estimates per component on failure.
  app.get('/api/v1/festivals/:id/trip', async (req, res) => {
    const festival = data.festivalsById.get(req.params.id);
    if (!festival) return res.status(404).json({ error: `No festival with id "${req.params.id}"` });

    const options = tripOptions(req.query);
    const editions = upcomingEditions(festival, today());
    if (editions.length === 0) {
      return res.status(404).json({ error: `${festival.name} has no upcoming dates` });
    }
    const start = dateParam(req.query.start, 'start');
    const edition = start ? editions.find((e) => e.start === start) : editions[0];
    if (!edition) throw new BadRequest(`${festival.name} has no upcoming dates starting ${start}`);
    const airports = festivalAirports(festival);

    const estimate = buildTrip({ festival, edition, festivalAirports: airports, ...options });
    const wantsLive = req.query.live === '1' || req.query.live === 'true';
    const live = { flights: flights ? 'skipped' : 'not-configured', hotels: hotels ? 'skipped' : 'not-configured' };
    if (!wantsLive || (!flights && !hotels)) return res.json({ ...estimate, live });
    // Live price APIs are for real trips; projected dates are only a guess.
    if (edition.projected) {
      return res.json({ ...estimate, live: { flights: 'needs-confirmed-dates', hotels: 'needs-confirmed-dates' } });
    }

    if (!allowLive(req.ip)) {
      return res.status(429).json({ error: 'Too many live price searches. Try again in a minute.' });
    }

    const { checkIn, checkOut } = tripDates(edition, options);
    const { originAirport, travelers, rooms } = options;

    const liveFlights = async () => {
      if (!flights || estimate.travel.mode !== 'fly') return undefined;
      const destination = estimate.travel.destination;
      const key = `f:${originAirport.iata}:${destination}:${checkIn}:${checkOut}:${travelers}`;
      try {
        const quote = await liveCache.getOrSet(key, () => flights.roundTrip({
          origin: originAirport.iata, destination, departDate: checkIn, returnDate: checkOut, adults: travelers,
        }));
        live.flights = quote ? 'ok' : 'no-results';
        return quote ? { mode: 'fly', destination, miles: estimate.travel.miles, ...quote } : undefined;
      } catch (error) {
        live.flights = 'error';
        console.error(`[flights] ${error.message}`);
        return undefined;
      }
    };

    const liveHotels = async () => {
      if (!hotels || estimate.travel.local) return undefined;
      const key = `h:${festival.id}:${checkIn}:${checkOut}:${travelers}:${rooms}`;
      try {
        const quote = await liveCache.getOrSet(key, () => hotels.cheapestStay({
          city: festival.city, state: festival.state, checkIn, checkOut, adults: travelers, rooms,
        }));
        live.hotels = quote ? 'ok' : 'no-results';
        return quote ?? undefined;
      } catch (error) {
        live.hotels = 'error';
        console.error(`[hotels] ${error.message}`);
        return undefined;
      }
    };

    const [travel, lodging] = await Promise.all([liveFlights(), liveHotels()]);
    res.json({
      ...buildTrip({ festival, edition, festivalAirports: airports, ...options, travel, lodging }),
      live,
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(PUBLIC_DIR));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof BadRequest) return res.status(400).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
