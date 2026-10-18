import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { createMonitor, SCENE_TRIGGERS, summarize } from '../src/monitor.js';
import { createStore } from '../src/store.js';
import { tunnelIds } from '../src/devices/tunnel.js';
import { connectorIds } from '../src/devices/connector.js';
import { ACCOUNT_ID, API_TOKEN, fakeNetwork, tunnel } from './helpers/fakeCloudflare.js';

const LOCAL = 'http://10.0.0.2:2000';

async function setup({ local = false, preferLocal = true, dir } = {}) {
  const gladys = createFakeGladys();
  const net = fakeNetwork();
  const storeDir = dir ?? (await mkdtemp(join(tmpdir(), 'cftm-')));
  const nudges = [];
  const monitor = createMonitor(gladys, {
    fetch: net.fetch,
    store: createStore(storeDir),
    onSummaryChanged: () => nudges.push(Date.now()),
  });
  monitor.setConfig(
    normalizeConfig({
      api_token: API_TOKEN,
      account_id: ACCOUNT_ID,
      local_connectors: local ? LOCAL : '',
      GLADYS_PREFER_LOCAL: preferLocal,
    }),
  );
  return { gladys, net, monitor, storeDir, nudges };
}

const stateOf = (gladys, externalId) => gladys.fake.lastState(externalId);
// The transport entries of the last publishTransports call.
const lastTransports = (gladys) =>
  gladys.fake.bodies('POST', '/device/transport').at(-1).transports;

test('a check publishes one device per tunnel, accepted by Gladys, with its states', async () => {
  const { gladys, net, monitor } = await setup();
  net.tunnels = [
    tunnel({ id: 't1', name: 'home', status: 'healthy', connectors: { c1: 4 } }),
    tunnel({ id: 't2', name: 'lab', status: 'down' }),
  ];
  await monitor.refresh();

  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const home = tunnelIds(gladys, 't1');
  assert.equal(stateOf(gladys, home.feature('status')), 'healthy');
  assert.equal(stateOf(gladys, home.feature('online')), 1);
  assert.equal(stateOf(gladys, home.feature('connections')), 4);
  assert.equal(stateOf(gladys, tunnelIds(gladys, 't2').feature('online')), 0);
  assert.deepEqual(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(
    lastTransports(gladys).map((entry) => entry.transport),
    ['cloud', 'cloud'],
  );
});

test('the devices are published again only when they change', async () => {
  const { gladys, net, monitor } = await setup();
  net.tunnels = [tunnel({ id: 't1', name: 'home' })];
  await monitor.refresh();
  await monitor.refresh();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, 1);

  net.tunnels[0].name = 'home-renamed';
  await monitor.refresh();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, 2);
});

test('a status change fires tunnel_status_changed once, with the declared data', async () => {
  const { gladys, net, monitor } = await setup();
  net.tunnels = [tunnel({ id: 't1', name: 'home', status: 'healthy', connectors: { c1: 4 } })];
  await monitor.refresh();
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first observation is a baseline');

  net.tunnels[0] = tunnel({ id: 't1', name: 'home', status: 'down' });
  await monitor.refresh();
  await monitor.refresh();
  assert.equal(gladys.fake.sceneEvents.length, 1, 'one event per transition');
  assert.deepEqual(gladys.fake.sceneEvents[0], {
    key: SCENE_TRIGGERS.TUNNEL_STATUS_CHANGED,
    data: {
      device: tunnelIds(gladys, 't1').device,
      status: 'down',
      previous_status: 'healthy',
      tunnel_name: 'home',
      connections: 0,
    },
  });
});

test('a change that happened while the integration was stopped still fires', async () => {
  const first = await setup();
  first.net.tunnels = [tunnel({ id: 't1', status: 'healthy', connectors: { c1: 4 } })];
  await first.monitor.refresh();

  // Restart: a new monitor, the same /data.
  const second = await setup({ dir: first.storeDir });
  second.net.tunnels = [tunnel({ id: 't1', status: 'down' })];
  await second.monitor.refresh();
  assert.equal(second.gladys.fake.sceneEvents.length, 1);
  assert.equal(second.gladys.fake.sceneEvents[0].data.previous_status, 'healthy');
});

