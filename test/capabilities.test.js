import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { createMonitor, emptySnapshot } from '../src/monitor.js';
import { SCENE_ACTIONS, SCENE_ACTION_KEYS } from '../src/capabilities/scenes.js';
import {
  TUNNELS_WIDGET,
  WIDGETS,
  WIDGET_ACTIONS,
  buildWidgetContent,
  refreshWidgets,
  summaryMessage,
} from '../src/capabilities/widget.js';
import { testConnection } from '../src/connection.js';
import { tunnelIds } from '../src/devices/tunnel.js';
import { connectorIds } from '../src/devices/connector.js';
import { LANGUAGES } from '../src/i18n.js';
import { ACCOUNT_ID, API_TOKEN, fakeNetwork, tunnel } from './helpers/fakeCloudflare.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const LOCAL = 'http://10.0.0.2:2000';
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const declarationOf = (list, key) => manifest[list].find((entry) => entry.key === key);

function setup(raw = { api_token: API_TOKEN, account_id: ACCOUNT_ID, local_connectors: LOCAL }) {
  const gladys = createFakeGladys();
  const net = fakeNetwork();
  const monitor = createMonitor(gladys, { fetch: net.fetch });
  monitor.setConfig(normalizeConfig(raw));
  net.tunnels = [
    tunnel({ id: 't1', name: 'home', status: 'healthy', connectors: { c1: 4 } }),
    tunnel({ id: 't2', name: 'lab', status: 'down' }),
  ];
  net.connectors[LOCAL] = { readyConnections: 4, connectorId: 'c1' };
  return { gladys, net, monitor };
}

test('check_tunnels runs a check and returns the declared outputs', async () => {
  const { gladys, net, monitor } = setup();
  const outputs = await SCENE_ACTIONS[SCENE_ACTION_KEYS.CHECK_TUNNELS](gladys, {
    fields: {},
    monitor,
  });
  assert.deepEqual(outputs, { total: 2, healthy: 1, unhealthy: 1, all_healthy: false });
  assert.ok(net.requests.length > 0, 'a fresh check');
  assert.deepEqual(
    Object.keys(outputs).sort(),
    keysOf(declarationOf('scene_actions', 'check_tunnels').outputs).sort(),
  );
});

test('get_tunnel_status reads a tunnel, a connector, or answers unknown', async () => {
  const { gladys, monitor } = setup();
  const action = SCENE_ACTIONS[SCENE_ACTION_KEYS.GET_TUNNEL_STATUS];
  const declared = keysOf(declarationOf('scene_actions', 'get_tunnel_status').outputs).sort();

  const home = await action(gladys, {
    fields: { device: tunnelIds(gladys, 't1').device },
    monitor,
  });
  assert.deepEqual(home, { name: 'home', status: 'healthy', online: true, connections: 4 });
  assert.deepEqual(Object.keys(home).sort(), declared);

  const connector = await action(gladys, {
    fields: { device: connectorIds(gladys, '10-0-0-2-2000').device },
    monitor,
  });
  assert.deepEqual(connector, {
    name: '10.0.0.2:2000',
    status: 'ready',
    online: true,
    connections: 4,
  });

  // Not a failure: a scene action is never a condition.
  const unknown = await action(gladys, { fields: { device: 'ext:other:x' }, monitor });
  assert.deepEqual(unknown, { name: '', status: 'unknown', online: false, connections: 0 });
});

test('the scene trigger options are the statuses the monitor publishes', () => {
  const options = (key) =>
    declarationOf('scene_triggers', key)
      .fields.find((field) => field.type === 'multi_select')
      .options.map((option) => option.value)
      .sort();
  assert.deepEqual(options('tunnel_status_changed'), ['degraded', 'down', 'healthy', 'inactive']);
  assert.deepEqual(options('connector_status_changed'), ['not_ready', 'ready', 'unreachable']);
  assert.deepEqual(options('cloudflare_api_error'), [
    'account',
    'auth',
    'invalid',
    'network',
    'rate_limit',
    'unavailable',
  ]);
});

