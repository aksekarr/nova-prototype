const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Runtime configuration contains only the public agent identifier, never an API key.
export async function loadAgentConfig({ fetcher = globalThis.fetch, signal } = {}) {
  try {
    const response = await fetcher('/api/agent-config', {
      cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal
    });
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) throw new Error();
    const config = await response.json();
    if (config === null || config?.agentId === null) return null;
    const agentId = typeof config?.agentId === 'string' ? config.agentId.trim() : '';
    if (!AGENT_ID.test(agentId)) throw new Error();
    return { agentId };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    throw new Error('Live configuration unavailable.');
  }
}
