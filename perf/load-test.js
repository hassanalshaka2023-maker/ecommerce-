// Load test for the most-read endpoints. The same script runs before and after every change.
// Run (from the project folder): docker run --rm -v ${PWD}/perf:/perf grafana/k6 run /perf/load-test.js
// Add  -e ETAG=1  after "run" to make the virtual users behave like browsers:
// they remember the ETag of every URL and send it back in If-None-Match.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://host.docker.internal:3001/api/v1';
const USE_ETAG = __ENV.ETAG === '1';

// 304 (not modified) is a correct answer, not a failure.
http.setResponseCallback(http.expectedStatuses(200, 304));

export const options = {
  vus: 50,
  duration: '30s',
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'avg', 'max'],
  // One empty threshold per endpoint, only so k6 prints each endpoint's numbers separately.
  thresholds: {
    'http_req_duration{name:products-list}': [],
    'http_req_duration{name:products-category}': [],
    'http_req_duration{name:product-details}': [],
    'http_req_duration{name:my-orders}': [],
    'http_req_duration{name:my-notifications}': [],
  },
};

// Logins are limited to 5 per minute, so a few customers are shared by all virtual users.
export function setup() {
  const tokens = [1, 2, 3].map((n) => {
    const res = http.post(
      `${BASE}/auth/login`,
      JSON.stringify({ email: `customer${n}@seed.local`, password: 'Passw0rd!' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (res.status !== 200) throw new Error(`Login failed with ${res.status}, wait a minute and retry`);
    return res.json('accessToken');
  });
  const productIds = http.get(`${BASE}/products?limit=50`).json('items').map((p) => p.id);
  return { tokens, productIds };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const etags = {}; // one per virtual user, like a browser's cache
function get(url, params) {
  if (USE_ETAG && etags[url]) {
    params.headers = { ...params.headers, 'If-None-Match': etags[url] };
  }
  const res = http.get(url, params);
  if (res.headers.Etag) etags[url] = res.headers.Etag;
  return res;
}

export default function ({ tokens, productIds }) {
  const auth = { headers: { Authorization: `Bearer ${pick(tokens)}` } };
  const r = Math.random();
  let res;

  if (r < 0.35) {
    const page = 1 + Math.floor(Math.random() * 50);
    res = get(`${BASE}/products?page=${page}&limit=20`, { tags: { name: 'products-list' } });
  } else if (r < 0.55) {
    const category = `category-${1 + Math.floor(Math.random() * 20)}`;
    res = get(`${BASE}/products?category=${category}&limit=20`, { tags: { name: 'products-category' } });
  } else if (r < 0.8) {
    res = get(`${BASE}/products/${pick(productIds)}`, { tags: { name: 'product-details' } });
  } else if (r < 0.9) {
    res = get(`${BASE}/orders`, { ...auth, tags: { name: 'my-orders' } });
  } else {
    res = get(`${BASE}/notifications`, { ...auth, tags: { name: 'my-notifications' } });
  }

  check(res, { 'status is 200 or 304': (x) => x.status === 200 || x.status === 304 });
}
