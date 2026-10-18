// -----------------------------------------------------------------------------
// Entry point of the Cloudflare Tunnel Monitor integration.
//
// Role of this file: wire the SDK to the monitor (src/monitor.js). It holds no
// monitoring logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, then starts the monitor.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { createMonitor } from './src/monitor.js';
import { createStore } from './src/store.js';
import { testConnection } from './src/connection.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { WIDGETS, refreshWidgets } from './src/capabilities/widget.js';

const gladys = new GladysIntegration();

const monitor = createMonitor(gladys, {
  store: createStore(),
  onSummaryChanged: refreshWidgets,
});

// --- Discovery: Gladys asks for the list of devices --------------------------
// The devices come from the last check; a scan triggers a fresh one, so a
// tunnel created a minute ago shows up without waiting for the next interval.
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> checking the tunnels');
  await monitor.refresh();
  const devices = monitor.buildDevices();
  if (devices.length > 0) {
    await gladys.publishDiscoveredDevices(devices);
  }
});

// --- A device added from the Discover tab -----------------------------------
// The states published before its creation were dropped by Gladys: send the
// last check's now, rather than at the next interval.
gladys.onDeviceCreated(async (device) => {
  logger.info(`onDeviceCreated <- ${device.external_id}`);
  await monitor.publishStates();
});

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('test_connection', () => testConnection(monitor));

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
// The scene TRIGGERS need no handler: the monitor fires them on each status
// transition (publishSceneEvent).
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(gladys, { fields, monitor }));
}

// --- Dashboard widget (Gladys 5.1+) ------------------------------------------
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(gladys, { ...request, monitor }));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
    widget.action(gladys, { actionKey, params, settings, monitor }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  monitor.setConfig(normalizeConfig(newConfig));
  // A new token, account or interval: check now, and restart the timer on
  // the new interval.
  await monitor.start();
  await monitor.publishAll();
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle: these handlers only run the
// integration's own (re)initialization.
gladys.on('connected', async () => {
  try {
    monitor.setConfig(normalizeConfig(await gladys.getConfig()));
    await monitor.start();
    // Everything again, changed or not: what was published while the socket
    // was down may never have reached Gladys.
    await monitor.publishAll();
    refreshWidgets(gladys);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, siehe die Logs der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  monitor.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  monitor.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Cloudflare Tunnel Monitor integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
