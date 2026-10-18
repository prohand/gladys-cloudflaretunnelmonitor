// -----------------------------------------------------------------------------
// The monitor: one check of every source at the configured interval.
//
// A check reads the local connectors and lists the tunnels through the API
// (each when configured), combines them (src/cloudflare/status.js), then
// tells Gladys what changed — and only that:
//   - the devices, when a tunnel or a connector appears or is renamed;
//   - the feature states, through publishChangedStates (an unchanged value is
//     re-sent every 30 minutes only, to stay recently dated in Gladys);
//   - the transport badges and the connection status, when they change;
//   - one scene event per status transition, compared with the status seen
//     before — across restarts too (src/store.js);
//   - a widget refresh nudge, when the summary it shows changed.
//
// Gladys' own device polling is not used: one API call answers for every
// tunnel, where polling would make one per device and per minute.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { listTunnels, describeApiError } from './cloudflare/api.js';
import { readConnector, CONNECTOR_STATUSES } from './cloudflare/local.js';
import { resolveTunnelView, isOnline, TUNNEL_STATUSES } from './cloudflare/status.js';
import { normalizeConfig } from './config.js';
import { buildTunnelDevice, tunnelIds, tunnelStates } from './devices/tunnel.js';
import { buildConnectorDevice, connectorIds, connectorStates } from './devices/connector.js';
import { emptyState } from './store.js';

const logger = createLogger({ name: 'monitor' });

/** Scene trigger keys, as declared in the manifest `scene_triggers` field. */
export const SCENE_TRIGGERS = {
  TUNNEL_STATUS_CHANGED: 'tunnel_status_changed',
  CONNECTOR_STATUS_CHANGED: 'connector_status_changed',
  CLOUDFLARE_API_ERROR: 'cloudflare_api_error',
};

const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

/** An empty snapshot: what the widget and the scene actions see before any check. */
export function emptySnapshot() {
  return { checkedAt: null, apiError: null, tunnels: [], connectors: [] };
}

/**
 * Count the tunnels per status.
 * @param {{tunnels: Array<{status: string}>}} snapshot
 */
export function summarize(snapshot) {
  const counts = { total: snapshot.tunnels.length, healthy: 0, degraded: 0, down: 0, inactive: 0 };
  counts.unknown = 0;
  for (const tunnel of snapshot.tunnels) {
    counts[tunnel.status] = (counts[tunnel.status] ?? 0) + 1;
  }
  counts.unhealthy = counts.total - counts.healthy;
  counts.connectorsReady = snapshot.connectors.filter(
    (connector) => connector.status === CONNECTOR_STATUSES.READY,
  ).length;
  counts.connectors = snapshot.connectors.length;
  return counts;
}

/**
 * @param {object} gladys the SDK client
 * @param {object} options
 * @param {{load: Function, save: Function}} options.store see src/store.js
 * @param {typeof fetch} [options.fetch] injected by the tests
 * @param {(gladys: object) => void} [options.onSummaryChanged] widget nudge
 */
