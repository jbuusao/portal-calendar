# Calendar

Group event scheduler. Serves the UI at `/` on port 3000.

Standalone config lives in `data/config.json` (seeded from `data/config.example.json`). Events persist in `data/calendar.sqlite`. An existing `data/events.json` is imported once into an empty database. Standalone also seeds from `data/events.example.json` when the database is empty; embedded starts empty.

`src/context.js` is the app Context: it knows standalone vs portal-embedded, reads config, and returns the authenticated user (or `null`).

This repo is the source of truth. The home portal vendor-copies it into `apps/<slug>` with `portal-import.sh`. Import copies this config into `config/plugins.json` under that slug.

## Run

```bash
npm install
npm start          # http://127.0.0.1:3000
npm test
```

`GET /health` returns 200 when ready. Durable writes stay under `./data` (`calendar.sqlite`). Set `CALENDAR_DATA_DIR` to use a different directory — standalone and embedded must not share that path. No TLS and no login page of its own — the portal owns those.

Standalone mode uses `X-Test-User` and a user switcher. Behind the portal, `PORTAL_MODE=embedded` (set by Compose). Context then reads `config/plugins.json[<slug>]` and `X-Auth-Request-Email` / `X-Auth-Request-User`. Event membership stays in this app; who can open the app stays in portal RBAC.

## Import into the portal

From the portal repo:

```bash
./scripts/portal-import.sh ../portal-calendar calendar
./scripts/prod.sh
```

The iframe is already prefix-stripped, so this app must keep a base of `/` and relative fetches (`./api/events`), not `/calendar/api`.
