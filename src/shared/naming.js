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

function parseIndexToken(token) {
  const match = /^index(?::([1-9]\d?|0{2,})?)?$/.exec(token);
  if (!match) return null;
  if (!match[1]) return { width: 2 };
  if (/^0+$/.test(match[1])) return { width: match[1].length };
  const width = Number(match[1]);
  if (width < 1 || width > 99) return null;
  return { width };
}

function isTemplateTokenAllowed(token) {
  return TEMPLATE_TOKENS.has(token) || parseIndexToken(token) !== null;
}

export function formatIndex(index, width = 2) {
  return pad(index, width);
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
  const literalTemplateText = template.replace(/\{[^{}]*\}/g, "");
  if (ILLEGAL_FILENAME_CHARS.test(literalTemplateText)) {
    return { ok: false, message: "命名模板包含 Windows 文件名非法字符。" };
  }
  const matches = template.matchAll(/\{([^{}]+)\}/g);
  let hasIndex = false;
  for (const match of matches) {
    const token = match[1];
    if (!isTemplateTokenAllowed(token)) {
      return { ok: false, message: `未知模板变量：{${match[1]}}。` };
    }
    if (parseIndexToken(token)) hasIndex = true;
  }
  if (!hasIndex) {
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

export function renderTemplate(template, item, index) {
  const parts = formatDateParts(item.effectiveCapturedAt, item.millisecond);
  const values = {
    ...parts,
    original: item.originalNameWithoutExtension
  };
  const numericIndex = Number.parseInt(index, 10);
  return template.replace(/\{([^{}]+)\}/g, (_, token) => {
    const indexToken = parseIndexToken(token);
    if (indexToken) return formatIndex(Number.isNaN(numericIndex) ? 0 : numericIndex, indexToken.width);
    return values[token] ?? "";
  });
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