test('an unreadable memory file is ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cftm-'));
  await writeFile(join(dir, 'state.json'), '{not json');
  const { net, monitor, gladys } = await setup({ dir });
  net.tunnels = [tunnel({ id: 't1' })];
  await monitor.refresh();
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.equal(saved.tunnels.t1.status, 'healthy');
});

test('an API failure fires cloudflare_api_error once, keeps the devices, and is reported', async () => {
  const { gladys, net, monitor } = await setup();
  net.tunnels = [tunnel({ id: 't1', name: 'home', status: 'healthy', connectors: { c1: 4 } })];
  await monitor.refresh();

  net.apiOffline = true;
  await monitor.refresh();
  await monitor.refresh();
  const errors = gladys.fake.sceneEvents.filter(
    (event) => event.key === SCENE_TRIGGERS.CLOUDFLARE_API_ERROR,
  );
  assert.equal(errors.length, 1, 'said once, not at every check');
  assert.equal(errors[0].data.reason, 'network');
  assert.equal(monitor.snapshot.tunnels.length, 1, 'the known tunnel stays');
  assert.equal(monitor.snapshot.tunnels[0].status, 'unknown');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(lastTransports(gladys)[0].transport, 'unreachable');
  assert.ok(
    !gladys.fake.sceneEvents.some((event) => event.key === SCENE_TRIGGERS.TUNNEL_STATUS_CHANGED),
    'unknown is not a status change',
  );

  net.apiOffline = false;
  await monitor.refresh();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.sceneEvents.filter((event) => event.key === SCENE_TRIGGERS.TUNNEL_STATUS_CHANGED)
      .length,
    0,
    'back to the status it had: nothing changed',
  );
});

test('a local connector becomes a device, is matched with its tunnel, and wins when preferred', async () => {
  const { gladys, net, monitor } = await setup({ local: true });
  net.tunnels = [
    tunnel({ id: 't1', name: 'home', status: 'healthy', connectors: { c1: 4, c2: 4 } }),
  ];
  net.connectors[LOCAL] = { readyConnections: 4, connectorId: 'c1' };
  await monitor.refresh();

  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const [home] = monitor.snapshot.tunnels;
  assert.equal(home.transport, 'local');
  assert.equal(home.connections, 4, 'the local view: this connector only');
  const connector = connectorIds(gladys, '10-0-0-2-2000');
  assert.equal(stateOf(gladys, connector.feature('ready')), 1);
  assert.equal(stateOf(gladys, connector.feature('connections')), 4);
});

test('a preferred local connector that stops answering: the cloud, degraded, and an event', async () => {
  const { gladys, net, monitor } = await setup({ local: true });
  net.tunnels = [tunnel({ id: 't1', name: 'home', status: 'healthy', connectors: { c1: 4 } })];
  net.connectors[LOCAL] = { readyConnections: 4, connectorId: 'c1' };
  await monitor.refresh();

  net.connectors[LOCAL] = 'down';
  net.tunnels[0] = tunnel({ id: 't1', name: 'home', status: 'down' });
  await monitor.refresh();

  const [entry] = lastTransports(gladys);
  assert.equal(entry.transport, 'cloud');
  assert.equal(entry.degraded, true, 'the remembered connector explains the fallback');
  const keys = gladys.fake.sceneEvents.map((event) => event.key).sort();
  assert.deepEqual(keys, [
    SCENE_TRIGGERS.CONNECTOR_STATUS_CHANGED,
    SCENE_TRIGGERS.TUNNEL_STATUS_CHANGED,
  ]);
  const connectorEvent = gladys.fake.sceneEvents.find(
    (event) => event.key === SCENE_TRIGGERS.CONNECTOR_STATUS_CHANGED,
  );
  assert.deepEqual(connectorEvent.data, {
    device: connectorIds(gladys, '10-0-0-2-2000').device,
    status: 'unreachable',
    previous_status: 'ready',
    connector: '10.0.0.2:2000',
    ready_connections: 0,
  });
});

