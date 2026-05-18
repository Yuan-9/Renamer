import fs from "node:fs/promises";
import path from "node:path";
import {
  applyExtensionCase,
  chooseEffectiveTime,
  formatIndex,
  mergeSettings,
  renderTemplate,
  validateTemplate
} from "../shared/naming.js";

function normalizeName(name) {
  return name.toLocaleLowerCase();
}

async function listDirectoryNames(directory) {
  try {
    const entries = await fs.readdir(directory);
    return new Set(entries.map(normalizeName));
  } catch {
    return new Set();
  }
}

function getTargetDirectory(item, settings) {
  return settings.renameMode === "move-to-directory" ? settings.outputDirectory : item.directory;
}

function sortForConflict(items) {
  return [...items].sort((a, b) => {
    const targetCompare = String(a.targetDirectory).localeCompare(String(b.targetDirectory), "zh-Hans-CN");
    if (targetCompare !== 0) return targetCompare;
    const timeCompare = String(a.effectiveCapturedAt).localeCompare(String(b.effectiveCapturedAt));
    if (timeCompare !== 0) return timeCompare;
    const nameCompare = a.originalName.localeCompare(b.originalName, "zh-Hans-CN");
    if (nameCompare !== 0) return nameCompare;
    return a.originalPath.localeCompare(b.originalPath, "zh-Hans-CN");
  });
}

function summarize(items) {
  return items.reduce(
    (summary, item) => {
      summary.total += 1;
      summary[item.status] = (summary[item.status] ?? 0) + 1;
      return summary;
    },
    { total: 0, ready: 0, warning: 0, conflict: 0, error: 0, skipped: 0, renamed: 0 }
  );
}

export async function buildPreview(rawItems, rawSettings) {
  const settings = mergeSettings(rawSettings);
  const templateCheck = validateTemplate(settings.template);
  const items = rawItems.map((item) => ({ ...item }));

  if (!templateCheck.ok) {
    const mapped = items.map((item) => ({
        ...item,
        proposedName: null,
        proposedPath: null,
        conflictIndex: null,
        status: item.mediaType === "unknown" ? "skipped" : "error",
        message: item.mediaType === "unknown" ? "不支持的文件类型。" : templateCheck.message
      }));
    return {
      items: mapped,
      summary: summarize(mapped),
      templateError: templateCheck.message
    };
  }

  if (settings.renameMode === "move-to-directory" && !settings.outputDirectory) {
    const mapped = items.map((item) => ({
      ...item,
      proposedName: null,
      proposedPath: null,
      conflictIndex: null,
      status: "error",
      message: "移动模式需要选择输出目录。"
    }));
    return { items: mapped, summary: summarize(mapped), templateError: null };
  }

  const prepared = items.map((item) => {
    if (item.mediaType === "unknown") {
      return {
        ...item,
        proposedName: null,
        proposedPath: null,
        conflictIndex: null,
        status: "skipped",
        message: "不支持的文件类型。"
      };
    }
    const effective = chooseEffectiveTime(item, settings);
    const targetDirectory = getTargetDirectory(item, settings);
    if (!effective.capturedAt) {
      return {
        ...item,
        targetDirectory,
        proposedName: null,
        proposedPath: null,
        conflictIndex: null,
        status: "skipped",
        message: "无法确定拍摄时间。"
      };
    }
    return {
      ...item,
      targetDirectory,
      effectiveCapturedAt: effective.capturedAt,
      millisecond: effective.millisecond,
      timeSource: effective.timeSource,
      status: "ready",
      message: item.message ?? ""
    };
  });

  const usedByDirectory = new Map();
  for (const directory of new Set(prepared.map((item) => item.targetDirectory).filter(Boolean))) {
    usedByDirectory.set(directory, await listDirectoryNames(directory));
  }

  const assigned = new Map(prepared.map((item) => [item.id, item]));
  for (const item of sortForConflict(prepared.filter((entry) => entry.status === "ready"))) {
    const used = usedByDirectory.get(item.targetDirectory) ?? new Set();
    const extension = applyExtensionCase(item.extension, settings.extensionCase);
    const ownOriginalName = normalizeName(item.originalName);

    let index = 0;
    let candidateName = null;
    while (index < 10000) {
      const indexText = formatIndex(index);
      candidateName = `${renderTemplate(settings.template, item, indexText)}${extension}`;
      const candidateKey = normalizeName(candidateName);
      if (!used.has(candidateKey) || candidateKey === ownOriginalName) {
        used.add(candidateKey);
        break;
      }
      index += 1;
    }

    if (index >= 10000) {
      assigned.set(item.id, {
        ...item,
        proposedName: null,
        proposedPath: null,
        conflictIndex: null,
        status: "conflict",
        message: "无法分配可用的冲突序号。"
      });
      continue;
    }

    const proposedPath = path.join(item.targetDirectory, candidateName);
    const samePath = proposedPath === item.originalPath;
    assigned.set(item.id, {
      ...item,
      proposedName: candidateName,
      proposedPath,
      renameMode: settings.renameMode,
      outputDirectory: settings.outputDirectory,
      conflictIndex: index,
      status: samePath ? "skipped" : "ready",
      message: samePath ? "名称未变化。" : item.message
    });
  }

  const mapped = prepared.map((item) => assigned.get(item.id) ?? item);
  return { items: mapped, summary: summarize(mapped), templateError: null };
}
