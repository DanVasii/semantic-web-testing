import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import electronPath from "electron";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const rendererRoot = fileURLToPath(new URL("../src/renderer", import.meta.url));
const viteConfigPath = fileURLToPath(
  new URL("../vite.config.ts", import.meta.url),
);
const rendererUrl = "http://127.0.0.1:5173";

const viteServer = await createServer({
  configFile: viteConfigPath,
  mode: "development",
  root: rendererRoot,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});

await viteServer.listen();
viteServer.printUrls();

const electronProcess = spawn(electronPath, ["."], {
  cwd: projectRoot,
  env: {
    ...process.env,
    SEMANTIC_APP_RENDERER_URL: rendererUrl,
  },
  stdio: "inherit",
});

let isClosing = false;

const closeDevelopmentSession = async (exitCode) => {
  if (isClosing) {
    return;
  }

  isClosing = true;

  if (electronProcess.exitCode === null) {
    electronProcess.kill();
  }

  await viteServer.close();
  process.exitCode = exitCode;
};

electronProcess.once("error", (error) => {
  console.error("Electron development process failed to start.", error);
  void closeDevelopmentSession(1);
});

electronProcess.once("exit", (code) => {
  void closeDevelopmentSession(code ?? 1);
});

process.once("SIGINT", () => {
  void closeDevelopmentSession(0);
});

process.once("SIGTERM", () => {
  void closeDevelopmentSession(0);
});
