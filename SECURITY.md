# Security policy

## Supported versions

Only the latest release of the Cloudflare Tunnel Monitor integration receives
security fixes. Update the integration from Gladys before reporting a problem.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-cloudflaretunnelmonitor](https://github.com/prohand/gladys-cloudflaretunnelmonitor/security),
then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, account IDs and addresses first).

You should get a first answer within 7 days. The fix ships as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular the handling of the Cloudflare API token.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Cloudflare and `cloudflared` (see
[Cloudflare's disclosure policy](https://www.cloudflare.com/disclosure/)).

## Good practices for users

- Give the API token **one permission only**: Account › Cloudflare Tunnel ›
  Read. The integration never needs to write.
- Limit the token to the account that holds your tunnels, and add an IP
  filter (your public IP) in the token settings when you can.
- Keep the `cloudflared` metrics port (`--metrics`) on your local network:
  never expose it to the Internet.
- If you think the token leaked, roll it in the Cloudflare dashboard and paste
  the new one in the integration.
- Keep Gladys and the integration up to date.
