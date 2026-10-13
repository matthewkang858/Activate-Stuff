# Festival Planner

Pick a US music festival by what the **whole trip** costs: tickets, getting there and a place to sleep.

Enter your home airport, how many people are going and what you're into, and the site ranks upcoming
festivals by estimated cost per person. Click **Get live prices** on a festival to swap the estimates for real
hotel rates (LiteAPI) and flight fares (Skyscanner) when those API keys are configured.

This started from [TMcMeans/The-Music-Festival-API](https://github.com/TMcMeans/The-Music-Festival-API)
(2019 data, Express + Postgres). Its dates were strings like `4/12/19-4/21/19`, with no genres, prices or
airport codes, so the festival list has been rebuilt for the 2026 season with a richer schema. The Postgres
layer has been dropped in favor of a JSON file: a list this size doesn't need a database, and the app now
runs anywhere Node does.

## Run it

```bash
cd festival-planner
npm install
cp .env.example .env   # optional: add API keys
npm start              # http://localhost:3000
npm test
```

Requires Node 22.9+. The only runtime dependency is Express.

## How costs are worked out

| Piece | Without API keys | With API keys |
| --- | --- | --- |
| Tickets | Cheapest general-admission pass found for the 2026 edition (some include fees; the card says which). Festivals without a verified price use the median of the verified ones | Same |
| Travel | Drive (fuel only) if you're within 300 miles; otherwise a distance-based round-trip fare | Skyscanner live fare (cheapest round trip) |
| Hotel | Nightly rate by city size × festival-weekend demand; none if you live within 60 miles; stays capped at 5 nights | LiteAPI: cheapest room within 15 km of the venue (40 km if nothing's free), including resort/facility fees paid at the hotel |

All the estimate knobs live in `ASSUMPTIONS` in [`src/estimate.js`](src/estimate.js). They're heuristics
for **comparing** festivals, not quotes, and the UI labels them as estimates.

Festivals whose next dates haven't been announced are projected 52 weeks ahead from their last edition, which
keeps a Friday–Sunday festival on Friday–Sunday. These show a **projected** badge and can be hidden.

## Live prices and API keys

### Hotels: LiteAPI

1. Sign up at [dashboard.liteapi.travel](https://dashboard.liteapi.travel/register) and copy the sandbox key
   (it starts with `sand_`).
2. Put it in `.env` as `LITEAPI_API_KEY=...` and restart.
3. Run `npm run check:liteapi` once. It prices one hotel for 1 night and for 3 nights to confirm that LiteAPI's
   offer price covers the whole stay, which is what the app assumes. LiteAPI's docs don't say either way.

How it searches ([`src/providers/liteapi.js`](src/providers/liteapi.js)): one `POST /v3.0/hotels/rates` around
the festival's coordinates, splitting your group across the rooms you asked for, cheapest rate per hotel. If
nothing comes back within 15 km it tries 40 km, then falls back to the estimate. Sandbox keys may return test
prices; the card says "Sandbox test price" when they do. If they turn out to be test data, switch to a production key.
Hotel prices also work for projected dates, as a preview.

### Flights: Skyscanner

**Skyscanner is wired up but hard to get.** Keys are only issued to approved commercial partners:
established businesses with roughly 100k+ monthly users. Students, individuals, early start-ups and low-traffic
sites are explicitly excluded ([acceptance criteria](https://skyscannerpartnersupport.zendesk.com/hc/en-us/articles/10881149122717-What-is-the-acceptance-criteria-for-the-Travel-API),
[apply](https://www.partners.skyscanner.net/product/travel-api)). If you do get a key, the integration follows
their [usage guidelines](https://developers.skyscanner.net/docs/getting-started/usage-guidelines):

- Live searches only run when a visitor clicks for one festival, and never for projected dates.
- Results show "Powered by Skyscanner" linked to skyscanner.net. The guidelines also want their logo there.
- Their terms disagree on caching (24 hours vs. none), so set `LIVE_CACHE_MINUTES` to whatever your agreement says.
- Not yet checked against a real response: whether the price is per person or for the whole party. The code assumes the whole party.
- For ranking many festivals at once, their separate Flights Indicative Prices API (cached prices) is the right tool, not Live Prices.

### Other options

Not wired up; each would be a new file in `src/providers/` exposing the same `roundTrip()` / `cheapestStay()`
shape that `src/app.js` already calls:

| Need | Option | Notes |
| --- | --- | --- |
| Flights (or hotels) | SerpApi (Google Flights / Google Hotels) | Paid per search, simple to call; good for estimates |
| Flights | Duffel | Real bookable fares, self-serve; built for booking, so heavy search-only use may cost extra |
| Ticket prices | Ticketmaster Discovery API | Free key; `priceRanges` is often missing for festivals, so keep the hand-entered prices as a fallback |

Amadeus Self-Service, the usual free choice for both flights and hotels, has been [deprecated](https://github.com/amadeus4dev/developer-guides) (its GitHub org was archived in July 2026), so it is not an option.

## API

All endpoints are `GET` and return JSON.

| Endpoint | What it returns |
| --- | --- |
| `/api/v1/festivals` | All festivals. Filters: `state=CA,NV`, `genre=rock,indie`, `from=2027-01-01`, `to=2027-06-30`, `q=coach`, `projected=0` |
| `/api/v1/festivals/:id` | One festival, including source links for its data |
| `/api/v1/states` | States with a festival count |
| `/api/v1/states/:state/festivals` | Festivals in one state (`CA`) |
| `/api/v1/plan?origin=JFK&travelers=2` | Festivals ranked by estimated cost per person. Takes the festival filters plus `rooms`, `arriveEarly=1`, `maxPerPerson` |
| `/api/v1/festivals/:id/trip?origin=JFK&travelers=2` | Cost breakdown for one festival. `start=2027-04-16` picks other dates (e.g. Coachella weekend 2); `live=1` calls the price APIs |
| `/api/v1/airports` | US airports with scheduled service (for the origin picker) |
| `/api/v1/config` | Which live price providers are configured |

`/plan` never calls paid APIs, so ranking every festival is instant. Live searches only happen when someone
asks for one festival, are cached for 10 minutes and are rate-limited per visitor (both configurable in `.env`).

## Data

- [`data/festivals.json`](data/festivals.json): one entry per festival with ISO dates per edition, venue
  coordinates, genres, official site, cheapest GA price, camping, nearby airports (closest first) and source
  links. Edit this file to add or update festivals; `npm test` validates it, including that the venue is
  within 150 miles of its first airport.
- Venue coordinates were placed independently by two methods (the town's [GeoNames](https://www.geonames.org/)
  centroid and a venue lookup) and any that disagreed by more than 12 miles, or had no town match, were
  resolved by a third check. Expect them to be within about a mile of the venue, which is plenty for a hotel
  search.
- [`data/airports.json`](data/airports.json): US airports with scheduled airline service, built from
  [OurAirports](https://ourairports.com/data/) (public domain) by `npm run build:airports -- <airports.json>`.

### What's in the 2026 data

65 festivals across 27 states, researched in October 2026 from news coverage (Pollstar, Billboard, local press) and
festival announcements. Each entry links its sources, and `dataNotes` records anything uncertain, such as
conflicting prices or a price that already includes fees.

- **Confirmed 2027 dates** are included where announced (Coachella, Stagecoach, EDC Las Vegas, Jazz Fest,
  Summerfest, Ultra, Boston Calling, SXSW, CMA Fest and a few more). Everything else is projected.
- **Bonnaroo** is marked `hiatus`: organizers announced no 2027 edition, so it isn't projected forward.
- **Left out** because they didn't run in 2026 and have no announced return date: Cruel World,
  When We Were Young (returns Oct 2027), Punk Rock Bowling, Watershed, Float Fest, Voodoo, Adjacent, Something in
  the Water, Firefly, ONE Musicfest, Music Midtown, Hangout (returns May 2027), SunFest and Dreamville.
- **Not researched yet** (add them when you can verify dates): Forecastle, Louder Than Life, Bourbon & Beyond,
  Railbird, Hinterland, Rocklahoma, Rock the Garden, Basilica Block Party and Boulevardia.
- Prices are the cheapest tier found, which often sold out early, so treat them as a floor.
