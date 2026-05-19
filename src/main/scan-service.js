import fs from "node:fs/promises";
import path from "node:path";
import { mergeSettings, getMediaType } from "../shared/naming.js";
import { readMetadata } from "./metadata-service.js";
import { buildPreview } from "./naming-service.js";
import { getCpuCount, getDefaultMetadataConcurrency } from "./system-service.js";

function ensureNotCancelled(signal) {
  if (signal?.aborted) {
    const error = new Error("任务已取消。");
    error.code = "TASK_CANCELLED";
    throw error;
  }
}

function shouldIncludeMedia(mediaType, mediaFilter) {
  if (mediaFilter === "photo") return mediaType === "photo";
  if (mediaFilter === "video") return mediaType === "video";
  return true;
}

export function normalizeMetadataConcurrency(value, cpuCount = getCpuCount()) {
  const maxConcurrency = Math.max(1, cpuCount);
  const fallback = getDefaultMetadataConcurrency(maxConcurrency);
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxConcurrency, Math.max(1, Math.trunc(parsed)));
}

async function collectFiles(directory, settings, options, files = []) {
  ensureNotCancelled(options.signal);
  const entries = await fs.opendir(directory);
  for await (const entry of entries) {
    ensureNotCancelled(options.signal);
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && settings.recursive) {
      await collectFiles(fullPath, settings, options, files);
    } else if (entry.isFile()) {
      const extension = path.extname(entry.name);
      const mediaType = getMediaType(extension);
      if (mediaType === "unknown" && settings.mediaFilter === "all") {
        files.push(fullPath);
      } else if (mediaType !== "unknown" && shouldIncludeMedia(mediaType, settings.mediaFilter)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function createProgressReporter(onProgress) {
  const startedAt = Date.now();
  let currentStage = null;
  let stageStartedAt = startedAt;

  return ({ stage, current = 0, total = 0, estimateRemaining = false }) => {
    const now = Date.now();
    if (stage !== currentStage) {
      currentStage = stage;
      stageStartedAt = now;
    }

    const elapsedMs = now - startedAt;
    const stageElapsedMs = now - stageStartedAt;
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const remainingMs =
      estimateRemaining && current > 0 && total > current
        ? Math.max(0, Math.round((stageElapsedMs / current) * (total - current)))
        : null;

    onProgress?.({
      stage,
      current,
      total,
      percent,
      startedAt,
      elapsedMs,
      remainingMs
    });
  };
}

function createScanItem(filePath, index, settings, metadata) {
  const parsed = path.parse(filePath);
  const mediaType = getMediaType(parsed.ext);
  return {
    id: `${index}-${Buffer.from(filePath).toString("base64url")}`,
    originalPath: filePath,
    directory: parsed.dir,
    originalName: parsed.base,
    originalNameWithoutExtension: parsed.name,
    extension: parsed.ext,
    mediaType,
    ...metadata,
    proposedName: null,
    proposedPath: null,
    renameMode: settings.renameMode,
    outputDirectory: settings.outputDirectory,
    conflictIndex: null,
    status: "ready",
    message: metadata.metadataError ? `元数据读取失败，已使用文件时间：${metadata.metadataError}` : ""
  };
}

async function readMetadataItems(paths, settings, options, reportProgress) {
  const items = new Array(paths.length);
  const workerCount = Math.min(normalizeMetadataConcurrency(settings.metadataConcurrency), Math.max(1, paths.length));
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < paths.length) {
      ensureNotCancelled(options.signal);
      const index = nextIndex;
      nextIndex += 1;

      const filePath = paths[index];
      const mediaType = getMediaType(path.extname(filePath));
      const metadata = await readMetadata(filePath, mediaType);
      ensureNotCancelled(options.signal);

      items[index] = createScanItem(filePath, index, settings, metadata);
      completed += 1;
      if (completed % 10 === 0 || completed === paths.length) {
        reportProgress({
          stage: "reading-metadata",
          current: completed,
          total: paths.length,
          estimateRemaining: true
        });
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return items;
}

export async function scanDirectory(payload, options = {}) {
  const settings = mergeSettings(payload?.settings);
  const directory = payload?.directory;
  const reportProgress = createProgressReporter(options.onProgress);
  if (!directory) {
    const error = new Error("请选择输入文件夹。");
    error.code = "INPUT_DIRECTORY_REQUIRED";
    throw error;
  }

  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) {
    const error = new Error("输入文件夹不存在。");
    error.code = "INPUT_DIRECTORY_MISSING";
    throw error;
  }

  reportProgress({ stage: "collecting-files", current: 0, total: 0 });
  const paths = await collectFiles(directory, settings, options);

  reportProgress({ stage: "reading-metadata", current: 0, total: paths.length, estimateRemaining: true });
  const items = await readMetadataItems(paths, settings, options, reportProgress);

  reportProgress({ stage: "building-preview", current: paths.length, total: paths.length });
  const preview = await buildPreview(items, settings);
  reportProgress({ stage: "completed", current: paths.length, total: paths.length });
  return { directory, items: preview.items, summary: preview.summary };
}
