# Calendar

Group event scheduler. Serves the UI at `/` on port 3000. In this repo, test users come from `data/config.json` (seeded from `data/config.example.json`). Events persist in `data/events.json` (seeded from `data/events.example.json`).

This repo is the source of truth. The home portal vendor-copies it into `apps/calendar` with `portal-import.sh`.

## Run

```bash
npm install
npm start          # http://127.0.0.1:3000
npm test
```

`GET /health` returns 200 when ready. Durable writes stay under `./data`. No TLS and no login page of its own — the portal owns those.

Standalone mode uses `X-Test-User` and a user switcher. Behind the portal, set `TRUST_PROXY_IDENTITY=1` and the app reads `X-Auth-Request-Email` / `X-Auth-Request-User` (the switcher is hidden). Event membership stays in this app; who can open `/calendar` stays in portal RBAC.

## Import into the portal

From the portal repo:

```bash
./scripts/portal-import.sh ../portal-calendar calendar
./scripts/prod.sh
```

The iframe is already prefix-stripped, so this app must keep a base of `/` and relative fetches (`./api/events`), not `/calendar/api`.
