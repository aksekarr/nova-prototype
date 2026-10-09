import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAgentConfig } from '../js/agent-config.js';

const response = (config, status = 200) => ({ status, ok: status >= 200 && status < 300,
  async json() { return config; } });

test('configuration is requested only from the same origin without caching', async () => {
  let requested;
  const signal = new AbortController().signal;
  const config = await loadAgentConfig({ signal, fetcher: async (...args) => {
    requested = args;
    return response({ agentId: 'agent_synthetic_test_only' });
  } });
  assert.deepEqual(config, { agentId: 'agent_synthetic_test_only' });
  assert.equal(requested[0], '/api/agent-config');
  assert.equal(requested[1].cache, 'no-store');
  assert.equal(requested[1].credentials, 'same-origin');
  assert.equal(requested[1].signal, signal);
});

test('static previews and an explicitly unconfigured server return null', async () => {
  for (const result of [response(null), response({ agentId: null }), response(null, 404), response(null, 204)]) {
    assert.equal(await loadAgentConfig({ fetcher: async () => result }), null);
  }
});

test('safe legacy identifiers are accepted and unrelated response fields are discarded', async () => {
  assert.deepEqual(await loadAgentConfig({ fetcher: async () => response({
    agentId: '  Synthetic-legacy_123  ', ignored: 'not exposed'
  }) }), { agentId: 'Synthetic-legacy_123' });
});

test('invalid or unavailable configuration produces a fixed error without provider details', async () => {
  const configurations = [{}, [], { agentId: '' }, { agentId: 123 }, { agentId: 'not an identifier' },
    { agentId: '../private' }, { agentId: 'https://example.invalid/agent' }, { agentId: 'a'.repeat(129) }];
  const fetchers = configurations.map(config => async () => response(config));
  fetchers.push(async () => response(null, 500), async () => { throw new Error('private context'); },
    async () => ({ ok: true, status: 200, json() { throw new Error('private JSON context'); } }));
  for (const fetcher of fetchers) {
    await assert.rejects(loadAgentConfig({ fetcher }), { message: 'Live configuration unavailable.' });
  }
});

test('caller cancellation remains distinguishable from a configuration failure', async () => {
  const aborted = new DOMException('Cancelled', 'AbortError');
  await assert.rejects(loadAgentConfig({ fetcher: async () => { throw aborted; } }), error => error === aborted);
});