test('local only, no token: the connector is monitored on its own', async () => {
  const gladys = createFakeGladys();
  const net = fakeNetwork();
  const monitor = createMonitor(gladys, { fetch: net.fetch });
  monitor.setConfig(normalizeConfig({ local_connectors: LOCAL }));
  net.connectors[LOCAL] = { readyConnections: 2, connectorId: 'c9' };
  await monitor.refresh();
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(!net.requests.some((request) => request.url.includes('cloudflare.com')));

  net.connectors[LOCAL] = 'down';
  await monitor.refresh();
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('nothing configured: no device, and the status says what to fill in', async () => {
  const gladys = createFakeGladys();
  const monitor = createMonitor(gladys, { fetch: fakeNetwork().fetch });
  await monitor.refresh();
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /API token/);
});

test('two refreshes asked at once share one check', async () => {
  const { net, monitor } = await setup();
  net.tunnels = [tunnel({ id: 't1', status: 'inactive' })];
  await Promise.all([monitor.refresh(), monitor.refresh()]);
  assert.equal(net.requests.length, 1);
});

test('the widget is nudged when what it shows changed, not at every check', async () => {
  const { net, monitor, nudges } = await setup();
  net.tunnels = [tunnel({ id: 't1', status: 'healthy', connectors: { c1: 4 } })];
  await monitor.refresh();
  await monitor.refresh();
  assert.equal(nudges.length, 1);
  net.tunnels[0].status = 'degraded';
  await monitor.refresh();
  assert.equal(nudges.length, 2);
});

test('start checks at once, then at the configured interval; stop stops', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { net, monitor } = await setup();
  net.tunnels = [tunnel({ id: 't1', status: 'inactive' })];
  await monitor.start();
  assert.equal(net.requests.length, 1);
  t.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(net.requests.length, 2);
  monitor.stop();
  t.mock.timers.tick(120_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(net.requests.length, 2);
});

test('summarize counts the tunnels per status', () => {
  const counts = summarize({
    tunnels: [{ status: 'healthy' }, { status: 'down' }, { status: 'degraded' }],
    connectors: [{ status: 'ready' }, { status: 'unreachable' }],
  });
  assert.equal(counts.total, 3);
  assert.equal(counts.healthy, 1);
  assert.equal(counts.unhealthy, 2);
  assert.equal(counts.connectorsReady, 1);
  assert.equal(counts.connectors, 2);
});

test('a refresh asked after a config change does not reuse the check of the old one', async () => {
  const { net, monitor } = await setup();
  net.tunnels = [tunnel({ id: 't1', status: 'inactive' })];
  const old = monitor.refresh();
  monitor.setConfig(normalizeConfig({ api_token: 'wrong', account_id: ACCOUNT_ID }));
  const fresh = await monitor.refresh();
  await old;
  assert.equal(fresh.apiError.kind, 'auth', 'the new token was used');
});

test('a refused state batch does not hold back the badges and the connection status', async (t) => {
  const { gladys, net, monitor } = await setup();
  net.tunnels = [tunnel({ id: 't1', status: 'healthy', connectors: { c1: 4 } })];
  t.mock.method(gladys, 'publishChangedStates', async () => {
    throw new Error('429 Too Many Requests');
  });
  await monitor.refresh();
  assert.equal(lastTransports(gladys).length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('publishStates sends the states the SDK forgot, after a device creation', async () => {
  const { gladys, net, monitor } = await setup();
  net.tunnels = [tunnel({ id: 't1', status: 'healthy', connectors: { c1: 4 } })];
  await monitor.refresh();
  const before = gladys.fake.states.length;
  gladys.forgetPublishedStates();
  await monitor.publishStates();
  assert.equal(gladys.fake.states.length, before + 3);
});
