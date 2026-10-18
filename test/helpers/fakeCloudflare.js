// -----------------------------------------------------------------------------
// A fake `fetch` standing in for the Cloudflare API and for cloudflared
// metrics servers: tests never touch the network.
//
//   const net = fakeNetwork();
//   net.tunnels = [tunnel({ id: 'aaa', name: 'home', status: 'healthy' })];
//   net.connectors['http://10.0.0.2:2000'] = { readyConnections: 4, connectorId: 'c1' };
//   createMonitor(gladys, { fetch: net.fetch, ... });
// -----------------------------------------------------------------------------

import { API_BASE_URL } from '../../src/cloudflare/api.js';

export const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
export const API_TOKEN = 'test-token-not-a-secret';

/** A tunnel as the API lists it. `connectors`: connector id -> number of connections. */
export function tunnel({ id, name = id, status = 'healthy', connectors = {} }) {
  return { id, name, status, connectors };
}

export function fakeNetwork() {
  const net = {
    tunnels: [],
    // url -> { readyConnections, connectorId, status? } | 'down' | 'garbage'
    connectors: {},
    // When set: { status, body } answered to every API request.
    apiFailure: null,
    // When true, API requests throw like an unreachable host.
    apiOffline: false,
    pageSize: null,
    requests: [],

    async fetch(url, options = {}) {
      net.requests.push({ url, headers: options.headers ?? {} });
      if (url.startsWith(API_BASE_URL)) {
        return net.api(url, options);
      }
      return net.local(url);
    },

    api(url, options) {
      if (net.apiOffline) {
        throw new TypeError('fetch failed');
      }
      if (options.headers?.Authorization !== `Bearer ${API_TOKEN}`) {
        return json(403, {
          success: false,
          errors: [{ code: 10000, message: 'Authentication error' }],
        });
      }
      if (net.apiFailure) {
        return json(net.apiFailure.status, net.apiFailure.body);
      }
      const { pathname, searchParams } = new URL(url);
      const prefix = `/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel`;
      if (!pathname.startsWith(prefix)) {
        return json(400, {
          success: false,
          errors: [{ code: 7003, message: 'Could not route to /accounts/x/cfd_tunnel' }],
        });
      }
      const rest = pathname.slice(prefix.length);
      if (rest === '') {
        const perPage = net.pageSize ?? Number(searchParams.get('per_page'));
        const page = Number(searchParams.get('page'));
        const slice = net.tunnels.slice((page - 1) * perPage, page * perPage);
        return json(200, {
          success: true,
          errors: [],
          result: slice.map(({ id, name, status }) => ({
            id,
            name,
            status,
            tun_type: 'cfd_tunnel',
            // Deprecated, and empty as Cloudflare announced it will be.
            connections: [],
          })),
          result_info: {
            page,
            per_page: perPage,
            count: slice.length,
            total_count: net.tunnels.length,
          },
        });
      }
      const match = /^\/([^/]+)\/connections$/.exec(rest);
      const found = match && net.tunnels.find((candidate) => candidate.id === match[1]);
      if (!found) {
        return json(404, { success: false, errors: [{ code: 1003, message: 'Not found' }] });
      }
      return json(200, {
        success: true,
        errors: [],
        result: Object.entries(found.connectors).map(([connectorId, count]) => ({
          id: connectorId,
          version: '2026.9.0',
          conns: Array.from({ length: count }, (_, index) => ({
            id: `${connectorId}-${index}`,
            client_id: connectorId,
            colo_name: index % 2 ? 'CDG' : 'MRS',
            is_pending_reconnect: false,
          })),
        })),
      });
    },

    local(url) {
      const base = url.replace(/\/ready$/, '');
      const connector = net.connectors[base];
      if (!connector || connector === 'down') {
        throw new TypeError('fetch failed');
      }
      if (connector === 'garbage') {
        return { status: 200, ok: true, json: async () => JSON.parse('<html>') };
      }
      const ready = connector.readyConnections > 0;
      const status = connector.status ?? (ready ? 200 : 503);
      return json(status, {
        status,
        readyConnections: connector.readyConnections,
        connectorId: connector.connectorId,
      });
    },
  };
  return net;
}

function json(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}
