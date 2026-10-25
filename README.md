# Cloudflare Tunnel Monitor for Gladys Assistant

An **external integration** for [Gladys Assistant](https://gladysassistant.com)
that monitors your **Cloudflare tunnels** (`cloudflared`), built on the
official [JavaScript template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- one Gladys device per tunnel: status, online, active connections;
- one device per local `cloudflared` connector: ready, ready connections;
- **cloud and local** transports: the Cloudflare API, and the `/ready`
  endpoint of `cloudflared` on your LAN, which keeps answering when the
  Internet link is down — with the standard "Prefer the local connection"
  toggle and the per-device badge;
- scene **triggers** (tunnel status changed, connector status changed,
  Cloudflare API error), scene **actions** (check now, read a tunnel's
  status) and a dashboard **widget** (Gladys 5.1+);
- English, French, German and Spanish everywhere (manifest, messages,
  widget, documentation).

Requires **Gladys 5.3.0** or later.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## How it works

```
                ┌──────────────── every poll_frequency seconds ────────────────┐
                │                                                              │
 Cloudflare API ──► GET /accounts/{id}/cfd_tunnel            (all tunnels + status)
  (cloud)       ──► GET /accounts/{id}/cfd_tunnel/{t}/connections (connector ids)
                │                                                              │
 cloudflared    ──► GET http://host:2000/ready  (readyConnections, connectorId)
  (local)       │                                                              │
                └──► combine (src/cloudflare/status.js) ──► Gladys: devices, changed
                     states, transport badges, connection status, scene events,
                     widget refresh
```

A local connector is matched with its tunnel through the connector id the API
lists for each connection. The last status of every tunnel is kept in
`/data/state.json`, so a change that happens while Gladys restarts still fires
its scene trigger.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + wiring (no monitoring logic)
├─ src/
│  ├─ config.js                      # defaults, normalization, connector address parser
│  ├─ monitor.js                     # the check loop: sources → Gladys, scene triggers
│  ├─ store.js                       # /data/state.json: memory across restarts
│  ├─ connection.js                  # "Test the connection" action
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ cloudflare/
│  │  ├─ api.js                      # Cloudflare API client (tunnels, connections, errors)
│  │  ├─ local.js                    # cloudflared /ready reader
│  │  └─ status.js                   # status vocabulary + cloud/local combination
│  ├─ devices/
│  │  ├─ tunnel.js                   # tunnel device (status, online, connections)
│  │  └─ connector.js                # local connector device (ready, connections)
│  └─ capabilities/
│     ├─ scenes.js                   # scene actions (Gladys 5.1+)
│     └─ widget.js                   # dashboard widget (Gladys 5.1+)
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, fake Cloudflare + fake Gladys
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md · CLAUDE.md · SECURITY.md
├─ .github/workflows/ci.yml          # format, lint, tests (Node 22 + 24); store checks + Docker build on PRs
├─ .github/workflows/release.yml     # UI-driven release: bump + changelog + tag + build + GitHub Release
├─ .github/workflows/build.yml       # multi-arch build (amd64 + arm64) to ghcr.io
├─ .github/workflows/github-release.yml # GitHub Release of every version tag
├─ .github/scripts/changelog-release.mjs # rolls the [Unreleased] changelog section
└─ .github/dependabot.yml            # npm weekly, GitHub Actions + Docker monthly
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="cloudflare-tunnel-monitor" \
DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor in the
sandboxed container. `DATA_DIR` defaults to `/data`, the only writable path of
the container.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test (no network: fake Cloudflare + SDK fake Gladys)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs the first three on Node 22 and 24 on every push and pull request;
pull requests also run the store admission checks and build the Docker image.

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository, and
   turn on **Private vulnerability reporting** (see [SECURITY.md](SECURITY.md)).
2. Describe the changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
3. **Actions → Release → Run workflow**, pick `major` for the first release
   (`0.0.0` → `1.0.0`), then `patch` / `minor` / `major` as needed. The
   workflow bumps `package.json` and the manifest (`version` +
   `docker_image`), rolls the changelog, tags, builds the `linux/amd64` +
   `linux/arm64` image to `ghcr.io/prohand/gladys-cloudflaretunnelmonitor`
   and publishes the GitHub Release.
4. Make the `ghcr.io` package public (GitHub → Packages → Package settings), so
   Gladys can pull it.

The store admission check of pull requests also checks that the manifest's
`docker_image` exists: it fails until the first release is published.

## License

Apache-2.0
