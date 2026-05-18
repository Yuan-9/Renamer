import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../shared/constants.js";
import { mergeSettings } from "../shared/naming.js";

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

export async function loadSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    return mergeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  const merged = mergeSettings(settings);
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
