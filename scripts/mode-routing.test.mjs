import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(process.env.NOVA_ROUTE_SOURCE
  || new URL('../js/main.js', import.meta.url), 'utf8');
// Execute the actual early routing before face assets or voice are initialized.
const end = source.indexOf('const requestedN =');
assert.ok(end > 0, 'the routing check must stay ahead of the main bootstrap');
const routing = source.slice(0, end).replace(/^import .*;\n/gm, '');

function route(query) {
  const calls = [], url = new URL(`https://example.test/nova/index.html${query}`);
  vm.runInNewContext(routing, { URL, URLSearchParams, window: {
    matchMedia: () => ({ matches: false }),
    location: { search: url.search, href: url.href, replace: value => calls.push(value) }
  } });
  return calls;
}

test('legacy Orbit links open the standalone page and preserve only the particle override', () => {
  assert.deepEqual(route('?orbit=1'), ['https://example.test/nova/orbit.html']);
  assert.deepEqual(route('?orbit=1&n=48000&unrelated=value'), ['https://example.test/nova/orbit.html?n=48000']);
  assert.deepEqual(route('?orbit=1&n='), ['https://example.test/nova/orbit.html?n=']);
});

test('live, tuning and ordinary entry never redirect to Orbit', () => {
  for (const query of ['', '?live=1', '?tune=1', '?n=48000', '?orbit=0',
    '?orbit=1&live=1', '?orbit=1&tune=1', '?orbit=1&live=1&tune=1&n=48000']) {
    assert.deepEqual(route(query), [], query || 'default entry');
  }
});
