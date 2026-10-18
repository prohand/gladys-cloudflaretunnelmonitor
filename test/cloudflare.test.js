import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import {
  API_ERRORS,
  CloudflareApiError,
  describeApiError,
  errorFromResponse,
  listTunnels,
  normalizeTunnel,
} from '../src/cloudflare/api.js';
import { CONNECTOR_STATUSES, readConnector } from '../src/cloudflare/local.js';
import { resolveTunnelView, statusFromConnectors } from '../src/cloudflare/status.js';
import { LANGUAGES } from '../src/i18n.js';
import { ACCOUNT_ID, API_TOKEN, fakeNetwork, tunnel } from './helpers/fakeCloudflare.js';

const cloud = { api_token: API_TOKEN, account_id: ACCOUNT_ID };

test('the tunnels are listed with their status and connections, the token sent as Bearer', async () => {
  const net = fakeNetwork();
  net.tunnels = [
    tunnel({ id: 't1', name: 'home', status: 'healthy', connectors: { c1: 4 } }),
    tunnel({ id: 't2', name: 'lab', status: 'inactive' }),
  ];
  const tunnels = await listTunnels(cloud, { fetch: net.fetch });
  assert.deepEqual(tunnels, [
    {
      id: 't1',
      name: 'home',
      status: 'healthy',
      connections: 4,
      connectorIds: ['c1'],
      colos: ['MRS', 'CDG'],
    },
    { id: 't2', name: 'lab', status: 'inactive', connections: 0, connectorIds: [], colos: [] },
  ]);
  assert.ok(
    net.requests.every((request) => request.headers.Authorization === `Bearer ${API_TOKEN}`),
  );
  assert.ok(
    !net.requests.some((request) => request.url.includes('/t2/connections')),
    'an inactive tunnel has no connection to ask for',
  );
});

test('every page of the tunnel list is read', async () => {
  const net = fakeNetwork();
  net.pageSize = 2;
  net.tunnels = Array.from({ length: 5 }, (_, index) =>
    tunnel({ id: `t${index}`, status: 'inactive' }),
  );
  const tunnels = await listTunnels(cloud, { fetch: net.fetch });
  assert.equal(tunnels.length, 5);
});

test('a failed connections request keeps the tunnel and its status', async () => {
  const net = fakeNetwork();
  net.tunnels = [tunnel({ id: 't1', status: 'down' })];
  const original = net.api;
  net.api = (url, options) =>
    url.includes('/connections')
      ? { status: 500, ok: false, json: async () => ({ success: false, errors: [] }) }
      : original(url, options);
  const [only] = await listTunnels(cloud, { fetch: net.fetch });
  assert.equal(only.status, 'down');
  assert.equal(only.connections, 0);
});

test('the API errors are classified', async () => {
  const net = fakeNetwork();
  await assert.rejects(listTunnels({ ...cloud, api_token: 'wrong' }, { fetch: net.fetch }), {
    kind: API_ERRORS.AUTH,
  });
  await assert.rejects(
    listTunnels({ ...cloud, account_id: 'ffffffffffffffffffffffffffffffff' }, { fetch: net.fetch }),
    { kind: API_ERRORS.ACCOUNT },
  );
  net.apiOffline = true;
  await assert.rejects(listTunnels(cloud, { fetch: net.fetch }), { kind: API_ERRORS.NETWORK });
  assert.equal(errorFromResponse(429, null).kind, API_ERRORS.RATE_LIMIT);
  assert.equal(errorFromResponse(502, null).kind, API_ERRORS.UNAVAILABLE);
  assert.equal(errorFromResponse(401, null).kind, API_ERRORS.AUTH);
  assert.equal(errorFromResponse(404, null).kind, API_ERRORS.ACCOUNT);
  assert.equal(errorFromResponse(400, { errors: [{ code: 1 }] }).kind, API_ERRORS.INVALID);
});

test('an error message never carries the token', async () => {
  const net = fakeNetwork();
  net.apiFailure = { status: 400, body: { success: false, errors: [{ code: 1, message: 'bad' }] } };
  await assert.rejects(listTunnels(cloud, { fetch: net.fetch }), (err) => {
    assert.ok(!err.message.includes(API_TOKEN));
    return true;
  });
});

