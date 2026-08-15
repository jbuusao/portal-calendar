# Calendar

Standalone month grid. Serves the UI at `/` on port 3000. Events persist in `data/events.json` (seeded from `data/events.example.json`).

This repo is the source of truth. The home portal vendor-copies it into `apps/calendar` with `portal-import.sh`.

## Run

```bash
npm install
npm start          # http://127.0.0.1:3000
npm test
```

`GET /health` returns 200 when ready. Durable writes stay under `./data`. No TLS and no login — the portal owns those.

## Import into the portal

From the portal repo:

```bash
./scripts/portal-import.sh ../calendar
./scripts/prod.sh
```

The iframe is already prefix-stripped, so this app must keep a base of `/` and relative fetches (`./api/events`), not `/calendar/api`.
