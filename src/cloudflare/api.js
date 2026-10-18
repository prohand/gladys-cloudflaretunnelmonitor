// -----------------------------------------------------------------------------
// Cloud source: the Cloudflare API.
//
//   GET https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel
//       ?is_deleted=false&per_page=100&page=N
//   GET .../accounts/{account_id}/cfd_tunnel/{tunnel_id}/connections
//   Authorization: Bearer <API token>
//
// The token needs one permission only: Account › Cloudflare Tunnel › Read. It
// never leaves this module, and is never logged.
//
// Each tunnel comes back with the status Cloudflare computes for it from all
// its connectors: `healthy`, `degraded` (connected, but some connections are
// missing), `down` (no connection left) or `inactive` (never connected).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'cloudflare-api' });

export const API_BASE_URL = 'https://api.cloudflare.com/client/v4';

const PAGE_SIZE = 100;
// A runaway pagination (an API answering the same page forever) stops here:
// 50 pages of 100 is far more tunnels than an account holds.
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 15_000;

/** Why a request failed, in a form the messages can be chosen from. */
export const API_ERRORS = {
  AUTH: 'auth', // token wrong, expired, or without the Tunnel Read permission
  ACCOUNT: 'account', // account id unknown to Cloudflare, or not reachable by the token
  RATE_LIMIT: 'rate_limit',
  UNAVAILABLE: 'unavailable', // Cloudflare answered 5xx
  NETWORK: 'network', // no answer at all: DNS, timeout, no Internet
  INVALID: 'invalid', // an answer that is not the documented shape
};

export class CloudflareApiError extends Error {
  /**
   * @param {string} kind one of API_ERRORS
   * @param {string} message technical detail, for the logs (never the token)
   * @param {number} [status] HTTP status, when there was an answer
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'CloudflareApiError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * List every tunnel of the account that is not deleted.
 *
 * @param {{api_token: string, account_id: string}} config
 * @param {{fetch?: typeof fetch}} [options] `fetch` is injected by the tests
 * @returns {Promise<Array<object>>} tunnels as {@link normalizeTunnel} returns them
 */
export async function listTunnels(config, { fetch: doFetch = fetch } = {}) {
  const tunnels = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url =
      `${API_BASE_URL}/accounts/${encodeURIComponent(config.account_id)}/cfd_tunnel` +
      `?is_deleted=false&per_page=${PAGE_SIZE}&page=${page}`;
    const body = await request(url, config.api_token, doFetch);
    if (!Array.isArray(body.result)) {
      throw new CloudflareApiError(API_ERRORS.INVALID, 'The tunnel list has no "result" array');
    }
    tunnels.push(...body.result.map(normalizeTunnel).filter(Boolean));
    const info = body.result_info ?? {};
    const totalPages =
      Number(info.total_pages) ||
      Math.ceil(Number(info.total_count) / (Number(info.per_page) || PAGE_SIZE)) ||
      1;
    if (page >= totalPages || body.result.length === 0) {
      break;
    }
  }
  logger.debug(`${tunnels.length} tunnel(s) listed`);

  // The `connections` field of the list is deprecated (Cloudflare announced
  // it will return an empty array): the dedicated endpoint gives them. A
  // tunnel that never ran has none to ask for.
  const active = tunnels.filter((tunnel) => tunnel.status !== 'inactive');
  await mapWithConcurrency(active, CONNECTIONS_CONCURRENCY, async (tunnel) => {
    try {
      Object.assign(tunnel, await listConnections(config, tunnel.id, doFetch));
    } catch (err) {
      // The status still comes from the list: only the details are missing.
      // An auth error here would have failed the list already.
      logger.debug(`Connections of "${tunnel.name}" unavailable: ${err.message}`);
    }
  });
  return tunnels;
}