test('every kind of API error is explained in every language', () => {
  for (const kind of [...Object.values(API_ERRORS), 'other']) {
    const message = describeApiError(new CloudflareApiError(kind, 'x'));
    assert.deepEqual(Object.keys(message).sort(), [...LANGUAGES].sort());
  }
});

test('normalizeTunnel drops entries without an id and defaults the rest', () => {
  assert.equal(normalizeTunnel(null), null);
  assert.equal(normalizeTunnel({ name: 'x' }), null);
  assert.deepEqual(normalizeTunnel({ id: 'a', status: 'HEALTHY' }), {
    id: 'a',
    name: 'a',
    status: 'healthy',
    connections: 0,
    connectorIds: [],
    colos: [],
  });
});

test('a local connector is read from its /ready endpoint', async () => {
  const net = fakeNetwork();
  const connector = { url: 'http://10.0.0.2:2000', label: '10.0.0.2:2000' };
  net.connectors[connector.url] = { readyConnections: 4, connectorId: 'c1' };
  assert.deepEqual(await readConnector(connector, { fetch: net.fetch }), {
    status: CONNECTOR_STATUSES.READY,
    readyConnections: 4,
    connectorId: 'c1',
  });

  net.connectors[connector.url] = { readyConnections: 0, connectorId: 'c1' };
  assert.equal((await readConnector(connector, { fetch: net.fetch })).status, 'not_ready');

  net.connectors[connector.url] = 'down';
  assert.equal((await readConnector(connector, { fetch: net.fetch })).status, 'unreachable');

  net.connectors[connector.url] = 'garbage';
  assert.equal((await readConnector(connector, { fetch: net.fetch })).status, 'unreachable');
});

test('a tunnel seen through its connectors only: healthy, degraded, down', () => {
  const ready = { status: 'ready', readyConnections: 4 };
  const lost = { status: 'unreachable', readyConnections: 0 };
  assert.equal(statusFromConnectors([ready, ready]), 'healthy');
  assert.equal(statusFromConnectors([ready, lost]), 'degraded');
  assert.equal(statusFromConnectors([lost]), 'down');
});

test('local preferred and answering: the local view, local badge', () => {
  const view = resolveTunnelView({
    cloud: { status: 'healthy', connections: 8 },
    locals: [{ status: 'ready', readyConnections: 4 }],
    preferLocal: true,
    cloudConfigured: true,
  });
  assert.deepEqual(view, {
    status: 'healthy',
    connections: 4,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('local preferred but unreachable: the cloud view, flagged degraded', () => {
  const view = resolveTunnelView({
    cloud: { status: 'down', connections: 0 },
    locals: [{ status: 'unreachable', readyConnections: 0 }],
    preferLocal: true,
    cloudConfigured: true,
  });
  assert.equal(view.status, 'down');
  assert.equal(view.transport, DEVICE_TRANSPORTS.CLOUD);
  assert.equal(view.degraded, true);
  for (const text of Object.values(view.message)) {
    assert.ok(text.length <= 200, 'transport messages are capped at 200 characters');
  }
});

test('cloud preferred: the cloud view, even with a local connector answering', () => {
  const view = resolveTunnelView({
    cloud: { status: 'degraded', connections: 2 },
    locals: [{ status: 'ready', readyConnections: 4 }],
    preferLocal: false,
    cloudConfigured: true,
  });
  assert.deepEqual(view, { status: 'degraded', connections: 2, transport: 'cloud' });
});

test('API failing: the local connector stands in, flagged degraded', () => {
  const view = resolveTunnelView({
    cloud: null,
    locals: [{ status: 'ready', readyConnections: 3 }],
    preferLocal: false,
    cloudConfigured: true,
  });
  assert.equal(view.transport, 'local');
  assert.equal(view.degraded, true);
  assert.equal(view.status, 'healthy');
});

test('no source answering: unknown, unreachable', () => {
  const view = resolveTunnelView({
    cloud: null,
    locals: [{ status: 'unreachable', readyConnections: 0 }],
    preferLocal: true,
    cloudConfigured: true,
  });
  assert.deepEqual(view, { status: 'unknown', connections: 0, transport: 'unreachable' });
});
