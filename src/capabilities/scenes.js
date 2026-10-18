// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// Declared in the manifest `scene_actions` field, registered by index.js with
// `gladys.onSceneAction(key, ...)`. The handler receives the RESOLVED fields
// and returns the declared scalar `outputs`, readable by the following actions
// of the scene.
//
// A scene action is never a condition: an unknown device or a failed check is
// an output (`status: "unknown"`, `online: false`) for the scene author to
// gate on, not an exception.
//
// The scene TRIGGERS are fired by the monitor, on each status transition (see
// SCENE_TRIGGERS in src/monitor.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CONNECTOR_STATUSES } from '../cloudflare/local.js';
import { TUNNEL_STATUSES } from '../cloudflare/status.js';
import { connectorIds } from '../devices/connector.js';
import { tunnelIds } from '../devices/tunnel.js';
import { summarize } from '../monitor.js';

const logger = createLogger({ name: 'scenes' });

/** Scene action keys, as declared in the manifest. Stored by scenes: never renamed. */
export const SCENE_ACTION_KEYS = {
  CHECK_TUNNELS: 'check_tunnels',
  GET_TUNNEL_STATUS: 'get_tunnel_status',
};

/**
 * The status of one device of this integration (a tunnel or a connector) in
 * the last check.
 *
 * @returns {{name: string, status: string, online: boolean, connections: number}}
 */
export function deviceStatus(gladys, snapshot, externalId) {
  const tunnel = snapshot.tunnels.find(
    (candidate) => tunnelIds(gladys, candidate.id).device === externalId,
  );
  if (tunnel) {
    return {
      name: tunnel.name,
      status: tunnel.status,
      online: tunnel.online,
      connections: tunnel.connections,
    };
  }
  const connector = snapshot.connectors.find(
    (candidate) => connectorIds(gladys, candidate.id).device === externalId,
  );
  if (connector) {
    return {
      name: connector.label,
      status: connector.status,
      online: connector.status === CONNECTOR_STATUSES.READY,
      connections: connector.readyConnections,
    };
  }
  return { name: '', status: TUNNEL_STATUSES.UNKNOWN, online: false, connections: 0 };
}

export const SCENE_ACTIONS = {
  // "Check the tunnels now": a fresh check, then the counts. Lets a scene
  // started by something else (an alarm, a schedule) act on up-to-date data.
  async [SCENE_ACTION_KEYS.CHECK_TUNNELS](gladys, { monitor }) {
    logger.info('Scene action check_tunnels');
    const snapshot = await monitor.refresh();
    const counts = summarize(snapshot);
    return {
      total: counts.total,
      healthy: counts.healthy,
      unhealthy: counts.unhealthy,
      all_healthy: counts.total > 0 && counts.unhealthy === 0,
    };
  },

  // "Read a tunnel's status": the last check's view of one device, without
  // calling the API (a check runs at the configured interval anyway).
  async [SCENE_ACTION_KEYS.GET_TUNNEL_STATUS](gladys, { fields, monitor }) {
    logger.info(`Scene action get_tunnel_status <- ${fields.device}`);
    const snapshot = monitor.snapshot.checkedAt ? monitor.snapshot : await monitor.refresh();
    const { name, status, online, connections } = deviceStatus(gladys, snapshot, fields.device);
    return { name, status, online, connections };
  },
};
