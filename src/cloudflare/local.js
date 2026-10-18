// -----------------------------------------------------------------------------
// Local source: the metrics server of a cloudflared connector.
//
// Started with `--metrics 0.0.0.0:2000` (or `metrics: 0.0.0.0:2000` in its
// config.yml), cloudflared answers on the LAN:
//
//   GET http://<host>:2000/ready
//   200 {"status":200,"readyConnections":4,"connectorId":"<uuid>"}
//   503 {"status":503,"readyConnections":0,"connectorId":"<uuid>"}
//
// No token, no Internet: this source keeps working when the Internet link is
// what failed — the very moment a tunnel monitor matters most.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'cloudflared' });

const REQUEST_TIMEOUT_MS = 5_000;

/** A connector's state, as its device and the scene trigger name it. */
export const CONNECTOR_STATUSES = {
  READY: 'ready', // at least one connection to the edge
  NOT_READY: 'not_ready', // the process answers, but holds no connection
  UNREACHABLE: 'unreachable', // nothing answers on the metrics address
};

/**
 * Read the `/ready` endpoint of one connector. Never throws: an unreachable
 * connector is a reading too.
 *
 * @param {{url: string, label: string}} connector a valid entry of config.connectors
 * @param {{fetch?: typeof fetch}} [options] `fetch` is injected by the tests
 * @returns {Promise<{status: string, readyConnections: number, connectorId: ?string, error?: string}>}
 */
export async function readConnector(connector, { fetch: doFetch = fetch } = {}) {
  let response;
  try {
    response = await doFetch(`${connector.url}/ready`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    logger.debug(`${connector.label}: no answer (${err.message})`);
    return {
      status: CONNECTOR_STATUSES.UNREACHABLE,
      readyConnections: 0,
      connectorId: null,
      error: err.message,
    };
  }

  let body;
  try {
    body = (await response.json()) ?? {};
  } catch {
    // Something answers that is not cloudflared (another service on the port):
    // it is not a connector, so it cannot be a ready one.
    return {
      status: CONNECTOR_STATUSES.UNREACHABLE,
      readyConnections: 0,
      connectorId: null,
      error: `HTTP ${response.status}, not a cloudflared /ready answer`,
    };
  }

  const readyConnections = Math.max(0, Number(body.readyConnections) || 0);
  const connectorId = typeof body.connectorId === 'string' ? body.connectorId : null;
  // 200 means "ready": cloudflared itself decides it from its connections.
  const status =
    response.status === 200 && readyConnections > 0
      ? CONNECTOR_STATUSES.READY
      : CONNECTOR_STATUSES.NOT_READY;
  logger.debug(`${connector.label}: ${status}, ${readyConnections} connection(s)`);
  return { status, readyConnections, connectorId };
}
