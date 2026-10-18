import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  MAX_POLL_FREQUENCY,
  MIN_POLL_FREQUENCY,
  normalizeConfig,
  parseLocalConnectors,
} from '../src/config.js';

test('an empty configuration is the defaults, with nothing configured', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.cloudConfigured, false);
  assert.equal(config.localConfigured, false);
  assert.deepEqual(config.problems, []);
  assert.equal(config.GLADYS_PREFER_LOCAL, true);
});

test('the token and the account id are trimmed, the id lowercased', () => {
  const config = normalizeConfig({
    api_token: '  abc \n',
    account_id: ' 0123456789ABCDEF0123456789ABCDEF ',
  });
  assert.equal(config.api_token, 'abc');
  assert.equal(config.account_id, '0123456789abcdef0123456789abcdef');
  assert.equal(config.cloudConfigured, true);
  assert.deepEqual(config.problems, []);
});

test('half a cloud configuration is reported, in every language', () => {
  for (const raw of [{ api_token: 'abc' }, { account_id: '0123456789abcdef0123456789abcdef' }]) {
    const config = normalizeConfig(raw);
    assert.equal(config.cloudConfigured, false);
    assert.equal(config.problems.length, 1);
    assert.deepEqual(Object.keys(config.problems[0]).sort(), ['de', 'en', 'es', 'fr']);
  }
});

test('an account id that is not 32 hexadecimal characters is reported', () => {
  const config = normalizeConfig({ api_token: 'abc', account_id: 'my-account' });
  assert.ok(config.problems.some((problem) => problem.en.includes('32 hexadecimal')));
});

test('the check interval is clamped, and an emptied field falls back to the default', () => {
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, MIN_POLL_FREQUENCY);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, MAX_POLL_FREQUENCY);
  assert.equal(normalizeConfig({ poll_frequency: '120' }).poll_frequency, 120);
  assert.equal(normalizeConfig({ poll_frequency: '' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 60);
});

test('only an explicit false turns the local preference off', () => {
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: false }).GLADYS_PREFER_LOCAL, false);
  assert.equal(normalizeConfig({ GLADYS_PREFER_LOCAL: undefined }).GLADYS_PREFER_LOCAL, true);
});

test('connector addresses are read in every usual spelling, each once', () => {
  const connectors = parseLocalConnectors(
    '192.168.1.10:2000, http://nas.local:2000/ready ;https://10.0.0.5:2443/metrics\nhttp://192.168.1.10:2000/',
  );
  assert.deepEqual(
    connectors.map(({ url, id, label }) => ({ url, id, label })),
    [
      { url: 'http://192.168.1.10:2000', id: '192-168-1-10-2000', label: '192.168.1.10:2000' },
      { url: 'http://nas.local:2000', id: 'nas-local-2000', label: 'nas.local:2000' },
      { url: 'https://10.0.0.5:2443', id: '10-0-0-5-2443', label: '10.0.0.5:2443' },
    ],
  );
});

test('a connector address without a port, or not http, is invalid and reported', () => {
  const config = normalizeConfig({
    local_connectors: 'http://nas.local, ftp://nas:21, http://user:pw@nas:2000, nas:2000',
  });
  assert.deepEqual(
    config.connectors.filter((connector) => connector.invalid).map((connector) => connector.raw),
    ['http://nas.local', 'ftp://nas:21', 'http://user:pw@nas:2000'],
  );
  assert.equal(config.problems.length, 3);
  assert.equal(config.localConfigured, true, 'the valid one still counts');
});