export function createMonitor(gladys, { store, fetch: doFetch = fetch, onSummaryChanged } = {}) {
  let config = normalizeConfig();
  let memory = null;
  let snapshot = emptySnapshot();
  let inFlight = null;
  let inFlightConfig = null;
  let timer = null;
  let running = false;
  // What Gladys last received, to send only what changed.
  let published = { devices: null, transports: null, connection: null, summary: null };

  async function loadMemory() {
    if (!memory) {
      memory = store ? await store.load() : emptyState();
    }
    return memory;
  }

  async function check() {
    const mem = await loadMemory();
    const validConnectors = config.connectors.filter((connector) => !connector.invalid);

    const [readings, cloud] = await Promise.all([
      Promise.all(
        validConnectors.map(async (connector) => ({
          ...connector,
          ...(await readConnector(connector, { fetch: doFetch })),
        })),
      ),
      config.cloudConfigured
        ? listTunnels(config, { fetch: doFetch }).then(
            (tunnels) => ({ tunnels }),
            (error) => ({ error }),
          )
        : Promise.resolve(null),
    ]);

    if (cloud?.error) {
      logger.warn(`Cloudflare API: ${cloud.error.message}`);
    }
    const cloudTunnels = cloud?.tunnels ?? null;

    // Which tunnel each connector serves. Matched on the connector id the API
    // lists for each connection; remembered by address, so a connector that
    // stops answering is still known to belong to its tunnel.
    for (const reading of readings) {
      const remembered = mem.connectors[reading.id] ?? {};
      let { tunnelId = null } = remembered;
      if (cloudTunnels && reading.connectorId) {
        const owner = cloudTunnels.find((tunnel) =>
          tunnel.connectorIds.includes(reading.connectorId),
        );
        if (owner) {
          tunnelId = owner.id;
        } else if (reading.status === CONNECTOR_STATUSES.READY) {
          // Connected, yet not a connector of any tunnel listed: it serves a
          // tunnel of another account. Not this one's local view.
          tunnelId = null;
        }
      }
      reading.tunnelId = tunnelId;
      reading.transport =
        reading.status === CONNECTOR_STATUSES.UNREACHABLE
          ? DEVICE_TRANSPORTS.UNREACHABLE
          : DEVICE_TRANSPORTS.LOCAL;
    }

    // The tunnels to show: the listed ones, or — the API failing — the ones
    // known from the previous checks, so their devices do not vanish.
    let known;
    if (cloudTunnels) {
      known = cloudTunnels;
    } else if (config.cloudConfigured) {
      known = Object.entries(mem.tunnels).map(([id, { name }]) => ({ id, name }));
    } else {
      known = [];
    }

    const tunnels = known.map((tunnel) => {
      const view = resolveTunnelView({
        cloud: cloudTunnels ? tunnel : null,
        locals: readings.filter((reading) => reading.tunnelId === tunnel.id),
        preferLocal: config.GLADYS_PREFER_LOCAL,
        cloudConfigured: config.cloudConfigured,
      });
      return {
        id: tunnel.id,
        name: tunnel.name,
        colos: tunnel.colos ?? [],
        ...view,
        online: isOnline(view.status),
      };
    });

    return {
      checkedAt: new Date(),
      apiError: cloud?.error
        ? { kind: cloud.error.kind, message: describeApiError(cloud.error) }
        : null,
      tunnels,
      connectors: readings,
    };
  }

  async function fireSceneEvents(next) {
    const mem = await loadMemory();
    const events = [];

    for (const tunnel of next.tunnels) {
      const previous = mem.tunnels[tunnel.id]?.status;
      if (tunnel.status !== TUNNEL_STATUSES.UNKNOWN) {
        if (previous && previous !== tunnel.status) {
          events.push([
            SCENE_TRIGGERS.TUNNEL_STATUS_CHANGED,
            {
              device: tunnelIds(gladys, tunnel.id).device,
              status: tunnel.status,
              previous_status: previous,
              tunnel_name: tunnel.name,
              connections: tunnel.connections,
            },
          ]);
        }
        mem.tunnels[tunnel.id] = { name: tunnel.name, status: tunnel.status };
      } else {
        mem.tunnels[tunnel.id] = { name: tunnel.name, status: previous ?? null };
      }
    }
    // Deleted tunnels (or a token removed): forgotten, they are no longer shown.
    const shown = new Set(next.tunnels.map((tunnel) => tunnel.id));
    for (const id of Object.keys(mem.tunnels)) {
      if (!shown.has(id)) {
        delete mem.tunnels[id];
      }
    }

    const connectorMemory = {};
    for (const connector of next.connectors) {
      const previous = mem.connectors[connector.id]?.status;
      if (previous && previous !== connector.status) {
        events.push([
          SCENE_TRIGGERS.CONNECTOR_STATUS_CHANGED,
          {
            device: connectorIds(gladys, connector.id).device,
            status: connector.status,
            previous_status: previous,
            connector: connector.label,
            ready_connections: connector.readyConnections,
          },
        ]);
      }
      connectorMemory[connector.id] = { status: connector.status, tunnelId: connector.tunnelId };
    }
    mem.connectors = connectorMemory;

    if (config.cloudConfigured) {
      // Fired on the transition only: a token that stays wrong is said once,
      // not at every check — and not again after a restart.
      if (next.apiError && mem.apiOk !== false) {
        events.push([
          SCENE_TRIGGERS.CLOUDFLARE_API_ERROR,
          { reason: next.apiError.kind, message: next.apiError.message.en },
        ]);
      }
      mem.apiOk = !next.apiError;
    } else {
      mem.apiOk = null;
    }

    for (const [key, data] of events) {
      logger.info(`Scene event ${key}: ${JSON.stringify(data)}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.error(`Scene event ${key} refused`, err);
      }
    }
    if (store) {
      await store.save(mem);
    }
  }

  function buildDevices(state = snapshot) {
    return [
      ...state.tunnels.map((tunnel) => buildTunnelDevice(gladys, tunnel)),
      ...state.connectors.map((connector) => buildConnectorDevice(gladys, connector)),
    ];
  }

  function connectionStatusOf(state) {
    if (config.problems.length > 0) {
      return { connected: false, message: config.problems[0] };
    }
    if (!config.cloudConfigured && !config.localConfigured) {
      return {
        connected: false,
        message: {
          en: 'Enter a Cloudflare API token and account ID, or the address of a local cloudflared connector.',
          fr: "Renseignez un jeton d'API Cloudflare et l'ID de compte, ou l'adresse d'un connecteur cloudflared local.",
          de: 'Gib ein Cloudflare-API-Token und die Konto-ID oder die Adresse eines lokalen cloudflared-Connectors ein.',
          es: 'Introduzca un token de API de Cloudflare y el ID de cuenta, o la dirección de un conector cloudflared local.',
        },
      };
    }
    if (state.apiError) {
      return { connected: false, message: state.apiError.message };
    }
    const answering = state.connectors.filter(
      (connector) => connector.status !== CONNECTOR_STATUSES.UNREACHABLE,
    );
    if (!config.cloudConfigured && answering.length === 0) {
      return {
        connected: false,
        message: {
          en: 'No local cloudflared connector answers: check its --metrics address and port.',
          fr: 'Aucun connecteur cloudflared local ne répond : vérifiez son adresse et son port --metrics.',
          de: 'Kein lokaler cloudflared-Connector antwortet: prüfe seine --metrics-Adresse und seinen Port.',
          es: 'Ningún conector cloudflared local responde: compruebe su dirección y puerto --metrics.',
        },
      };
    }
    return { connected: true };
  }

  // Gladys drops the states of a device the user has not created yet; the SDK
  // forgets them when the device is created, so the next call sends them.
  async function publishStates(state) {
    const states = [
      ...state.tunnels
        .filter((tunnel) => tunnel.status !== TUNNEL_STATUSES.UNKNOWN)
        .flatMap((tunnel) => tunnelStates(gladys, tunnel, tunnel)),
      ...state.connectors.flatMap((connector) => connectorStates(gladys, connector, connector)),
    ];
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  }

  async function publish(state, { force = false } = {}) {
    const devices = buildDevices(state);
    const devicesKey = JSON.stringify(devices);
    if (devices.length > 0 && (force || devicesKey !== published.devices)) {
      await gladys.publishDiscoveredDevices(devices);
      published.devices = devicesKey;
    }

    try {
      await publishStates(state);
    } catch (err) {
      // A refused batch (429) is sent again by the next check, which
      // publishChangedStates remembers: it must not hold back the badges and
      // the connection status below.
      logger.error('Publishing the states failed', err);
    }

    const transports = [
      ...state.tunnels.map((tunnel) => transportEntry(tunnelIds(gladys, tunnel.id).device, tunnel)),
      ...state.connectors.map((connector) =>
        transportEntry(connectorIds(gladys, connector.id).device, connector),
      ),
    ];
    const transportsKey = JSON.stringify(transports);
    if (transports.length > 0 && (force || transportsKey !== published.transports)) {
      await gladys.publishTransports(transports);
      published.transports = transportsKey;
    }

    const connection = connectionStatusOf(state);
    const connectionKey = JSON.stringify(connection);
    if (force || connectionKey !== published.connection) {
      await gladys.setConnectionStatus(connection.connected, connection.message);
      published.connection = connectionKey;
    }

    const summaryKey = JSON.stringify([
      state.apiError?.kind ?? null,
      state.tunnels.map(({ id, name, status, connections }) => [id, name, status, connections]),
      state.connectors.map(({ id, status, readyConnections }) => [id, status, readyConnections]),
    ]);
    if (summaryKey !== published.summary) {
      published.summary = summaryKey;
      onSummaryChanged?.(gladys);
    }
  }

  async function refresh() {
    // Two refreshes asked at once (the timer and a scene action) share one
    // check: the API is not called twice for the same answer. Unless the
    // configuration changed meanwhile: the running check answers for the old
    // token, so a new one follows it.
    if (inFlight && inFlightConfig !== config) {
      await inFlight.catch(() => {});
    }
    if (!inFlight) {
      inFlightConfig = config;
      inFlight = (async () => {
        const next = await check();
        snapshot = next;
        await fireSceneEvents(next);
        try {
          await publish(next);
        } catch (err) {
          // Disconnected from Gladys, most likely: the next check, or the
          // reconnection (publishAll), sends it again.
          logger.error('Publishing to Gladys failed', err);
        }
        return next;
      })().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function schedule() {
    clearTimeout(timer);
    if (!running) {
      return;
    }
    timer = setTimeout(async () => {
      try {
        await refresh();
      } catch (err) {
        logger.error('Check failed', err);
      }
      schedule();
    }, config.poll_frequency * 1000);
  }

  return {
    get snapshot() {
      return snapshot;
    },

    get config() {
      return config;
    },

    setConfig(next) {
      config = next;
    },

    refresh,

    /** Check now, then every `poll_frequency` seconds. */
    async start() {
      running = true;
      clearTimeout(timer);
      try {
        await refresh();
      } finally {
        schedule();
      }
    },

    stop() {
      running = false;
      clearTimeout(timer);
      timer = null;
    },

    /**
     * Send everything again, changed or not: after a (re)connection Gladys
     * may have missed what was published while the socket was down.
     */
    async publishAll() {
      await publish(snapshot, { force: true });
    },

    /** The states of the last check that Gladys has not received yet. */
    async publishStates() {
      await publishStates(snapshot);
    },

    /** The devices of the last check, for an `onScanRequest`. */
    buildDevices: () => buildDevices(snapshot),
  };
}

function transportEntry(externalId, view) {
  const entry = { external_id: externalId, transport: view.transport };
  if (view.degraded) {
    entry.degraded = true;
    entry.message = view.message;
  }
  return entry;
}
