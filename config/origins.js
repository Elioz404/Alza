/**
 * The one place that knows where the two origins live.
 *
 * Alza is two sites on purpose — the studio and the partner shop — and the cross-origin tool
 * exchange only works when every piece agrees on both addresses: the Vite config that writes
 * the headers, the studio that frames the partner, the partner that shares its tools back,
 * the local static server and the Playwright scripts. Each of them used to carry its own copy
 * of a port or an origin, and they drifted (the static server served the studio on a port the
 * partner never authorised). Now they all import from here.
 *
 * Plain JavaScript with JSDoc on purpose: the browser bundles, vite.config.ts and the bare
 * Node scripts all load this file as-is, with no build step in between.
 *
 * In production the origins are build configuration (VITE_STUDIO_ORIGIN / VITE_SUPPLIER_ORIGIN,
 * from .env.production) and a build without valid ones fails. In development each origin is a
 * port on localhost, and those ports are defined below.
 */

/** Host every dev server binds. A different port is a different origin, which is all the exchange needs. */
export const DEV_HOST = "localhost";
/** The studio's dev port — `npm run dev`, `npm run serve:local`, and the scripts' default BASE_URL. */
export const STUDIO_DEV_PORT = 5199;
/** The partner shop's dev port — `npm run partner` and `npm run serve:local`. */
export const PARTNER_DEV_PORT = 5200;

/**
 * Hosts allowed over plain http. Browsers treat them as secure contexts, which is what
 * WebMCP's `exposedTo` requires; anything else must be https.
 */
/** @type {readonly string[]} */
export const LOOPBACK_HOSTS = Object.freeze(["localhost", "127.0.0.1"]);

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export const isLoopbackHost = (hostname) => LOOPBACK_HOSTS.includes(hostname);

/** Names of the build variables that carry the production origins. */
export const ORIGIN_ENV = Object.freeze({
  studio: "VITE_STUDIO_ORIGIN",
  supplier: "VITE_SUPPLIER_ORIGIN",
});

/** Where the partner's page sits under its origin (the second Vite entry point). */
export const PARTNER_PAGE_PATH = "/partner/index.html";

/**
 * A dev server's origin. `host` lets a page served from 127.0.0.1 pair with its sibling on
 * 127.0.0.1 rather than on localhost, which the browser counts as a different origin.
 *
 * @param {number} port
 * @param {string} [host]
 * @returns {string}
 */
export const devOrigin = (port, host = DEV_HOST) => `http://${isLoopbackHost(host) ? host : DEV_HOST}:${port}`;

export const STUDIO_DEV_ORIGIN = devOrigin(STUDIO_DEV_PORT);
export const PARTNER_DEV_ORIGIN = devOrigin(PARTNER_DEV_PORT);

/** Raised for any origin that is missing or malformed, so callers can tell it from other failures. */
export class OriginConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "OriginConfigError";
  }
}

/**
 * Validate one origin and return it in canonical form (`https://host[:port]`, no trailing slash).
 *
 * An origin is a scheme, a host and a port — nothing else. A path, a query, a fragment or
 * credentials would mean the value was copied from a page URL by mistake, and some of the
 * places it lands (`postMessage` targetOrigin, `frame-ancestors`, `exposedTo`) would either
 * reject it or match nothing, failing silently. So they are refused here, loudly.
 *
 * @param {unknown} value
 * @param {string} name what the value is, for the error message
 * @returns {string}
 */
export function parseOrigin(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OriginConfigError(`${name} is not set.`);
  }
  const raw = value.trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new OriginConfigError(`${name} is not a URL: "${raw}".`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OriginConfigError(`${name} must be an http(s) origin, got "${url.protocol}" in "${raw}".`);
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new OriginConfigError(
      `${name} must use https (plain http is only allowed for ${LOOPBACK_HOSTS.join(" / ")}): "${raw}".`,
    );
  }
  if (url.username || url.password) {
    throw new OriginConfigError(`${name} must not carry credentials: "${raw}".`);
  }
  if (url.pathname !== "/" || url.search || url.hash || /[?#]/.test(raw)) {
    throw new OriginConfigError(`${name} must be an origin only (scheme://host[:port]) with no path, query or fragment: "${raw}".`);
  }
  return url.origin;
}

/**
 * @typedef {{ studio: string, supplier: string }} Origins
 */

/**
 * Resolve both origins from an environment (Vite's `loadEnv` result, or `import.meta.env`).
 *
 * `production: true` is every build that ships: both variables are required and validated, and
 * anything wrong throws — a build that silently fell back would publish headers naming no partner
 * and an iframe pointing nowhere. Otherwise an unset variable means "the local dev server", and a
 * set one is still validated so a typo is caught on the first `npm run dev`.
 *
 * @param {Record<string, unknown>} env
 * @param {{ production: boolean, devHost?: string }} options devHost: the loopback host the
 *   page itself was served from, so the dev fallback stays on the same host name
 * @returns {Origins}
 */
export function resolveOrigins(env, { production, devHost = DEV_HOST }) {
  /**
   * @param {keyof typeof ORIGIN_ENV} key
   * @param {string} fallback
   */
  const pick = (key, fallback) => {
    const name = ORIGIN_ENV[key];
    const value = env[name];
    const unset = value === undefined || value === null || value === "";
    if (unset && !production) return fallback;
    if (unset) throw new OriginConfigError(`${name} is required for a production build (set it in .env.production).`);
    return parseOrigin(value, name);
  };
  return {
    studio: pick("studio", devOrigin(STUDIO_DEV_PORT, devHost)),
    supplier: pick("supplier", devOrigin(PARTNER_DEV_PORT, devHost)),
  };
}

/**
 * The partner origin the studio actually talks to: a `?supplier=` override when it names a
 * valid origin, otherwise the configured one. A malformed override is ignored rather than
 * trusted half-way.
 *
 * @param {string | null} override
 * @param {string} configured
 * @returns {string}
 */
export function supplierOriginFor(override, configured) {
  if (!override) return configured;
  try {
    return parseOrigin(override, "?supplier");
  } catch {
    return configured;
  }
}

/**
 * The studio origins the partner shares its tools with and answers on postMessage: the
 * configured studio, a `?host=` hint, the embedding page (from the referrer), and the local
 * dev studio when the partner itself is served from a loopback host. Values that are not
 * valid origins are dropped.
 *
 * @param {{ configured: string, host: string | null, referrer: string, hostname: string }} from
 * @returns {string[]}
 */
export function hostOriginsFor({ configured, host, referrer, hostname }) {
  /** @type {string[]} */
  const list = [];
  /**
   * @param {unknown} value
   * @param {string} name
   */
  const add = (value, name) => {
    try {
      list.push(parseOrigin(value, name));
    } catch {
      /* not an origin: never trusted */
    }
  };
  add(configured, ORIGIN_ENV.studio);
  if (host) add(host, "?host");
  if (referrer) {
    try {
      add(new URL(referrer).origin, "referrer");
    } catch {
      /* no usable referrer */
    }
  }
  if (isLoopbackHost(hostname)) list.push(devOrigin(STUDIO_DEV_PORT, hostname));
  return [...new Set(list)];
}
