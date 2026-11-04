# Files for the server

What lives here and how it is used on the production server (the Plane compose directory, with `plane.env` and
`docker-compose.yaml`). Nothing here holds a secret: keys and passwords stay in `plane.env` on the server.

| File | Used for |
|---|---|
| `deploy.sh`, `plane-compose.sh`, `post-deploy-check.sh` | Copied and run by the `deploy` job of `.github/workflows/build-images-ghcr.yml`. See "Automatic deployment" in `docs/team-ops/DEPLOY.md`. |
| `web.Caddyfile` | Caddy configuration of the `web` container, with a higher request limit. Not copied by the job; see below. |

## `web.Caddyfile`: the request limit of the web container

The stock image limits every client IP to 600 static requests a minute. A single page load of this app asks for
more than that behind one office address, so people saw "429 too many requests". `web.Caddyfile` raises it to 6000.

Put it next to `docker-compose.yaml` and mount it in the `web` service:

```yaml
  web:
    image: ghcr.io/<owner>/plane-fork-web:teamops-1
    volumes:
      - ./web.Caddyfile:/etc/caddy/Caddyfile:ro
```

Then recreate the container with the wrapper (it always passes `plane.env`):

```bash
./plane-compose.sh up -d --force-recreate web
```

The deploy job recreates `web` on every deployment but never rewrites the compose file or this Caddyfile, so
the mount survives. If the server is rebuilt, copy the file again and add the volume.

## Serving the site under more than one address

`WEB_URL` is the main address. To open the same site under another one (a second hostname, a tunnel), list every
address, including the main one, in `CORS_ALLOWED_ORIGINS` in `plane.env`, comma separated:

```
WEB_URL=https://main.example.com
CORS_ALLOWED_ORIGINS=https://other.example.net,https://main.example.com
```

After sign-in, sign-out and errors a person is sent back to the address they came in on (the one in the list that
matches the request host), not to `WEB_URL`. Any host that is not in the list falls back to `WEB_URL`. Recreate
`api`, `worker` and `beat-worker` with the wrapper after changing it. Links built from `WEB_URL` (emails, uploaded
file addresses) still use the main address.

## A public address without opening a port (Tailscale Funnel)

On a server that cannot open port 80 or 443 to the internet, `tailscale funnel --bg 9095` publishes the proxy
container (`LISTEN_HTTP_PORT`) under `https://<machine>.<tailnet>.ts.net` with a real certificate. HTTPS and the
`funnel` node attribute must be enabled in the Tailscale admin console first. Browsers need such a certificate for
the service worker, so push notifications only work on that kind of address. Add the Funnel address to
`CORS_ALLOWED_ORIGINS` as described above.
