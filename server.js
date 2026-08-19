import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./src/app.js";
import { createContext } from "./src/context.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(file) {
  if (!existsSync(file)) {
    return;
  }
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(root, ".env"));

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.CALENDAR_DATA_DIR || path.join(root, "data");

const configExamplePath = path.join(root, "data", "config.example.json");
const context = createContext({ dataDir, configExamplePath });
const app = createApp({
  dataDir,
  examplePath: path.join(root, "data", "events.example.json"),
  publicDir: path.join(root, "public"),
  templatesDir: path.join(root, "templates"),
  context,
  scheduleDigest: true,
});

app.listen(port, host, () => {
  console.log(`calendar listening on http://${host}:${port}`);
});