/**
 * The connectors of one tunnel and their live connections:
 *
 *   GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/connections
 *   result: [{ id: <connector id>, version, conns: [{ colo_name, ... }] }]
 *
 * @returns {Promise<{connections: number, connectorIds: string[], colos: string[]}>}
 */
export async function listConnections(config, tunnelId, doFetch = fetch) {
  const url =
    `${API_BASE_URL}/accounts/${encodeURIComponent(config.account_id)}` +
    `/cfd_tunnel/${encodeURIComponent(tunnelId)}/connections`;
  const body = await request(url, config.api_token, doFetch);
  if (!Array.isArray(body.result)) {
    throw new CloudflareApiError(API_ERRORS.INVALID, 'The connection list has no "result" array');
  }
  const clients = body.result.filter((client) => client && typeof client === 'object');
  const conns = clients.flatMap((client) =>
    (Array.isArray(client.conns) ? client.conns : []).filter(
      (connection) => connection && !connection.is_pending_reconnect,
    ),
  );
  return {
    connections: conns.length,
    connectorIds: [...new Set(clients.map((client) => client.id).filter(Boolean))],
    colos: [...new Set(conns.map((connection) => connection.colo_name).filter(Boolean))],
  };
}

const CONNECTIONS_CONCURRENCY = 4;

async function mapWithConcurrency(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * The fields of a Cloudflare tunnel this integration uses.
 *
 * `connections` lists one entry per connection to an edge data center; an
 * entry `is_pending_reconnect` is a connection being re-established, not a
 * live one. `client_id` is the id of the cloudflared instance holding it — the
 * `connectorId` its local `/ready` endpoint reports, which is how a local
 * connector is matched with its tunnel.
 *
 * @returns {object|null} null for an entry without an id
 */
export function normalizeTunnel(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) {
    return null;
  }
  const connections = Array.isArray(raw.connections) ? raw.connections : [];
  const live = connections.filter((connection) => connection && !connection.is_pending_reconnect);
  return {
    id: raw.id,
    name: String(raw.name ?? '').trim() || raw.id,
    status: String(raw.status ?? 'inactive').toLowerCase(),
    connections: live.length,
    connectorIds: [...new Set(live.map((connection) => connection.client_id).filter(Boolean))],
    colos: [...new Set(live.map((connection) => connection.colo_name).filter(Boolean))],
  };
}

async function request(url, token, doFetch) {
  let response;
  try {
    response = await doFetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new CloudflareApiError(API_ERRORS.NETWORK, `Cloudflare API unreachable: ${err.message}`);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Kept null: a 5xx from a proxy in front of the API is often HTML.
  }

  if (response.ok && body?.success !== false) {
    if (!body || typeof body !== 'object') {
      throw new CloudflareApiError(API_ERRORS.INVALID, 'The Cloudflare API answered no JSON');
    }
    return body;
  }
  throw errorFromResponse(response.status, body);
}

/**
 * Classify a refused request. The API returns `errors: [{ code, message }]`;
 * the codes that matter here:
 *   - 7003 / 7000: "Could not route to /accounts/…" — an account id that does
 *     not exist, or a typo in it;
 *   - 9109 / 10000 / 6003 / 6111: the token is invalid, or lacks the permission.
 */
export function errorFromResponse(status, body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const codes = errors.map((error) => Number(error?.code));
  const detail =
    errors
      .map((error) => `${error?.code ?? '?'} ${error?.message ?? ''}`.trim())
      .join('; ')
      .slice(0, 300) || 'no detail';

  if (codes.some((code) => code === 7003 || code === 7000)) {
    return new CloudflareApiError(API_ERRORS.ACCOUNT, `HTTP ${status}: ${detail}`, status);
  }
  if (status === 401 || status === 403 || codes.some((code) => AUTH_CODES.has(code))) {
    return new CloudflareApiError(API_ERRORS.AUTH, `HTTP ${status}: ${detail}`, status);
  }
  if (status === 404) {
    return new CloudflareApiError(API_ERRORS.ACCOUNT, `HTTP ${status}: ${detail}`, status);
  }
  if (status === 429) {
    return new CloudflareApiError(API_ERRORS.RATE_LIMIT, `HTTP ${status}: ${detail}`, status);
  }
  if (status >= 500) {
    return new CloudflareApiError(API_ERRORS.UNAVAILABLE, `HTTP ${status}: ${detail}`, status);
  }
  return new CloudflareApiError(API_ERRORS.INVALID, `HTTP ${status}: ${detail}`, status);
}

