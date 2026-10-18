// -----------------------------------------------------------------------------
// "Test the connection" (manifest action `test_connection`).
//
// Checks each configured source on its own and says, in one message under the
// button, what answered and what to fix. Runs a full check through the monitor
// so the devices and the widget follow the answer at once.
// -----------------------------------------------------------------------------

import { localize, pick } from './i18n.js';
import { CONNECTOR_STATUSES } from './cloudflare/local.js';
import { summaryMessage } from './capabilities/widget.js';

/**
 * @param {object} monitor see src/monitor.js
 * @returns {Promise<Record<string, string>>} the message shown under the button
 */
export async function testConnection(monitor) {
  const { config } = monitor;
  if (config.problems.length > 0) {
    return localize(
      (language) =>
        `${pick(language, PREFIX.config)} ${config.problems.map((problem) => pick(language, problem)).join(' ')}`,
    );
  }
  if (!config.cloudConfigured && !config.localConfigured) {
    return {
      en: 'Nothing to test yet: enter a Cloudflare API token and account ID, or a local connector address, then save.',
      fr: "Rien à tester pour l'instant : renseignez un jeton d'API Cloudflare et l'ID de compte, ou l'adresse d'un connecteur local, puis enregistrez.",
      de: 'Noch nichts zu testen: Gib ein Cloudflare-API-Token und die Konto-ID oder eine lokale Connector-Adresse ein und speichere.',
      es: 'Nada que probar todavía: introduzca un token de API de Cloudflare y el ID de cuenta, o la dirección de un conector local, y guarde.',
    };
  }

  const snapshot = await monitor.refresh();
  const parts = [];

  if (config.cloudConfigured) {
    parts.push((language) =>
      snapshot.apiError
        ? `${pick(language, PREFIX.api)} ${pick(language, snapshot.apiError.message)}`
        : `${pick(language, PREFIX.api)} ${pick(language, summaryMessage(snapshot))}`,
    );
  }

  for (const connector of snapshot.connectors) {
    parts.push((language) => {
      const text = pick(language, CONNECTOR_TEXTS[connector.status]).replace(
        '{n}',
        String(connector.readyConnections),
      );
      return `${connector.label}: ${text}`;
    });
  }

  return localize((language) => parts.map((part) => part(language)).join(' — '));
}

const PREFIX = {
  config: {
    en: 'Configuration:',
    fr: 'Configuration :',
    de: 'Konfiguration:',
    es: 'Configuración:',
  },
  api: {
    en: 'Cloudflare API:',
    fr: 'API Cloudflare :',
    de: 'Cloudflare-API:',
    es: 'API de Cloudflare:',
  },
};

const CONNECTOR_TEXTS = {
  [CONNECTOR_STATUSES.READY]: {
    en: 'ready, {n} connection(s) to Cloudflare.',
    fr: 'prêt, {n} connexion(s) vers Cloudflare.',
    de: 'bereit, {n} Verbindung(en) zu Cloudflare.',
    es: 'listo, {n} conexión(es) con Cloudflare.',
  },
  [CONNECTOR_STATUSES.NOT_READY]: {
    en: 'answers, but holds no connection to Cloudflare.',
    fr: 'répond, mais ne tient aucune connexion vers Cloudflare.',
    de: 'antwortet, hält aber keine Verbindung zu Cloudflare.',
    es: 'responde, pero no mantiene ninguna conexión con Cloudflare.',
  },
  [CONNECTOR_STATUSES.UNREACHABLE]: {
    en: 'no answer: check that cloudflared runs with --metrics on this address and port.',
    fr: 'pas de réponse : vérifiez que cloudflared tourne avec --metrics sur cette adresse et ce port.',
    de: 'keine Antwort: prüfe, dass cloudflared mit --metrics auf dieser Adresse und diesem Port läuft.',
    es: 'sin respuesta: compruebe que cloudflared se ejecuta con --metrics en esta dirección y puerto.',
  },
};
