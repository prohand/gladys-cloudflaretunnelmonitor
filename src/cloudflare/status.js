// -----------------------------------------------------------------------------
// Tunnel status: the vocabulary, its wording, and how the two sources combine.
//
// Cloudflare computes one status per tunnel from all its connectors. A local
// connector only knows about itself. When both are there, the user's
// "Prefer the local connection" toggle decides which one is shown; when one
// is missing, the other one stands in, and the transport badge says so.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CONNECTOR_STATUSES } from './local.js';

/** The statuses Cloudflare reports, plus `unknown` when no source answers. */
export const TUNNEL_STATUSES = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  DOWN: 'down',
  INACTIVE: 'inactive',
  UNKNOWN: 'unknown',
};

/** The statuses a scene can filter on (`unknown` is never published). */
export const PUBLISHED_TUNNEL_STATUSES = [
  TUNNEL_STATUSES.HEALTHY,
  TUNNEL_STATUSES.DEGRADED,
  TUNNEL_STATUSES.DOWN,
  TUNNEL_STATUSES.INACTIVE,
];

export const TUNNEL_STATUS_LABELS = {
  healthy: { en: 'Healthy', fr: 'Sain', de: 'Fehlerfrei', es: 'Correcto' },
  degraded: { en: 'Degraded', fr: 'Dégradé', de: 'Beeinträchtigt', es: 'Degradado' },
  down: { en: 'Down', fr: 'Hors ligne', de: 'Ausgefallen', es: 'Caído' },
  inactive: { en: 'Inactive', fr: 'Inactif', de: 'Inaktiv', es: 'Inactivo' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

export const CONNECTOR_STATUS_LABELS = {
  ready: { en: 'Ready', fr: 'Prêt', de: 'Bereit', es: 'Listo' },
  not_ready: { en: 'Not ready', fr: 'Non prêt', de: 'Nicht bereit', es: 'No listo' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
};

export const STATUS_COLORS = {
  healthy: WIDGET_COLORS.SUCCESS,
  degraded: WIDGET_COLORS.WARNING,
  down: WIDGET_COLORS.DANGER,
  inactive: WIDGET_COLORS.NEUTRAL,
  unknown: WIDGET_COLORS.NEUTRAL,
  ready: WIDGET_COLORS.SUCCESS,
  not_ready: WIDGET_COLORS.DANGER,
  unreachable: WIDGET_COLORS.DANGER,
};

/** A tunnel that carries traffic: healthy, or degraded but still connected. */
export function isOnline(status) {
  return status === TUNNEL_STATUSES.HEALTHY || status === TUNNEL_STATUSES.DEGRADED;
}

/**
 * The status of a tunnel seen only through its local connectors: healthy when
 * every one of them is ready, degraded when only some are, down when none is.
 *
 * @param {Array<{status: string}>} readings the matched connectors' readings
 */
export function statusFromConnectors(readings) {
  const ready = readings.filter((reading) => reading.status === CONNECTOR_STATUSES.READY).length;
  if (ready === 0) {
    return TUNNEL_STATUSES.DOWN;
  }
  return ready === readings.length ? TUNNEL_STATUSES.HEALTHY : TUNNEL_STATUSES.DEGRADED;
}

/**
 * Combine the two sources into what Gladys shows for one tunnel.
 *
 * @param {object} options
 * @param {?object} options.cloud the tunnel as the API listed it, null when the
 *   API is not configured or failed
 * @param {Array<object>} options.locals readings of the connectors matched with it
 * @param {boolean} options.preferLocal the GLADYS_PREFER_LOCAL toggle
 * @param {boolean} options.cloudConfigured an API token is set (so a missing
 *   `cloud` is a failure, not a choice)
 * @returns {{status: string, connections: number, transport: string, degraded?: true,
 *   message?: Record<string, string>}}
 */
export function resolveTunnelView({ cloud, locals, preferLocal, cloudConfigured }) {
  const reachable = locals.filter((reading) => reading.status !== CONNECTOR_STATUSES.UNREACHABLE);
  const allLocalAnswer = locals.length > 0 && reachable.length === locals.length;
  const fromLocal = () => ({
    status: statusFromConnectors(locals),
    connections: locals.reduce((sum, reading) => sum + reading.readyConnections, 0),
  });

  if (preferLocal && allLocalAnswer) {
    return { ...fromLocal(), transport: DEVICE_TRANSPORTS.LOCAL };
  }
  if (cloud) {
    const view = {
      status: cloud.status,
      connections: cloud.connections,
      transport: DEVICE_TRANSPORTS.CLOUD,
    };
    if (preferLocal && locals.length > 0) {
      // Local was asked for and is known for this tunnel, but a connector does
      // not answer on the LAN: the badge says why it shows the cloud.
      view.degraded = true;
      view.message = {
        en: 'Local connector unreachable, status read from the Cloudflare API.',
        fr: "Connecteur local injoignable, état lu depuis l'API Cloudflare.",
        de: 'Lokaler Connector nicht erreichbar, Status über die Cloudflare-API gelesen.',
        es: 'Conector local inaccesible, estado leído desde la API de Cloudflare.',
      };
    }
    return view;
  }
  if (reachable.length > 0) {
    const view = { ...fromLocal(), transport: DEVICE_TRANSPORTS.LOCAL };
    if (cloudConfigured) {
      view.degraded = true;
      view.message = {
        en: 'Cloudflare API unavailable, status read from the local connector only.',
        fr: 'API Cloudflare indisponible, état lu depuis le connecteur local uniquement.',
        de: 'Cloudflare-API nicht verfügbar, Status nur über den lokalen Connector gelesen.',
        es: 'API de Cloudflare no disponible, estado leído solo desde el conector local.',
      };
    }
    return view;
  }
  return {
    status: TUNNEL_STATUSES.UNKNOWN,
    connections: 0,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  };
}
