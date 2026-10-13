import { createApp } from './src/app.js';
import { loadData } from './src/data.js';
import { createSkyscannerFlights } from './src/providers/skyscanner.js';

const env = process.env;

const flights = env.SKYSCANNER_API_KEY
  ? createSkyscannerFlights({ apiKey: env.SKYSCANNER_API_KEY })
  : null;

const app = createApp({
  data: loadData(),
  flights,
  liveCacheTtlMs: Number(env.LIVE_CACHE_MINUTES ?? 10) * 60 * 1000,
  liveRequestsPerMinute: Number(env.LIVE_REQUESTS_PER_MINUTE ?? 20),
});

const port = Number(env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Festival Planner on http://localhost:${port}`);
  console.log(`Live flight prices: ${flights ? 'Skyscanner' : 'off (set SKYSCANNER_API_KEY)'}`);
});
