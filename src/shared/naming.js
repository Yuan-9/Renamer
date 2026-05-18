import {
  DEFAULT_SETTINGS,
  ILLEGAL_FILENAME_CHARS,
  PHOTO_EXTENSIONS,
  TEMPLATE_TOKENS,
  VIDEO_EXTENSIONS
} from "./constants.js";

export function getMediaType(extension) {
  const lower = extension.toLowerCase();
  if (PHOTO_EXTENSIONS.includes(lower)) return "photo";
  if (VIDEO_EXTENSIONS.includes(lower)) return "video";
  return "unknown";
}

export function applyExtensionCase(extension, mode) {
  if (mode === "lower") return extension.toLowerCase();
  if (mode === "upper") return extension.toUpperCase();
  return extension;
}

export function pad(number, width) {
  return String(number).padStart(width, "0");
}

export function formatIndex(index) {
  return index < 100 ? pad(index, 2) : String(index);
}

export function normalizeMillisecond(value) {
  if (value === null || value === undefined || value === "") return 0;
  const raw = String(value).replace(/\D/g, "").slice(0, 3);
  if (!raw) return 0;
  return Number(raw.padEnd(3, "0"));
}

export function validateTemplate(template) {
  if (!template || !template.trim()) {
    return { ok: false, message: "命名模板不能为空。" };
  }
  if (ILLEGAL_FILENAME_CHARS.test(template)) {
    return { ok: false, message: "命名模板包含 Windows 文件名非法字符。" };
  }
  const matches = template.matchAll(/\{([^{}]+)\}/g);
  for (const match of matches) {
    if (!TEMPLATE_TOKENS.has(match[1])) {
      return { ok: false, message: `未知模板变量：{${match[1]}}。` };
    }
  }
  if (!template.includes("{index}")) {
    return { ok: false, message: "命名模板必须包含 {index}，用于稳定处理冲突。" };
  }
  return { ok: true, message: null };
}

export function formatDateParts(dateLike, millisecond = null) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const ms = millisecond === null || millisecond === undefined ? date.getMilliseconds() : millisecond;
  return {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1, 2),
    dd: pad(date.getDate(), 2),
    MMdd: `${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`,
    HH: pad(date.getHours(), 2),
    mm: pad(date.getMinutes(), 2),
    ss: pad(date.getSeconds(), 2),
    HHmmss: `${pad(date.getHours(), 2)}${pad(date.getMinutes(), 2)}${pad(date.getSeconds(), 2)}`,
    SSS: pad(ms, 3)
  };
}

export function renderTemplate(template, item, indexText) {
  const parts = formatDateParts(item.effectiveCapturedAt, item.millisecond);
  const values = {
    ...parts,
    index: indexText,
    original: item.originalNameWithoutExtension
  };
  return template.replace(/\{([^{}]+)\}/g, (_, token) => values[token] ?? "");
}

export function chooseEffectiveTime(item, settings = DEFAULT_SETTINGS) {
  if (item.capturedAt) {
    return {
      capturedAt: item.capturedAt,
      timeSource: item.timeSource,
      millisecond: item.millisecond ?? new Date(item.capturedAt).getMilliseconds()
    };
  }
  if (item.fileCreatedAt) {
    const date = new Date(item.fileCreatedAt);
    return {
      capturedAt: item.fileCreatedAt,
      timeSource: "File created time",
      millisecond: date.getMilliseconds()
    };
  }
  if (settings.useModifiedTimeFallback && item.fileModifiedAt) {
    const date = new Date(item.fileModifiedAt);
    return {
      capturedAt: item.fileModifiedAt,
      timeSource: "File modified time",
      millisecond: date.getMilliseconds()
    };
  }
  return { capturedAt: null, timeSource: null, millisecond: 0 };
}

export function mergeSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}