const AUTH_CODES = new Set([6003, 6111, 9106, 9109, 10000, 10001]);

/**
 * What a failed request means for the user, in every language.
 *
 * @param {CloudflareApiError|Error} error
 * @returns {Record<string, string>}
 */
export function describeApiError(error) {
  switch (error?.kind) {
    case API_ERRORS.AUTH:
      return {
        en: 'Cloudflare refused the API token: check it, and that it has the permission Account › Cloudflare Tunnel › Read.',
        fr: "Cloudflare refuse le jeton d'API : vérifiez-le, ainsi que sa permission Compte › Cloudflare Tunnel › Lecture.",
        de: 'Cloudflare lehnt das API-Token ab: prüfe es und seine Berechtigung Konto › Cloudflare Tunnel › Lesen.',
        es: 'Cloudflare rechaza el token de API: compruébelo, así como su permiso Cuenta › Cloudflare Tunnel › Lectura.',
      };
    case API_ERRORS.ACCOUNT:
      return {
        en: 'Cloudflare does not know this account ID, or the token cannot reach it: copy it again from the dashboard.',
        fr: "Cloudflare ne connaît pas cet ID de compte, ou le jeton n'y a pas accès : recopiez-le depuis le tableau de bord.",
        de: 'Cloudflare kennt diese Konto-ID nicht oder das Token hat keinen Zugriff: kopiere sie erneut aus dem Dashboard.',
        es: 'Cloudflare no conoce este ID de cuenta, o el token no tiene acceso: cópielo de nuevo desde el panel.',
      };
    case API_ERRORS.RATE_LIMIT:
      return {
        en: 'Too many requests to the Cloudflare API: increase the check interval.',
        fr: "Trop de requêtes vers l'API Cloudflare : augmentez l'intervalle de vérification.",
        de: 'Zu viele Anfragen an die Cloudflare-API: erhöhe das Prüfintervall.',
        es: 'Demasiadas solicitudes a la API de Cloudflare: aumente el intervalo de comprobación.',
      };
    case API_ERRORS.UNAVAILABLE:
      return {
        en: 'The Cloudflare API is temporarily unavailable, the next check will retry.',
        fr: "L'API Cloudflare est momentanément indisponible, la prochaine vérification réessaiera.",
        de: 'Die Cloudflare-API ist vorübergehend nicht verfügbar, die nächste Prüfung versucht es erneut.',
        es: 'La API de Cloudflare no está disponible temporalmente, la próxima comprobación lo reintentará.',
      };
    case API_ERRORS.NETWORK:
      return {
        en: 'The Cloudflare API cannot be reached: check the Internet access of Gladys.',
        fr: "L'API Cloudflare est injoignable : vérifiez l'accès à Internet de Gladys.",
        de: 'Die Cloudflare-API ist nicht erreichbar: prüfe den Internetzugang von Gladys.',
        es: 'No se puede acceder a la API de Cloudflare: compruebe el acceso a Internet de Gladys.',
      };
    default:
      return {
        en: 'The Cloudflare API gave an unexpected answer, see the integration logs.',
        fr: "L'API Cloudflare a donné une réponse inattendue, consultez les logs de l'intégration.",
        de: 'Die Cloudflare-API hat unerwartet geantwortet, siehe die Logs der Integration.',
        es: 'La API de Cloudflare dio una respuesta inesperada, consulte los registros de la integración.',
      };
  }
}
