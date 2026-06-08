import fs from "node:fs/promises";
import path from "node:path";
import { writeRunLog, readLastLog } from "./log-service.js";
import { createProgressReporter } from "./progress-service.js";

function ensureNotCancelled(signal) {
  if (signal?.aborted) {
    const error = new Error("任务已取消。");
    error.code = "TASK_CANCELLED";
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function samePathCaseInsensitive(a, b) {
  return path.resolve(a).toLocaleLowerCase() === path.resolve(b).toLocaleLowerCase();
}

async function renameSafely(sourcePath, targetPath) {
  const sourceExists = await pathExists(sourcePath);
  if (!sourceExists) {
    const error = new Error("源文件不存在。");
    error.code = "SOURCE_NOT_FOUND";
    throw error;
  }

  const targetDirectory = path.dirname(targetPath);
  const directoryStat = await fs.stat(targetDirectory).catch(() => null);
  if (!directoryStat?.isDirectory()) {
    const error = new Error("目标目录不存在。");
    error.code = "TARGET_DIRECTORY_MISSING";
    throw error;
  }

  if (sourcePath === targetPath) {
    return "skipped";
  }

  const caseOnly = samePathCaseInsensitive(sourcePath, targetPath);
  if (!caseOnly && (await pathExists(targetPath))) {
    const error = new Error("目标文件已存在。");
    error.code = "TARGET_EXISTS";
    throw error;
  }

  if (caseOnly) {
    const tempPath = path.join(targetDirectory, `.renamer-tmp-${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(sourcePath)}`);
    await fs.rename(sourcePath, tempPath);
    await fs.rename(tempPath, targetPath);
    return "success";
  }

  await fs.rename(sourcePath, targetPath);
  return "success";
}

function summarize(entries) {
  return entries.reduce(
    (summary, entry) => {
      summary.total += 1;
      if (entry.status === "success") summary.success += 1;
      else if (entry.status === "skipped") summary.skipped += 1;
      else summary.failed += 1;
      return summary;
    },
    { total: 0, success: 0, failed: 0, skipped: 0 }
  );
}

export async function executeRename(items, settings, options = {}) {
  const startedAt = new Date().toISOString();
  const readyItems = items.filter((item) => item.status === "ready" && item.proposedPath);
  const entries = [];
  const reportProgress = createProgressReporter(options.onProgress);

  reportProgress({ stage: "renaming", current: 0, total: readyItems.length, estimateRemaining: true });

  for (let index = 0; index < readyItems.length; index += 1) {
    ensureNotCancelled(options.signal);
    const item = readyItems[index];
    try {
      const result = await renameSafely(item.originalPath, item.proposedPath);
      entries.push({
        id: item.id,
        originalPath: item.originalPath,
        targetPath: item.proposedPath,
        status: result === "skipped" ? "skipped" : "success",
        error: null
      });
    } catch (error) {
      entries.push({
        id: item.id,
        originalPath: item.originalPath,
        targetPath: item.proposedPath,
        status: "failed",
        error: { code: error.code ?? "RENAME_FAILED", message: error.message }
      });
    }
    reportProgress({ stage: "renaming", current: index + 1, total: readyItems.length, estimateRemaining: true });
  }

  const summary = summarize(entries);
  const log = {
    appVersion: "0.1.0",
    type: "rename",
    startedAt,
    finishedAt: new Date().toISOString(),
    settings,
    summary,
    entries
  };
  const logPath = await writeRunLog(log);
  return { summary, entries, logPath };
}

export async function undoLastRun(options = {}) {
  const lastLog = await readLastLog();
  if (!lastLog || lastLog.type === "undo") {
    return { summary: { total: 0, success: 0, failed: 0, skipped: 0 }, entries: [], message: "没有可撤销的重命名记录。" };
  }

  const undoEntries = lastLog.entries.filter((entry) => entry.status === "success").reverse();
  const entries = [];
  const startedAt = new Date().toISOString();
  const reportProgress = createProgressReporter(options.onProgress);

  reportProgress({ stage: "undoing", current: 0, total: undoEntries.length, estimateRemaining: true });

  for (let index = 0; index < undoEntries.length; index += 1) {
    ensureNotCancelled(options.signal);
    const entry = undoEntries[index];
    try {
      const result = await renameSafely(entry.targetPath, entry.originalPath);
      entries.push({
        id: entry.id,
        originalPath: entry.targetPath,
        targetPath: entry.originalPath,
        status: result === "skipped" ? "skipped" : "success",
        error: null
      });
    } catch (error) {
      entries.push({
        id: entry.id,
        originalPath: entry.targetPath,
        targetPath: entry.originalPath,
        status: "failed",
        error: { code: error.code ?? "UNDO_FAILED", message: error.message }
      });
    }
    reportProgress({ stage: "undoing", current: index + 1, total: undoEntries.length, estimateRemaining: true });
  }

  const summary = summarize(entries);
  const logPath = await writeRunLog({
    appVersion: "0.1.0",
    type: "undo",
    startedAt,
    finishedAt: new Date().toISOString(),
    settings: lastLog.settings,
    summary,
    entries
  });
  return { summary, entries, logPath };
}
