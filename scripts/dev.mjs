import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const server = await createServer({
  root,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false
  }
});

await server.listen();
const info = server.resolvedUrls?.local?.[0] ?? "http://127.0.0.1:5173/";

const electronBinary = process.platform === "win32" ? "electron.cmd" : "electron";
const electron = spawn(electronBinary, ["."], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: info
  }
});

electron.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

process.on("SIGINT", async () => {
  electron.kill();
  await server.close();
  process.exit(0);
});
