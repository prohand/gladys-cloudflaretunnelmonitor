# Cloudflare Tunnel Monitor

This integration watches your **Cloudflare tunnels** (`cloudflared`) from
Gladys: is each tunnel up, how many connections does it hold, and is the
`cloudflared` running in your home still connected? Every tunnel becomes a
Gladys device, a status change can start a scene, and a dashboard widget shows
everything at a glance.

It only **reads**: it never creates, changes or deletes a tunnel.

Requires **Gladys 5.3.0** or later.

## Two sources, use one or both

| Source    | What you need                                 | What you get                                                           |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| **Cloud** | A Cloudflare API token and your account ID    | Every tunnel of the account, with the status Cloudflare computes       |
| **Local** | The metrics address of a `cloudflared` on LAN | That connector's own state — still answering when the Internet is down |

Use both for the best result: the cloud sees every tunnel, the local
connector keeps answering when the Internet link is what broke.

### Cloud: create the API token

1. Open the Cloudflare dashboard, then **My Profile → API Tokens**
   (<https://dash.cloudflare.com/profile/api-tokens>).
2. **Create Token → Custom token → Get started**.
3. Give it a name (e.g. `Gladys`), and add **one** permission:
   **Account → Cloudflare Tunnel → Read**.
4. Under **Account Resources**, include the account that holds your tunnels.
5. **Continue to summary → Create Token**, then copy the token. Cloudflare
   shows it only once.

The token is read-only: even if it leaked, nobody could change a tunnel with
it.

### Cloud: find the account ID

In the Cloudflare dashboard, open your account: the **Account ID** is shown on
the **Overview** page (right column), or in the account menu → **Copy account
ID**. It is 32 characters, digits and letters `a` to `f`.

### Local: expose the metrics of cloudflared

`cloudflared` has a small metrics server. By default it only listens on the
machine itself, on a random port: give it a fixed address Gladys can reach.

- Command line: add `--metrics 0.0.0.0:2000`, for example
  `cloudflared tunnel --metrics 0.0.0.0:2000 run --token <tunnel token>`.
- `config.yml`: add the line `metrics: 0.0.0.0:2000`.
- Docker: same option in the command, and publish the port (`-p 2000:2000`).

Check from another machine: `curl http://<cloudflared host>:2000/ready` must
answer something like `{"status":200,"readyConnections":4,"connectorId":"…"}`.

The metrics server shows no secret, but keep it on your local network: do not
open that port to the Internet.

## Configuration

| Field                            | Meaning                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| **Cloudflare API token**         | The token created above. Leave empty to use local connectors only.                       |
| **Cloudflare account ID**        | The 32-character ID found above.                                                         |
| **Local cloudflared connectors** | Metrics addresses, separated by commas: `http://192.168.1.10:2000, http://nas.lan:2000`. |
| **Check interval (s)**           | Seconds between two checks, 30 to 3600 (default 60).                                     |

The **Prefer the local connection** switch, shown by Gladys under the form,
decides which source is shown for a tunnel that has both (see below).

Then click **Test the connection**: the answer says, for each source, what
answered and what to fix.

## Devices

The devices appear in the **Discover** tab of the integration: add the ones
you want to follow.

### One device per tunnel (cloud)

| Feature                | Values                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| **Status**             | `healthy`, `degraded`, `down` or `inactive`                          |
| **Online**             | 1 when the tunnel carries traffic (healthy or degraded), 0 otherwise |
| **Active connections** | Number of connections to the Cloudflare edge                         |

What the statuses mean, as Cloudflare defines them:

- **healthy**: the tunnel works normally;
- **degraded**: it still carries traffic, but some connections or connectors
  are missing;
- **down**: no connection left, the tunnel cannot carry traffic;
- **inactive**: the tunnel has never been run.

Renaming a tunnel in Cloudflare keeps its Gladys device: the device is tied to
the tunnel ID, not to its name.

### One device per local connector

| Feature               | Values                                             |
| --------------------- | -------------------------------------------------- |
| **Ready**             | 1 when the connector holds at least one connection |
| **Ready connections** | Number of connections it holds (4 by default)      |

### The badge on each device

- **local**: the state comes from a `cloudflared` on your network;
- **cloud**: it comes from the Cloudflare API;
- **unreachable**: no source answers for this device.

When a local connector serves a tunnel of your account, the integration links
them on its own (through the connector ID Cloudflare reports). Then, with
**Prefer the local connection** on, the tunnel shows the local view; off, the
Cloudflare view. If the preferred source fails, the other one stands in and
the badge gets an orange dot with the reason.

## Scenes

### Triggers

- **A Cloudflare tunnel changes status** — filter on the tunnel and on the new
  status. Variables: tunnel name, new status, previous status, active
  connections. Example: "when the `home` tunnel becomes **Down**, send me a
  message".
- **A local cloudflared connector changes status** — filter on the connector
  and on `Ready`, `Not ready`, `Unreachable`.
- **The Cloudflare API stops answering** — fired once when the API starts
  failing (token refused, unknown account, no Internet…), not at every check.

Each trigger fires **once per change**. The last known status is kept on disk,
so a change that happens while Gladys restarts is still caught.

### Actions

- **Check the Cloudflare tunnels now** — runs a check at once. Gives: number of
  tunnels, healthy tunnels, tunnels with an issue, and "all tunnels healthy"
  (yes/no), to test in the next actions.
- **Read the status of a tunnel** — gives the name, status, online (yes/no) and
  active connections of a tunnel or a local connector, from the last check.

## Dashboard widget

Add the **Cloudflare tunnels** widget to a dashboard. It shows:

- the number of healthy tunnels, and of tunnels with an issue;
- the number of local connectors ready (when you have some);
- one line per tunnel (issues first) and per connector, with its status and
  connections;
- a **Check now** button.

## Troubleshooting

| Message                                     | What to do                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cloudflare refused the API token            | Check the token, and its permission **Account → Cloudflare Tunnel → Read**.                   |
| Cloudflare does not know this account ID    | Copy the account ID again; check the token includes this account.                             |
| The Cloudflare API cannot be reached        | Check that Gladys has Internet access (DNS, firewall).                                        |
| A connector shows **no answer**             | Check `--metrics 0.0.0.0:<port>` on cloudflared, the port, and `curl http://host:port/ready`. |
| A connector answers but holds no connection | cloudflared runs but cannot reach Cloudflare: check its own logs.                             |

## Privacy

The token is stored in Gladys and sent only to `api.cloudflare.com`, over
HTTPS. It is never written to the logs. Local connectors are read on your
network, without any token.
