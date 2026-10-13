// Offline trip-cost model. Every number here is a rough heuristic so the site can
// rank festivals instantly without calling paid APIs; the UI labels these values
// as estimates and swaps in live prices (Skyscanner etc.) when they're available.

import { distanceMiles } from './geo.js';
import { addDays, daysBetween } from './dates.js';

export const ASSUMPTIONS = {
  // Under this straight-line distance between airports, driving beats flying.
  driveMaxMiles: 300,
  // Under this many road miles you can sleep at home.
  localMiles: 60,
  // Straight-line miles to road miles.
  roadFactor: 1.2,
  // Fuel only, ~25 mpg at ~$3.50/gal.
  fuelPerMile: 0.14,
  peoplePerCar: 4,
  // Round-trip economy fare per person: base + perMile * one-way miles.
  fareBase: 110,
  farePerMile: 0.12,
  // Regional airports tend to be pricier than hubs.
  regionalAirportMultiplier: 1.2,
  // Nightly room rate before festival demand, by the size of the nearest airport's metro.
  roomRateLargeMetro: 165,
  roomRateRegional: 135,
  // Hotels near festivals price up on show weekends.
  festivalDemandMultiplier: 1.5,
  peoplePerRoom: 2,
  // Long festivals (SXSW, Musikfest) are priced as a stay of at most this many nights.
  maxNights: 5,
};

const roundTo = (value, step) => Math.round(value / step) * step;

export function tripDates(edition, { arriveEarly = false } = {}) {
  const checkIn = arriveEarly ? addDays(edition.start, -1) : edition.start;
  const fullStay = daysBetween(checkIn, addDays(edition.end, 1));
  const nights = Math.min(fullStay, ASSUMPTIONS.maxNights);
  return { checkIn, checkOut: addDays(checkIn, nights), nights, shortened: nights < fullStay };
}

// Decides whether to drive or fly. A festival's first airport is its closest
// practical one, so it doubles as the festival's location; the others are
// alternatives that can sit 100+ miles away.
export function estimateTravel({ originAirport, festivalAirports, travelers }) {
  const destination = festivalAirports[0];
  const miles = distanceMiles(originAirport, destination);

  if (miles <= ASSUMPTIONS.driveMaxMiles) {
    const roadMiles = Math.round(miles * ASSUMPTIONS.roadFactor);
    const cars = Math.ceil(travelers / ASSUMPTIONS.peoplePerCar);
    const total = roundTo(roadMiles * 2 * ASSUMPTIONS.fuelPerMile * cars, 5);
    return {
      mode: 'drive',
      destination: destination.iata,
      miles: roadMiles,
      perPerson: Math.round(total / travelers),
      total,
      source: 'estimate',
      local: roadMiles < ASSUMPTIONS.localMiles,
      note: `About ${roadMiles} road miles each way; fuel only.`,
    };
  }

  let fare = ASSUMPTIONS.fareBase + ASSUMPTIONS.farePerMile * miles;
  if (destination.size !== 'large') fare *= ASSUMPTIONS.regionalAirportMultiplier;
  if (originAirport.size !== 'large') fare *= ASSUMPTIONS.regionalAirportMultiplier;
  const perPerson = roundTo(fare, 5);

  return {
    mode: 'fly',
    destination: destination.iata,
    miles: Math.round(miles),
    perPerson,
    total: perPerson * travelers,
    source: 'estimate',
    note: `Round trip ${originAirport.iata} ⇄ ${destination.iata}, economy.`,
  };
}

export function estimateLodging({ festivalAirports, nights, rooms, shortened = false }) {
  const base = festivalAirports[0].size === 'large'
    ? ASSUMPTIONS.roomRateLargeMetro
    : ASSUMPTIONS.roomRateRegional;
  const nightly = roundTo(base * ASSUMPTIONS.festivalDemandMultiplier, 5);
  return {
    nights,
    rooms,
    nightly,
    total: nightly * nights * rooms,
    source: 'estimate',
    note: `${rooms} room${rooms > 1 ? 's' : ''} × ${nights} night${nights > 1 ? 's' : ''}`
      + (shortened ? ` (first ${nights} nights of a longer festival).` : '.'),
  };
}

// Festivals without a verified price get `typicalPrice` (the median of the
// verified ones) so they don't rank as free.
export function ticketCost({ festival, travelers, typicalPrice }) {
  const price = festival.ticket?.gaFrom;
  if (price == null) {
    return {
      perPerson: typicalPrice,
      total: typicalPrice * travelers,
      source: 'estimate',
      note: 'Price not verified; typical GA price used.',
    };
  }
  const perPerson = Math.round(price);
  return { perPerson, total: perPerson * travelers, source: 'festival', note: festival.ticket.note };
}

export const defaultRooms = (travelers) => Math.ceil(travelers / ASSUMPTIONS.peoplePerRoom);

// Combines the three cost components into one trip summary. `travel` and `lodging`
// can be passed in (e.g. live prices) to replace the offline estimates.
export function buildTrip({
  festival, edition, originAirport, festivalAirports, travelers, rooms, arriveEarly, typicalTicketPrice,
  travel, lodging,
}) {
  const dates = tripDates(edition, { arriveEarly });
  const travelCost = travel ?? estimateTravel({ originAirport, festivalAirports, travelers });
  const lodgingCost = lodging ?? (travelCost.local
    ? { nights: 0, rooms: 0, nightly: 0, total: 0, source: 'estimate', note: 'Close enough to sleep at home.' }
    : estimateLodging({ festivalAirports, rooms, ...dates }));
  const tickets = ticketCost({ festival, travelers, typicalPrice: typicalTicketPrice });

  const total = travelCost.total + lodgingCost.total + tickets.total;
  return {
    festivalId: festival.id,
    edition,
    origin: originAirport.iata,
    travelers,
    rooms,
    dates,
    travel: travelCost,
    lodging: lodgingCost,
    tickets,
    total,
    perPerson: Math.round(total / travelers),
    currency: 'USD',
  };
}
