import { app, dialog } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

let lastLogPath = null;

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function getLogsDirectory() {
  return path.join(app.getPath("userData"), "logs");
}

export async function writeRunLog(log) {
  await fs.mkdir(getLogsDirectory(), { recursive: true });
  const filePath = path.join(getLogsDirectory(), `rename-${stamp()}.json`);
  await fs.writeFile(filePath, JSON.stringify(log, null, 2), "utf8");
  lastLogPath = filePath;
  return filePath;
}

export async function readLastLog() {
  if (!lastLogPath) return null;
  try {
    return JSON.parse(await fs.readFile(lastLogPath, "utf8"));
  } catch {
    return null;
  }
}

export async function exportLastLog() {
  if (!lastLogPath) {
    return { exported: false, path: null, message: "还没有可导出的日志。" };
  }
  const result = await dialog.showSaveDialog({
    defaultPath: path.basename(lastLogPath),
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) {
    return { exported: false, path: null };
  }
  await fs.copyFile(lastLogPath, result.filePath);
  return { exported: true, path: result.filePath };
}
