# Calendar

Group event scheduler. Serves the UI at `/` on port 3000. Test users come from `data/config.json` (seeded from `data/config.example.json`). Events persist in `data/events.json` (seeded from `data/events.example.json`).

This repo is the source of truth. The home portal vendor-copies it into `apps/calendar` with `portal-import.sh`.

## Run

```bash
npm install
npm start          # http://127.0.0.1:3000
npm test
```

`GET /health` returns 200 when ready. Durable writes stay under `./data`. This repo uses test users (`X-Test-User`) and simulated invitations. No TLS and no real login — the portal owns those.

## Import into the portal

From the portal repo:

```bash
./scripts/portal-import.sh ../calendar
./scripts/prod.sh
```

The iframe is already prefix-stripped, so this app must keep a base of `/` and relative fetches (`./api/events`), not `/calendar/api`.

## Import into the portal

From the portal repo:

```bash
./scripts/portal-import.sh ../calendar
./scripts/prod.sh
```

The iframe is already prefix-stripped, so this app must keep a base of `/` and relative fetches (`./api/events`), not `/calendar/api`.
