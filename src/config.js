// -----------------------------------------------------------------------------
// Integration configuration.
//
// The user fills it in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`; the SDK fetches it (`gladys.getConfig()`)
// and notifies every change (`gladys.onConfigUpdated()`).
//
// Two independent sources, either one is enough:
//   - cloud: a Cloudflare API token + the account id, which lists every tunnel
//     of the account with the status Cloudflare computes;
//   - local: the metrics address of one or more `cloudflared` connectors on
//     the LAN, whose `/ready` endpoint says whether that connector holds its
//     connections to the Cloudflare edge.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  api_token: '', // Cloudflare API token, "Account › Cloudflare Tunnel › Read"
  account_id: '', // 32 hexadecimal characters, from the Cloudflare dashboard
  local_connectors: '', // comma-separated cloudflared metrics URLs
  poll_frequency: 60, // seconds between two checks
  // Reserved key (NOT in config_schema): the manifest declares both 'local'
  // and 'cloud' in its `transports` field, so Gladys shows a standard "Prefer
  // the local connection" toggle and sends the user's choice here. Read-only
  // for the integration; defaults to true.
  GLADYS_PREFER_LOCAL: true,
};

/** Bounds of the check interval, in seconds (the manifest `min` / `max`). */
export const MIN_POLL_FREQUENCY = 30;
export const MAX_POLL_FREQUENCY = 3600;

/** A Cloudflare account id: 32 lowercase hexadecimal characters. */
const ACCOUNT_ID_REGEX = /^[0-9a-f]{32}$/;

/**
 * Merge the user config with the defaults and parse the connector list.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...raw,
    // A token or an id pasted from a web page often carries a trailing space
    // or line break, which Cloudflare answers with a misleading 400.
    api_token: String(raw.api_token ?? DEFAULT_CONFIG.api_token).trim(),
    account_id: String(raw.account_id ?? DEFAULT_CONFIG.account_id)
      .trim()
      .toLowerCase(),
    local_connectors: String(raw.local_connectors ?? DEFAULT_CONFIG.local_connectors).trim(),
    poll_frequency: toPollFrequency(raw.poll_frequency),
    // The preference is a boolean; anything but an explicit false means true.
    GLADYS_PREFER_LOCAL: raw.GLADYS_PREFER_LOCAL !== false,
  };
  config.connectors = parseLocalConnectors(config.local_connectors);
  config.cloudConfigured = Boolean(config.api_token && config.account_id);
  config.localConfigured = config.connectors.length > 0;
  config.problems = configProblems(config);
  return config;
}

/**
 * What is visibly wrong with the configuration, before any request: said in
 * the connection status and by "Test the connection".
 *
 * @returns {Array<Record<string, string>>} multi-language texts, empty when fine
 */
export function configProblems(config) {
  const problems = [];
  if (config.api_token && !config.account_id) {
    problems.push({
      en: 'the API token is set, but the account ID is empty.',
      fr: "le jeton d'API est renseigné, mais l'ID de compte est vide.",
      de: 'das API-Token ist gesetzt, aber die Konto-ID ist leer.',
      es: 'el token de API está definido, pero el ID de cuenta está vacío.',
    });
  }
  if (config.account_id && !config.api_token) {
    problems.push({
      en: 'the account ID is set, but the API token is empty.',
      fr: "l'ID de compte est renseigné, mais le jeton d'API est vide.",
      de: 'die Konto-ID ist gesetzt, aber das API-Token ist leer.',
      es: 'el ID de cuenta está definido, pero el token de API está vacío.',
    });
  }
  if (config.account_id && !ACCOUNT_ID_REGEX.test(config.account_id)) {
    problems.push({
      en: 'the account ID must be 32 hexadecimal characters (Cloudflare dashboard, Overview page).',
      fr: "l'ID de compte doit faire 32 caractères hexadécimaux (tableau de bord Cloudflare, page Vue d'ensemble).",
      de: 'die Konto-ID muss aus 32 Hexadezimalzeichen bestehen (Cloudflare-Dashboard, Seite Übersicht).',
      es: 'el ID de cuenta debe tener 32 caracteres hexadecimales (panel de Cloudflare, página Resumen).',
    });
  }
  for (const entry of config.connectors.filter((connector) => connector.invalid)) {
    problems.push({
      en: `"${entry.raw}" is not a valid connector address (expected http://host:port).`,
      fr: `« ${entry.raw} » n'est pas une adresse de connecteur valide (attendu : http://hôte:port).`,
      de: `„${entry.raw}“ ist keine gültige Connector-Adresse (erwartet: http://host:port).`,
      es: `«${entry.raw}» no es una dirección de conector válida (se espera http://host:puerto).`,
    });
  }
  return problems;
}

/**
 * Parse the comma (or line) separated list of cloudflared metrics addresses.
 *
 * `cloudflared --metrics 0.0.0.0:2000` serves `/ready` and `/metrics` on that
 * address. The user may type `192.168.1.10:2000`, `http://nas:2000/` or
 * `http://nas:2000/ready`: all three name the same connector.
 *
 * @returns {Array<{raw: string, url?: string, id?: string, label?: string, invalid?: true}>}
 *   one entry per address, each valid one once
 */
export function parseLocalConnectors(text) {
  const seen = new Set();
  const connectors = [];
  for (const raw of String(text ?? '')
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)) {
    const parsed = parseConnectorUrl(raw);
    if (!parsed) {
      connectors.push({ raw, invalid: true });
      continue;
    }
    if (seen.has(parsed.id)) {
      continue;
    }
    seen.add(parsed.id);
    connectors.push({ raw, ...parsed });
  }
  return connectors;
}

function parseConnectorUrl(raw) {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username) {
    return null;
  }
  // The metrics server has no default port: one that is not typed is a typo.
  if (!url.port) {
    return null;
  }
  const path = url.pathname.replace(/\/(ready|metrics)?\/?$/, '');
  const base = `${url.protocol}//${url.host}${path}`;
  return {
    url: base,
    // The Gladys external id of the connector device: what the user typed,
    // normalized, so the same connector keeps the same device forever.
    id: slug(`${url.hostname}-${url.port}${path}`),
    label: `${url.hostname}:${url.port}${path}`,
  };
}

function toPollFrequency(value) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return DEFAULT_CONFIG.poll_frequency;
  }
  return Math.min(MAX_POLL_FREQUENCY, Math.max(MIN_POLL_FREQUENCY, Math.round(number)));
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
