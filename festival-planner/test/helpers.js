import { loadData } from '../src/data.js';

export const airports = [
  { iata: 'JFK', name: 'John F Kennedy International Airport', city: 'New York', state: 'NY', lat: 40.6394, lon: -73.7793, size: 'large' },
  { iata: 'LAX', name: 'Los Angeles International Airport', city: 'Los Angeles', state: 'CA', lat: 33.9425, lon: -118.408, size: 'large' },
  { iata: 'PSP', name: 'Palm Springs International Airport', city: 'Palm Springs', state: 'CA', lat: 33.8297, lon: -116.507, size: 'medium' },
  { iata: 'ORD', name: "Chicago O'Hare International Airport", city: 'Chicago', state: 'IL', lat: 41.9786, lon: -87.9048, size: 'large' },
  { iata: 'BNA', name: 'Nashville International Airport', city: 'Nashville', state: 'TN', lat: 36.1245, lon: -86.6782, size: 'large' },
];

export const festivals = [
  {
    id: 'desert-fest',
    name: 'Desert Fest',
    city: 'Indio',
    state: 'CA',
    venue: 'Polo Club',
    genres: ['pop', 'indie'],
    website: 'https://example.com/desert',
    camping: true,
    airports: ['PSP', 'LAX'],
    ticket: { gaFrom: 500, note: '3-day GA', year: 2026 },
    status: 'active',
    editions: [
      { year: 2026, start: '2026-04-17', end: '2026-04-19', label: 'Weekend 2' },
      { year: 2026, start: '2026-04-10', end: '2026-04-12', label: 'Weekend 1' },
    ],
    sources: ['https://example.com/desert'],
  },
  {
    id: 'lake-fest',
    name: 'Lake Fest',
    city: 'Chicago',
    state: 'IL',
    venue: null,
    genres: ['rock'],
    website: 'https://example.com/lake',
    camping: false,
    airports: ['ORD', 'XXX'],
    ticket: null,
    status: 'active',
    editions: [
      { year: 2026, start: '2026-07-30', end: '2026-08-02', label: null },
      { year: 2027, start: '2027-07-29', end: '2027-08-01', label: null },
    ],
    sources: [],
  },
  {
    id: 'sleepy-fest',
    name: 'Sleepy Fest',
    city: 'Nashville',
    state: 'TN',
    venue: null,
    genres: ['country'],
    website: null,
    camping: null,
    airports: ['BNA'],
    ticket: null,
    status: 'hiatus',
    editions: [{ year: 2025, start: '2025-06-06', end: '2025-06-08', label: null }],
    sources: [],
  },
];

export const testData = () => loadData({ festivals, airports });
