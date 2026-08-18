import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./src/app.js";
import { createContext } from "./src/context.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.CALENDAR_DATA_DIR || path.join(root, "data");

const configExamplePath = path.join(root, "data", "config.example.json");
const context = createContext({ dataDir, configExamplePath });
const app = createApp({
  dataDir,
  examplePath: path.join(root, "data", "events.example.json"),
  publicDir: path.join(root, "public"),
  context,
});

app.listen(port, host, () => {
  console.log(`calendar listening on http://${host}:${port}`);
});
