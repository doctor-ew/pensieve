import { settings } from './pools.js';
import type { ShareInput } from './executive.js';
export function shareConfig() {
  const config = settings();
  return { url: process.env.PENSIEVE_SHARE_URL ?? config.shareService, token: process.env.PENSIEVE_SHARE_TOKEN ?? config.shareToken };
}
export async function shareRequest(path = '', input?: ShareInput | Record<string, never>, connection?: { url: string; token: string }): Promise<unknown> {
  const config = connection ?? shareConfig();
  if (!config.url || !config.token) throw new Error('Sharing is not connected yet. Open Sharing settings to connect your hosted service.');
  const url = new URL(`/api/shares${path}`, config.url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Sharing requires an HTTPS service');
  const response = await fetch(url, { method: input ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: input ? JSON.stringify(input) : undefined });
  if (!response.ok) throw new Error(`Sharing service request failed (${response.status}). Check the connection in Sharing settings.`);
  return response.json();
}
