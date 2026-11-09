# Meet8 dedicated Cloudflare tunnel

Meet8 uses its own tunnel and container; the shared Desk8 tunnel is not restarted or reconfigured.

The account origin certificate is used only for creating/routing a named tunnel. Keep it outside the running connector. Mount only the dedicated tunnel JSON credential and ingress configuration, read-only, into the connector, running as the owning non-root UID on the host network. The origin is the localhost-only app publication at port4198. Bind connector metrics to localhost as well.

Use an explicit tunnel UUID and an isolated CLI/container when creating the DNS route. The installed legacy CLI can inherit a different tunnel from its default configuration when passed a name. Verify the returned route target and public health after routing; do not assume command success means the correct tunnel was selected.

Server files (all private credentials remain server-side):
- `~/apps/meet8/shared/tunnel.yaml`
- `~/apps/meet8/shared/tunnel-credentials.json`
- `~/apps/meet8/shared/.env`

The connector is `meet8-tunnel`, image pinned at `cloudflare/cloudflared@sha256:4955524aeaa379e154023d5a027c250f7b35041a2e7e950cf13f144bc9b9c5ba`, with host networking, read-only filesystem, all capabilities dropped, no-new-privileges, restart unless-stopped, and user1000:1000. Configured ingress is only meet8.nuox.io → http://127.0.0.1:4198 plus a 404 catch-all; metrics bind127.0.0.1:4958.

Before restarting the connector, validate the configuration and check for active meetings. Restart only this connector, never the shared cloudflared service. Afterward verify public HTTPS root/health and the unsigned signaling denial.
