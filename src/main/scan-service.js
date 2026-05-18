import fs from "node:fs/promises";
import path from "node:path";
import { mergeSettings, getMediaType } from "../shared/naming.js";
import { readMetadata } from "./metadata-service.js";
import { buildPreview } from "./naming-service.js";

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

export async function scanDirectory(payload, options = {}) {
  const settings = mergeSettings(payload?.settings);
  const directory = payload?.directory;
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

  options.onProgress?.({ stage: "collecting-files", current: 0, total: 0 });
  const paths = await collectFiles(directory, settings, options);
  const items = [];

  options.onProgress?.({ stage: "reading-metadata", current: 0, total: paths.length });
  for (let index = 0; index < paths.length; index += 1) {
    ensureNotCancelled(options.signal);
    const filePath = paths[index];
    const parsed = path.parse(filePath);
    const mediaType = getMediaType(parsed.ext);
    const metadata = await readMetadata(filePath, mediaType);
    items.push({
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
    });
    if (index % 10 === 0 || index + 1 === paths.length) {
      options.onProgress?.({ stage: "reading-metadata", current: index + 1, total: paths.length });
    }
  }

  options.onProgress?.({ stage: "building-preview", current: paths.length, total: paths.length });
  const preview = await buildPreview(items, settings);
  options.onProgress?.({ stage: "completed", current: paths.length, total: paths.length });
  return { directory, items: preview.items, summary: preview.summary };
}
