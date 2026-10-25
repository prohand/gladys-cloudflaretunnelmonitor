# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Catalog search keywords (cloudflared, Zero Trust, Argo Tunnel, remote
  access, self-hosted...) and the new "Servers" shelf of the Gladys catalog,
  next to Network and Security.

### Changed

- Requires Gladys 5.3.0 or later (the catalog keywords are a Gladys 5.3
  manifest field).
- Gladys integration SDK 0.16.

## [0.0.2] - 2026-10-23

- Maintenance release, no functional change.

## [0.0.1] - 2026-10-18

### Added

- One Gladys device per Cloudflare tunnel of the account (status, online,
  active connections), read through the Cloudflare API with a read-only token.
- One Gladys device per local `cloudflared` connector (ready, ready
  connections), read from its `--metrics` `/ready` endpoint, without token nor
  Internet.
- Cloud and local transports: the "Prefer the local connection" toggle, and a
  per-device badge that says which source is shown and why (degraded when the
  preferred source failed).
- Scene triggers: a tunnel changes status, a local connector changes status,
  the Cloudflare API stops answering. The last statuses are kept in `/data`, so
  a change during a restart still fires.
- Scene actions: check the tunnels now, read the status of a tunnel or
  connector.
- "Cloudflare tunnels" dashboard widget, with a "Check now" button.
- "Test the connection" action in the Configuration screen.
- English, French, German and Spanish: manifest, messages, widget and
  documentation.
- CI (Prettier, ESLint, tests on Node 22 and 24, store checks and Docker build
  on pull requests), UI-driven Release workflow, multi-arch image, GitHub
  Releases and Dependabot.

[Unreleased]: https://github.com/prohand/gladys-cloudflaretunnelmonitor/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/prohand/gladys-cloudflaretunnelmonitor/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/prohand/gladys-cloudflaretunnelmonitor/releases/tag/v0.0.1
