import type {
  Budget,
  Config,
  ConfigResponse,
  Event,
  Scenario,
  Site,
  Snapshot,
  Telemetry,
  XY,
} from './types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail =
      typeof body.detail === 'string'
        ? body.detail
        : `Ошибка сервера (${response.status})`;
    const fields = (body.errors ?? []).map(
      (e: { field: string; message: string }) => `${e.field} — ${e.message}`,
    );
    throw new Error([detail, ...fields].join('\n'));
  }
  return response.json();
}

function write<T>(path: string, method: 'POST' | 'PUT', body?: unknown) {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const site = (id: string) => '/sites/' + encodeURIComponent(id);
const coords = (point: XY, snapshot: string) =>
  new URLSearchParams({
    x: String(point.x),
    y: String(point.y),
    snapshot_id: snapshot,
  });
export const api = {
  sites: () => request<Site[]>('/sites'),
  scenarios: () => request<Scenario[]>('/scenarios'),
  snapshot: (id: string) => request<Snapshot>(site(id) + '/snapshot'),
  history: (id: string) => request<Telemetry[]>(site(id) + '/history'),
  events: (id: string) => request<Event[]>(site(id) + '/events'),
  config: (id: string) => request<ConfigResponse>(site(id) + '/config'),
  save: (id: string, config_revision: number, config: Config) =>
    write<Snapshot>(site(id) + '/config', 'PUT', { config_revision, config }),
  restore: (id: string) =>
    write<Snapshot>(site(id) + '/config/restore', 'POST'),
  scenario: (id: string, scenario: string, seed: number) =>
    write<Snapshot>(site(id) + '/scenario', 'POST', { scenario, seed }),
  control: (id: string, action: string) =>
    write<Snapshot>(site(id) + '/simulation/' + action, 'POST'),
  products: (id: string, f1: string, f2: string, snapshot_id: string) =>
    request<{
      snapshot_id: string;
      products: { frequency_mhz: number; protected_band_hit: boolean }[];
    }>(
      site(id) +
        '/imd-products?' +
        new URLSearchParams({ f1, f2, snapshot_id }),
    ),
  budget: (id: string, point: XY, snapshot: string) =>
    request<Budget>(site(id) + '/budget?' + coords(point, snapshot)),
  exportConfig: (id: string) => '/api/v1' + site(id) + '/export/config.json',
  report: (
    id: string,
    format: 'md' | 'json' | 'html',
    point: XY,
    snapshot: string,
  ) =>
    '/api/v1' +
    site(id) +
    '/export/report.' +
    format +
    '?' +
    coords(point, snapshot),
};
