# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human
contributors when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one
runtime dependency: `@gladysassistant/integration-sdk`) that monitors
**Cloudflare tunnels**. It runs in its own sandboxed Docker container and
started from the official JavaScript template
(GladysAssistant/integration-template-js).

Two sources, either one is enough:

- **cloud**: the Cloudflare API (API token with Account › Cloudflare Tunnel ›
  Read + account id) lists every tunnel and its status;
- **local**: the `/ready` endpoint of `cloudflared --metrics` on the LAN.

Gladys 5.1+ adds scene triggers (tunnel / connector status changed, API
error), scene actions (check now, read a status) and a dashboard widget.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/monitor.test.js            # one file
node --test --test-name-pattern "degraded"  # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24; pull requests also
run the store checks (image skipped: the Release workflow re-runs them in full
once the image is published) and build the image. Run the three commands
before pushing.

## Architecture

```
index.js                  SDK wiring only: handlers registered before connect()
src/config.js             DEFAULT_CONFIG (mirrors the manifest defaults), normalization, connector URLs
src/monitor.js            the check loop: read sources, combine, publish what changed, fire triggers
src/store.js              /data/state.json: last statuses, known tunnels, connector → tunnel
src/connection.js         "Test the connection" manifest action
src/i18n.js               LANGUAGES (en, fr, de, es), pick, localize
src/cloudflare/api.js     Cloudflare API: list tunnels (paginated), connections per tunnel, errors
src/cloudflare/local.js   cloudflared /ready reader
src/cloudflare/status.js  status vocabulary, labels, colors, cloud/local combination (transport badge)
src/devices/tunnel.js     tunnel device: status (text), online (binary), connections
src/devices/connector.js  connector device: ready (binary), connections
src/capabilities/         scene actions and the dashboard widget
test/helpers/fakeCloudflare.js  fake fetch: Cloudflare API + cloudflared metrics servers
```

### Invariants worth knowing

- **One API call answers for every tunnel**: the monitor runs its own timer
  (`poll_frequency` seconds, 30 to 3600) instead of Gladys device polling
  (`should_poll` stays unset), which would cost one call per device per
  minute. The deprecated `connections` field of the tunnel list is not
  trusted: `GET .../cfd_tunnel/{id}/connections` gives them, for non-inactive
  tunnels only, at most 4 at a time.
- **Publish only what changed**: devices when their payload changes, states
  through `publishChangedStates` (30-minute heartbeat), transports and the
  connection status when they change. `publishAll()` forces everything after a
  (re)connection or a config update.
- **Scene events fire on transitions only**, compared with the status stored
  in `/data/state.json` (so a change during a restart still fires). `unknown`
  (no source answering) is never a status change. `cloudflare_api_error` fires
  once per failure streak, not at every check, and not again after a restart.
- **Connector ↔ tunnel** matching uses the `connectorId` of `/ready` against
  the connector ids the API lists; it is remembered per connector address so
  an unreachable connector still explains the fallback (degraded badge).
- **Transport badge**: `local` when the shown status comes from cloudflared,
  `cloud` from the API, `unreachable` when nothing answers; `degraded` +
  message when the preferred source failed and the other stood in.
- **External ids are forever**: tunnels are keyed on the Cloudflare tunnel
  UUID, connectors on their normalized address (`host-port`), never on a
  name. Feature keys, trigger / action / widget keys and config keys are
  stored by users: never rename them.
- **The token is a secret**: `api_token` is a `secret` field, sent only to
  `api.cloudflare.com`, never logged nor put in an error message.
- **The container rootfs is read-only**: write only under `/data`
  (`DATA_DIR`).

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and
  it becomes the notes of the GitHub Release.
- **Manifest**: every text is a multi-language object with exactly `en`,
  `fr`, `de` and `es` (`label`, `description`, `placeholder` alike). The
  catalog `description` holds 10 to 100 characters per language. Scene and
  widget fields need `gladys_version` `>=5.1.0`, the catalog `keywords`
  `>=5.3.0` (the floor today); no `countries`, the integration is worldwide.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together.
- **User-facing text** is written in the four languages (built with
  `src/i18n.js`); user docs in `docs/en.md`, `docs/fr.md`, `docs/de.md` and
  `docs/es.md`, kept in sync.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (`test/helpers/fakeCloudflare.js`,
  and `createFakeGladys()` from `@gladysassistant/integration-sdk/testing`,
  which refuses the payloads Gladys refuses).
