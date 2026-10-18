// -----------------------------------------------------------------------------
// Dashboard widget (SDK v0.14+, Gladys 5.1+): "Cloudflare tunnels".
//
// Declared in the manifest `widgets` field. The content is declarative — the
// core renders it with its own theme, dark mode and translations:
//   - tiles: tunnels healthy, tunnels with an issue, local connectors ready;
//   - a status list, one row per tunnel (issues first), then per connector;
//   - a caption when the API fails or nothing is found;
//   - a "Check now" button, answered by a toast with the counts.
//
// The core caches the content until its `ttl_seconds`; the monitor also nudges
// it (requestWidgetRefresh) whenever what it shows changed.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { localize, pick } from '../i18n.js';
import {
  CONNECTOR_STATUS_LABELS,
  STATUS_COLORS,
  TUNNEL_STATUS_LABELS,
  TUNNEL_STATUSES,
} from '../cloudflare/status.js';
import { summarize } from '../monitor.js';

const logger = createLogger({ name: 'widget' });

/** Widget key, as declared in the manifest. Stored by dashboards: never renamed. */
export const TUNNELS_WIDGET = 'tunnels_overview';

/** Keys of the `button` actions the content declares. */
export const WIDGET_ACTIONS = { CHECK_NOW: 'check_now' };

// The core shows at most 10 rows in a status list.
const MAX_ROWS = 10;
// Status labels are cut at 40 characters by the core: cut them ourselves,
// with an ellipsis, rather than mid-word without one.
const MAX_LABEL = 40;

// Issues first, so the row that matters is never the one past the cap.
const STATUS_ORDER = {
  down: 0,
  degraded: 1,
  unknown: 2,
  inactive: 3,
  healthy: 4,
};

function shorten(text) {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

function tunnelRows(snapshot) {
  return [...snapshot.tunnels]
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2) ||
        a.name.localeCompare(b.name),
    )
    .map((tunnel) => {
      const label = TUNNEL_STATUS_LABELS[tunnel.status] ?? TUNNEL_STATUS_LABELS.unknown;
      return {
        label: shorten(tunnel.name),
        icon: 'cloud',
        value:
          tunnel.status === TUNNEL_STATUSES.UNKNOWN
            ? label
            : localize((language) => `${pick(language, label)} (${tunnel.connections})`),
        color: STATUS_COLORS[tunnel.status] ?? WIDGET_COLORS.NEUTRAL,
      };
    });
}

function connectorRows(snapshot) {
  return snapshot.connectors.map((connector) => ({
    label: shorten(connector.label),
    icon: 'server',
    value: localize(
      (language) =>
        `${pick(language, CONNECTOR_STATUS_LABELS[connector.status])} (${connector.readyConnections})`,
    ),
    color: STATUS_COLORS[connector.status],
  }));
}

/**
 * The toast of the "Check now" button, and the summary the documentation
 * shows: "3 tunnels: 2 healthy, 1 with an issue."
 */
export function summaryMessage(snapshot) {
  const { total, healthy, unhealthy } = summarize(snapshot);
  if (snapshot.apiError && total === 0) {
    return snapshot.apiError.message;
  }
  return localize((language) =>
    pick(language, {
      en: `${total} tunnel(s): ${healthy} healthy, ${unhealthy} with an issue.`,
      fr: `${total} tunnel(s) : ${healthy} sain(s), ${unhealthy} en anomalie.`,
      de: `${total} Tunnel: ${healthy} fehlerfrei, ${unhealthy} mit Problem.`,
      es: `${total} túnel(es): ${healthy} correcto(s), ${unhealthy} con problemas.`,
    }),
  );
}

/**
 * The widget content for the last check.
 * @param {object} snapshot see src/monitor.js
 * @param {{poll_frequency: number}} config
 */
export function buildWidgetContent(snapshot, config) {
  const counts = summarize(snapshot);
  const components = [
    {
      type: 'value',
      label: { en: 'Healthy', fr: 'Sains', de: 'Fehlerfrei', es: 'Correctos' },
      icon: 'check-circle',
      value: counts.healthy,
      color: counts.healthy > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: { en: 'Issues', fr: 'Anomalies', de: 'Probleme', es: 'Problemas' },
      icon: 'alert-triangle',
      value: counts.unhealthy,
      color: counts.unhealthy > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (counts.connectors > 0) {
    components.push({
      type: 'value',
      label: { en: 'Connectors', fr: 'Connecteurs', de: 'Connectoren', es: 'Conectores' },
      icon: 'server',
      value: `${counts.connectorsReady}/${counts.connectors}`,
      color:
        counts.connectorsReady === counts.connectors ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    });
  }

  const rows = [...tunnelRows(snapshot), ...connectorRows(snapshot)].slice(0, MAX_ROWS);
  if (rows.length > 0) {
    components.push({ type: 'status', items: rows });
  }

  const caption = captionOf(snapshot);
  if (caption) {
    components.push({ type: 'text', variant: 'caption', text: caption });
  }

  components.push({
    type: 'button',
    label: { en: 'Check now', fr: 'Vérifier', de: 'Jetzt prüfen', es: 'Comprobar' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.CHECK_NOW },
  });

  return {
    // The monitor nudges the widget on every change: the TTL is a safety net,
    // one check interval long.
    ttl_seconds: config.poll_frequency,
    components,
  };
}

function captionOf(snapshot) {
  if (snapshot.apiError) {
    return {
      en: 'Cloudflare API error: see the integration status.',
      fr: "Erreur de l'API Cloudflare : voir l'état de l'intégration.",
      de: 'Fehler der Cloudflare-API: siehe Status der Integration.',
      es: 'Error de la API de Cloudflare: vea el estado de la integración.',
    };
  }
  if (!snapshot.checkedAt) {
    return {
      en: 'First check in progress…',
      fr: 'Première vérification en cours…',
      de: 'Erste Prüfung läuft…',
      es: 'Primera comprobación en curso…',
    };
  }
  if (snapshot.tunnels.length === 0 && snapshot.connectors.length === 0) {
    return {
      en: 'No tunnel or connector found: check the configuration.',
      fr: 'Aucun tunnel ni connecteur trouvé : vérifiez la configuration.',
      de: 'Kein Tunnel und kein Connector gefunden: prüfe die Konfiguration.',
      es: 'No se encontró ningún túnel ni conector: revise la configuración.',
    };
  }
  return null;
}

export const WIDGETS = {
  [TUNNELS_WIDGET]: {
    async get(_gladys, { monitor }) {
      logger.debug(`onWidgetGet <- ${TUNNELS_WIDGET}`);
      return buildWidgetContent(monitor.snapshot, monitor.config);
    },

    // The params are declared by the content itself, never user input.
    async action(_gladys, { actionKey, monitor }) {
      logger.info(`onWidgetAction <- ${TUNNELS_WIDGET}.${actionKey}`);
      if (actionKey === WIDGET_ACTIONS.CHECK_NOW) {
        return summaryMessage(await monitor.refresh());
      }
      // Throwing acks the action as failed: the message reaches the user.
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
};

/**
 * Freshness nudge: ask the core to re-pull every widget now instead of
 * waiting for the content TTL. Fire-and-forget: rate-limited core-side to one
 * per 10 s per widget, dropped while disconnected.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
