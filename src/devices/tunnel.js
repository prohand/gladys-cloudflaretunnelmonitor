// -----------------------------------------------------------------------------
// Device type: CLOUDFLARE TUNNEL
//
// One Gladys device per tunnel of the account, keyed on the tunnel UUID
// Cloudflare gives it: renaming the tunnel keeps the device, its history and
// the scenes built on it.
//
// Read-only, and not polled by Gladys: the monitor (src/monitor.js) checks all
// tunnels in one API call at the configured interval and publishes the states
// that changed.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const TUNNEL_DEVICE_TYPE = 'tunnel';

/** Feature keys: stored by Gladys in the external ids, never renamed. */
export const TUNNEL_FEATURES = {
  STATUS: 'status',
  ONLINE: 'online',
  CONNECTIONS: 'connections',
};

// cloudflared opens 4 connections by default; a tunnel run by many replicas
// adds 4 per replica. The ceiling only bounds the chart axis.
const MAX_CONNECTIONS = 100;

export function tunnelIds(gladys, tunnelId) {
  return gladys.externalIds(TUNNEL_DEVICE_TYPE, tunnelId);
}

/**
 * The discovery payload of one tunnel.
 * @param {{id: string, name: string}} tunnel
 */
export function buildTunnelDevice(gladys, tunnel) {
  const ids = tunnelIds(gladys, tunnel.id);
  return {
    name: `Cloudflare Tunnel ${tunnel.name}`,
    external_id: ids.device,
    features: [
      {
        // The status as Cloudflare words it (healthy, degraded, down,
        // inactive): a text feature, shown as is on the device card.
        name: 'Status',
        external_id: ids.feature(TUNNEL_FEATURES.STATUS),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 0,
      },
      {
        // 1 while the tunnel carries traffic (healthy or degraded): the
        // feature a "device state" scene trigger or a chart can use.
        name: 'Online',
        external_id: ids.feature(TUNNEL_FEATURES.ONLINE),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 1,
      },
      {
        name: 'Active connections',
        external_id: ids.feature(TUNNEL_FEATURES.CONNECTIONS),
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: MAX_CONNECTIONS,
      },
    ],
  };
}

/**
 * The states of one tunnel, in the `publishStates` format.
 * @param {{id: string}} tunnel
 * @param {{status: string, online: boolean, connections: number}} view
 */
export function tunnelStates(gladys, tunnel, view) {
  const ids = tunnelIds(gladys, tunnel.id);
  return [
    { device_feature_external_id: ids.feature(TUNNEL_FEATURES.STATUS), text: view.status },
    { device_feature_external_id: ids.feature(TUNNEL_FEATURES.ONLINE), state: view.online ? 1 : 0 },
    {
      device_feature_external_id: ids.feature(TUNNEL_FEATURES.CONNECTIONS),
      state: view.connections,
    },
  ];
}