test('the scene events carry only keys their trigger declares, as primitives', async () => {
  const { gladys, net, monitor } = setup();
  await monitor.refresh();
  net.tunnels[0] = tunnel({ id: 't1', name: 'home', status: 'down' });
  net.connectors[LOCAL] = 'down';
  await monitor.refresh();
  net.apiOffline = true;
  await monitor.refresh();

  const fired = new Set(gladys.fake.sceneEvents.map((event) => event.key));
  assert.deepEqual([...fired].sort(), keysOf(manifest.scene_triggers).sort(), 'all three fired');
  for (const { key, data } of gladys.fake.sceneEvents) {
    const trigger = declarationOf('scene_triggers', key);
    const declared = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [dataKey, value] of Object.entries(data)) {
      assert.ok(declared.includes(dataKey), `${key}: data.${dataKey} is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${dataKey}`);
    }
  }
});

test('the widget content is rendered exactly as sent, in every situation', async () => {
  const config = normalizeConfig();
  assert.deepEqual(validateWidgetContent(buildWidgetContent(emptySnapshot(), config)), []);

  const { monitor, net } = setup();
  await monitor.refresh();
  assert.deepEqual(validateWidgetContent(buildWidgetContent(monitor.snapshot, config)), []);

  // Many tunnels with long names: rows capped and labels shortened.
  net.tunnels = Array.from({ length: 14 }, (_, index) =>
    tunnel({
      id: `t${index}`,
      name: `tunnel-with-a-very-long-name-number-${index}`,
      status: 'down',
    }),
  );
  await monitor.refresh();
  const many = buildWidgetContent(monitor.snapshot, config);
  assert.deepEqual(validateWidgetContent(many), []);
  const status = many.components.find((component) => component.type === 'status');
  assert.equal(status.items.length, 10);

  net.apiOffline = true;
  await monitor.refresh();
  assert.deepEqual(validateWidgetContent(buildWidgetContent(monitor.snapshot, config)), []);
});

test('the widget lists issues first', async () => {
  const { monitor } = setup();
  await monitor.refresh();
  const content = buildWidgetContent(monitor.snapshot, monitor.config);
  const rows = content.components.find((component) => component.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => row.label),
    ['lab', 'home', '10.0.0.2:2000'],
  );
  assert.equal(rows[0].color, 'danger');
});

test('the widget button runs a check and answers a short toast in every language', async () => {
  const { gladys, monitor, net } = setup();
  const content = await WIDGETS[TUNNELS_WIDGET].get(gladys, { monitor });
  const button = content.components.find((component) => component.type === 'button');
  assert.equal(button.action.key, WIDGET_ACTIONS.CHECK_NOW);

  const toast = await WIDGETS[TUNNELS_WIDGET].action(gladys, {
    actionKey: button.action.key,
    params: {},
    monitor,
  });
  assert.ok(net.requests.length > 0);
  assert.deepEqual(Object.keys(toast).sort(), [...LANGUAGES].sort());
  for (const text of Object.values(toast)) {
    assert.ok(text.length <= 200, 'toasts are capped at 200 characters');
  }
  assert.match(toast.en, /2 tunnel\(s\): 1 healthy, 1 with an issue/);

  await assert.rejects(
    WIDGETS[TUNNELS_WIDGET].action(gladys, { actionKey: 'nope', params: {}, monitor }),
    /Unknown widget action/,
  );
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.keys(WIDGETS));
});

test('summaryMessage gives the API error when nothing is known', () => {
  const message = summaryMessage({
    ...emptySnapshot(),
    apiError: { kind: 'auth', message: { en: 'refused', fr: 'x', de: 'x', es: 'x' } },
  });
  assert.equal(message.en, 'refused');
});

test('Test the connection reports each source', async () => {
  const { monitor, net } = setup();
  const message = await testConnection(monitor);
  assert.match(message.en, /^Cloudflare API: 2 tunnel\(s\)/);
  assert.match(message.en, /10\.0\.0\.2:2000: ready, 4 connection\(s\)/);
  assert.deepEqual(Object.keys(message).sort(), [...LANGUAGES].sort());

  net.apiFailure = { status: 403, body: { success: false, errors: [{ code: 10000 }] } };
  net.connectors[LOCAL] = 'down';
  const failing = await testConnection(monitor);
  assert.match(failing.en, /Cloudflare refused the API token/);
  assert.match(failing.en, /no answer/);
});

test('Test the connection says what to fill in, or what is wrong', async () => {
  assert.match((await testConnection(setup({}).monitor)).en, /Nothing to test yet/);
  const wrong = await testConnection(setup({ api_token: 'x', account_id: 'nope' }).monitor);
  assert.match(wrong.en, /^Configuration: .*32 hexadecimal/);
});
