import { ipcMain } from "electron";
import { ok, fail } from "../shared/response.js";
import { selectDirectory } from "./dialog-service.js";
import { scanDirectory } from "./scan-service.js";
import { buildPreview } from "./naming-service.js";
import { executeRename, undoLastRun } from "./rename-service.js";
import { exportLastLog } from "./log-service.js";
import { loadSettings, saveSettings } from "./settings-service.js";
import { getSystemInfo } from "./system-service.js";

let currentAbortController = null;

function progress(event, payload) {
  event.sender.send("task:progress", payload);
}

function guarded(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await handler(event, payload);
    } catch (error) {
      return fail(error.code ?? "UNEXPECTED_ERROR", error.message ?? "未知错误", {
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  });
}

export function registerIpcHandlers() {
  guarded("dialog:select-input-directory", async () => ok(await selectDirectory()));
  guarded("dialog:select-output-directory", async () => ok(await selectDirectory()));
  guarded("system:get-info", async () => ok(getSystemInfo()));

  guarded("scan:start", async (event, payload) => {
    currentAbortController = new AbortController();
    try {
      const data = await scanDirectory(payload, {
        signal: currentAbortController.signal,
        onProgress: (message) => progress(event, message)
      });
      return ok(data);
    } finally {
      currentAbortController = null;
    }
  });

  guarded("preview:build", async (event, payload) => {
    const data = await buildPreview(payload?.items ?? [], payload?.settings ?? {});
    return ok(data);
  });

  guarded("rename:execute", async (event, payload) => {
    currentAbortController = new AbortController();
    try {
      const data = await executeRename(payload?.items ?? [], payload?.settings ?? {}, {
        signal: currentAbortController.signal,
        onProgress: (message) => progress(event, message)
      });
      return ok(data);
    } finally {
      currentAbortController = null;
    }
  });

  guarded("task:cancel", async () => {
    currentAbortController?.abort();
    return ok({ cancelled: true });
  });

  guarded("log:export", async () => ok(await exportLastLog()));
  guarded("rename:undo-last", async (event) => {
    currentAbortController = new AbortController();
    try {
      const data = await undoLastRun({
        signal: currentAbortController.signal,
        onProgress: (message) => progress(event, message)
      });
      return ok(data);
    } finally {
      currentAbortController = null;
    }
  });
  guarded("settings:load", async () => ok(await loadSettings()));
  guarded("settings:save", async (event, payload) => ok(await saveSettings(payload ?? {})));
}
