const form = document.querySelector('#filters');
const statusEl = document.querySelector('#status');
const resultsEl = document.querySelector('#results');
const cardTemplate = document.querySelector('#card-template');

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const yearFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' });

const MAX_BUDGET = Number(form.maxPerPerson.max);
const ORIGIN_KEY = 'festival-planner:origin';

let config = { live: { flights: null, hotels: null } };
let airportCodes = new Set();
let selectedGenres = new Set();
let requestId = 0;

const api = async (path, params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  const res = await fetch(`/api/v1/${path}${query.size ? `?${query}` : ''}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
};

const formatRange = ({ start, end }) => {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const days = start === end ? dayFmt.format(s) : `${dayFmt.format(s)} – ${dayFmt.format(e)}`;
  return `${days}, ${yearFmt.format(e)}`;
};

const originCode = () => form.origin.value.trim().slice(0, 3).toUpperCase();
const hasOrigin = () => airportCodes.has(originCode());

function readParams() {
  const budget = Number(form.maxPerPerson.value);
  return {
    origin: hasOrigin() ? originCode() : '',
    travelers: form.travelers.value,
    rooms: form.rooms.value,
    arriveEarly: form.arriveEarly.checked ? '1' : '',
    genre: [...selectedGenres].join(','),
    from: form.from.value,
    to: form.to.value,
    state: form.state.value,
    maxPerPerson: budget < MAX_BUDGET ? String(budget) : '',
    projected: form.projected.checked ? '' : '0',
    sort: form.sort.value === 'date' ? 'date' : '',
  };
}

// Keeps the URL shareable: every filter lives in the query string.
function syncUrl(params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  history.replaceState(null, '', query.size ? `?${query}` : location.pathname);
}

function restoreForm() {
  const q = new URLSearchParams(location.search);
  let storedOrigin = '';
  try { storedOrigin = localStorage.getItem(ORIGIN_KEY) ?? ''; } catch { /* storage unavailable */ }
  form.origin.value = q.get('origin') ?? storedOrigin;
  if (q.has('travelers')) form.travelers.value = q.get('travelers');
  if (q.has('rooms')) form.rooms.value = q.get('rooms');
  form.arriveEarly.checked = q.get('arriveEarly') === '1';
  selectedGenres = new Set((q.get('genre') ?? '').split(',').filter(Boolean));
  if (q.has('from')) form.from.value = q.get('from');
  if (q.has('to')) form.to.value = q.get('to');
  if (q.has('state')) form.state.value = q.get('state');
  if (q.has('maxPerPerson')) form.maxPerPerson.value = q.get('maxPerPerson');
  form.projected.checked = q.get('projected') !== '0';
  form.sort.value = q.get('sort') === 'date' ? 'date' : 'cost';
}

function updateBudgetLabel() {
  const value = Number(form.maxPerPerson.value);
  form.querySelector('#budgetOut').value = value >= MAX_BUDGET ? 'No limit' : money.format(value);
}

function renderGenres(genres) {
  const container = document.querySelector('#genres');
  container.replaceChildren(...genres.map((genre) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = genre;
    button.setAttribute('aria-pressed', String(selectedGenres.has(genre)));
    button.addEventListener('click', () => {
      if (selectedGenres.has(genre)) selectedGenres.delete(genre);
      else selectedGenres.add(genre);
      button.setAttribute('aria-pressed', String(selectedGenres.has(genre)));
      refresh();
    });
    return button;
  }));
}

function sourceBadge(source) {
  if (source === 'estimate') return '<span class="badge">estimate</span>';
  if (source === 'unknown' || source === 'festival') return '';
  return '<span class="badge live">live</span>';
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function renderTrip(card, trip) {
  const { tickets, travel, lodging } = trip;
  card.querySelector('.per-person').textContent = money.format(trip.perPerson);
  card.querySelector('.price').hidden = false;

  const parts = [
    ['tickets', tickets.total],
    ['travel', travel.total],
    ['lodging', lodging.total],
  ];
  const bar = card.querySelector('.bar');
  bar.hidden = false;
  bar.replaceChildren(...parts.filter(([, v]) => v > 0).map(([kind, value]) => {
    const span = document.createElement('span');
    span.className = kind;
    span.style.flexGrow = String(value);
    return span;
  }));
  bar.setAttribute('aria-label', `Cost split: tickets ${money.format(tickets.total)}, travel ${money.format(travel.total)}, hotel ${money.format(lodging.total)}`);

  const travelLabel = travel.mode === 'drive' ? 'Drive' : 'Flights';
  const ticketAmount = tickets.total === 0 ? 'Free' : money.format(tickets.total);
  const booking = travel.deepLink
    ? ` <a href="${escapeHtml(travel.deepLink)}" target="_blank" rel="noopener sponsored">Book ↗</a>`
    : '';
  // Lines are what the whole group pays; the headline is that total split per person.
  const people = trip.travelers;
  // Only shown when it multiplies out exactly (live fares can be off by rounding).
  const each = ({ perPerson, total }) => (people > 1 && perPerson > 0 && perPerson * people === total
    ? ` (${people}\u00a0×\u00a0${money.format(perPerson)})` : '');
  const flightsEach = travel.mode === 'fly' ? each(travel) : '';
  card.querySelector('.breakdown').innerHTML = `
    <dt class="tickets">Tickets</dt><dd>${escapeHtml(tickets.note)}${each(tickets)} ${sourceBadge(tickets.source)}</dd><dd class="amount">${ticketAmount}</dd>
    <dt class="travel">${travelLabel}</dt><dd>${escapeHtml(travel.note)}${flightsEach} ${sourceBadge(travel.source)}${booking}</dd><dd class="amount">${money.format(travel.total)}</dd>
    <dt class="lodging">Hotel</dt><dd>${escapeHtml(lodging.note)} ${sourceBadge(lodging.source)}</dd><dd class="amount">${money.format(lodging.total)}</dd>
    <dt class="total">Total for ${people} ${people === 1 ? 'person' : 'people'}</dt><dd class="amount total">${money.format(trip.total)}</dd>
  `;
}

function renderWhen(card, edition) {
  const when = card.querySelector('.when');
  when.textContent = formatRange(edition) + (edition.label ? ` · ${edition.label}` : '');
  if (edition.projected) {
    when.insertAdjacentHTML('beforeend', ' <span class="badge projected" title="Next dates not announced; assumes the same weekend as last year">projected</span>');
  }
}

function tripParams(edition, live) {
  const { origin, travelers, rooms, arriveEarly } = readParams();
  return { origin, travelers, rooms, arriveEarly, start: edition.start, live: live ? '1' : '' };
}

function describeLive(live) {
  const labels = {
    ok: 'live price',
    'no-results': 'no live results; showing estimate',
    error: 'live search failed; showing estimate',
    'not-configured': 'no API key configured',
    'no-location': 'festival location unknown; showing estimate',
    'needs-confirmed-dates': 'needs confirmed dates; showing estimate',
    skipped: 'not needed',
  };
  return `Flights: ${labels[live.flights] ?? live.flights}. Hotels: ${labels[live.hotels] ?? live.hotels}.`;
}

// Live flight prices need confirmed dates; hotel prices also work as a
// preview for projected ones.
function updateLiveButton(button, edition) {
  button.hidden = !((config.live.flights && !edition.projected) || config.live.hotels);
}

function renderCard(festival, trip) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('.name').textContent = festival.name;
  card.querySelector('.where').textContent = [festival.venue, `${festival.city}, ${festival.state}`].filter(Boolean).join(' · ');
  card.querySelector('.genres').replaceChildren(...festival.genres.map((g) => {
    const li = document.createElement('li');
    li.textContent = g;
    return li;
  }));

  const link = card.querySelector('.site-link');
  if (festival.website) link.href = festival.website;
  else link.remove();

  const editions = festival.upcoming;
  const note = card.querySelector('.card-note');
  if (editions.length === 0) {
    card.querySelector('.when').textContent = festival.status === 'hiatus' ? 'On hiatus' : 'No upcoming dates';
  } else {
    renderWhen(card, editions[0]);
  }

  if (!trip) {
    // No home airport yet: show the ticket price on its own.
    const price = festival.ticket?.gaFrom;
    card.querySelector('.bar').hidden = true;
    if (price == null) {
      card.querySelector('.price').hidden = true;
    } else {
      card.querySelector('.per-person').textContent = price === 0 ? 'Free' : money.format(price);
      card.querySelector('.per-person-label').textContent = festival.ticket.note;
    }
    return card;
  }
  renderTrip(card, trip);

  const select = card.querySelector('.edition');
  let edition = editions[0];
  // Only the latest request for this card may draw, so a slow live search
  // can't overwrite the dates picked after it started.
  let cardRequest = 0;
  if (editions.length > 1) {
    select.hidden = false;
    select.replaceChildren(...editions.map((e, i) => new Option(e.label ?? formatRange(e), String(i))));
    select.addEventListener('change', async () => {
      const id = ++cardRequest;
      edition = editions[Number(select.value)];
      renderWhen(card, edition);
      updateLiveButton(card.querySelector('.live-btn'), edition);
      note.hidden = true;
      try {
        const trip = await api(`festivals/${festival.id}/trip`, tripParams(edition, false));
        if (id === cardRequest) renderTrip(card, trip);
      } catch (error) {
        if (id !== cardRequest) return;
        note.hidden = false;
        note.textContent = error.message;
      }
    });
  }

  const liveButton = card.querySelector('.live-btn');
  updateLiveButton(liveButton, edition);
  if (config.live.flights || config.live.hotels) {
    liveButton.addEventListener('click', async () => {
      const id = ++cardRequest;
      liveButton.disabled = true;
      liveButton.textContent = 'Searching…';
      note.hidden = false;
      note.textContent = 'Checking live fares and rooms. This can take 10–20 seconds.';
      try {
        const live = await api(`festivals/${festival.id}/trip`, tripParams(edition, true));
        if (id !== cardRequest) return;
        renderTrip(card, live);
        note.textContent = describeLive(live.live)
          + (live.edition.projected ? ' Dates are projected, so treat live prices as a preview.' : '');
        if (live.travel.source === 'skyscanner') {
          note.insertAdjacentHTML('beforeend', ' <a href="https://www.skyscanner.net" target="_blank" rel="noopener">Powered by Skyscanner</a>');
        }
      } catch (error) {
        if (id === cardRequest) note.textContent = error.message;
      } finally {
        liveButton.disabled = false;
        liveButton.textContent = 'Refresh live prices';
      }
    });
  }
  return card;
}

const soonest = (a, b) => (a.upcoming[0]?.start ?? '9999').localeCompare(b.upcoming[0]?.start ?? '9999');

async function refresh() {
  updateBudgetLabel();
  const params = readParams();
  syncUrl({ ...params, origin: hasOrigin() ? originCode() : '' });
  if (hasOrigin()) {
    try { localStorage.setItem(ORIGIN_KEY, originCode()); } catch { /* storage unavailable */ }
  }

  const id = ++requestId;
  statusEl.textContent = 'Crunching numbers…';
  try {
    let rows;
    if (params.origin) {
      const plan = await api('plan', params);
      rows = plan.results;
      if (params.sort === 'date') rows.sort((a, b) => soonest(a.festival, b.festival));
    } else {
      const { genre, from, to, state, projected } = params;
      const festivals = await api('festivals', { genre, from, to, state, projected });
      rows = festivals.filter((f) => f.upcoming.length > 0).sort(soonest).map((festival) => ({ festival }));
    }
    if (id !== requestId) return;

    resultsEl.replaceChildren(...rows.map(({ festival, trip }) => renderCard(festival, trip)));
    const count = `${rows.length} festival${rows.length === 1 ? '' : 's'}`;
    statusEl.textContent = params.origin
      ? `${count} · estimated cost from ${params.origin} for ${params.travelers || 1} ${Number(params.travelers) === 1 ? 'person' : 'people'}`
      : `${count} · enter your home airport to see what each trip would cost`;
  } catch (error) {
    if (id !== requestId) return;
    statusEl.textContent = error.message;
    resultsEl.replaceChildren();
  }
}

let debounceTimer;
const refreshSoon = () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(refresh, 250);
};

async function init() {
  const [configRes, airports, states, festivals] = await Promise.all([
    api('config'), api('airports'), api('states'), api('festivals'),
  ]);
  config = configRes;
  airportCodes = new Set(airports.map((a) => a.iata));

  document.querySelector('#airport-list').replaceChildren(
    ...airports.map((a) => new Option(`${a.city}, ${a.state} · ${a.name}`, a.iata)),
  );
  form.state.append(...states.map((s) => new Option(`${s.name} (${s.festivals})`, s.state)));

  const genreCounts = new Map();
  for (const f of festivals) for (const g of f.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  restoreForm();
  renderGenres([...genreCounts.keys()].sort((a, b) => genreCounts.get(b) - genreCounts.get(a)));

  form.addEventListener('input', (event) => {
    if (event.target === form.origin && !hasOrigin() && form.origin.value.trim()) return;
    refreshSoon();
  });
  form.addEventListener('submit', (event) => event.preventDefault());

  await refresh();
}

init().catch((error) => {
  statusEl.textContent = `Couldn't load festivals: ${error.message}`;
});
