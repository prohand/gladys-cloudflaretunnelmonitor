// -----------------------------------------------------------------------------
// Device type: LOCAL CLOUDFLARED CONNECTOR
//
// One Gladys device per metrics address typed in the configuration, keyed on
// that address: the connector id cloudflared reports changes at every restart
// of the process, the address does not.
//
// It is what a user without an API token monitors, and what still answers when
// the Internet link is down.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { CONNECTOR_STATUSES } from '../cloudflare/local.js';

export const CONNECTOR_DEVICE_TYPE = 'connector';

/** Feature keys: stored by Gladys in the external ids, never renamed. */
export const CONNECTOR_FEATURES = {
  READY: 'ready',
  CONNECTIONS: 'connections',
};

// `--ha-connections` defaults to 4; the ceiling only bounds the chart axis.
const MAX_CONNECTIONS = 16;

export function connectorIds(gladys, connectorId) {
  return gladys.externalIds(CONNECTOR_DEVICE_TYPE, connectorId);
}

/**
 * The discovery payload of one local connector.
 * @param {{id: string, label: string}} connector a valid entry of config.connectors
 */
export function buildConnectorDevice(gladys, connector) {
  const ids = connectorIds(gladys, connector.id);
  return {
    name: `cloudflared ${connector.label}`,
    external_id: ids.device,
    features: [
      {
        name: 'Ready',
        external_id: ids.feature(CONNECTOR_FEATURES.READY),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 1,
      },
      {
        name: 'Ready connections',
        external_id: ids.feature(CONNECTOR_FEATURES.CONNECTIONS),
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
 * The states of one connector, in the `publishStates` format.
 * @param {{id: string}} connector
 * @param {{status: string, readyConnections: number}} reading
 */
export function connectorStates(gladys, connector, reading) {
  const ids = connectorIds(gladys, connector.id);
  return [
    {
      device_feature_external_id: ids.feature(CONNECTOR_FEATURES.READY),
      state: reading.status === CONNECTOR_STATUSES.READY ? 1 : 0,
    },
    {
      device_feature_external_id: ids.feature(CONNECTOR_FEATURES.CONNECTIONS),
      state: reading.readyConnections,
    },
  ];
}
