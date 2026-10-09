import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLandingRoute } from '../js/landing-route.js';

const entry = 'https://example.test/seni/index.html';

test('ordinary entries stay on the landing page', () => {
  for (const suffix of ['', '#hello', '?n=48000&dpr=2', '?tune=0&live=0&orbit=0', '?live=true']) {
    assert.equal(resolveLandingRoute(entry + suffix), null);
  }
});

test('study links preserve all overrides and the fragment', () => {
  for (const flag of ['tune=1', 'live=1', 'live=1&tune=1']) {
    const suffix = `?${flag}&n=32000&dpr=2&custom=a%20b&n=48000#speech-lab`;
    assert.equal(resolveLandingRoute(entry + suffix), 'https://example.test/seni/study.html' + suffix);
  }
  assert.equal(resolveLandingRoute('https://example.test/seni/?tune=1#lab'),
    'https://example.test/seni/study.html?tune=1#lab');
});

test('live and tuning retain priority over legacy Orbit links', () => {
  for (const suffix of ['?orbit=1&live=1', '?orbit=1&tune=1', '?orbit=1&tune=1&live=1&n=48000']) {
    assert.equal(resolveLandingRoute(entry + suffix), 'https://example.test/seni/study.html' + suffix);
  }
});

test('legacy Orbit links retain only the first n parameter', () => {
  assert.equal(resolveLandingRoute(entry + '?orbit=1'), 'https://example.test/seni/orbit.html');
  assert.equal(resolveLandingRoute(entry + '?orbit=1&n=48000&dpr=2#old'),
    'https://example.test/seni/orbit.html?n=48000');
  assert.equal(resolveLandingRoute(entry + '?orbit=1&n='), 'https://example.test/seni/orbit.html?n=');
  assert.equal(resolveLandingRoute(entry + '?orbit=1&n=32000&n=48000'),
    'https://example.test/seni/orbit.html?n=32000');
});

test('an existing study route does not redirect to itself', () => {
  assert.equal(resolveLandingRoute('https://example.test/seni/study.html?tune=1#lab'), null);
});
