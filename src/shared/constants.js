export const PHOTO_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".webp",
  ".dng",
  ".raw",
  ".cr2",
  ".cr3",
  ".nef",
  ".arw",
  ".orf",
  ".rw2"
];

export const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
  ".wmv",
  ".mts",
  ".m2ts",
  ".3gp"
];

export const SUPPORTED_EXTENSIONS = [...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS];

export const DEFAULT_SETTINGS = {
  template: "{yyyy}_{MMdd}_{HHmmss}_{SSS}_{index}",
  extensionCase: "preserve",
  renameMode: "in-place",
  outputDirectory: null,
  recursive: true,
  useModifiedTimeFallback: false,
  mediaFilter: "all"
};

export const STATUS_LABELS = {
  all: "全部",
  ready: "可重命名",
  conflict: "冲突",
  warning: "警告",
  error: "错误",
  skipped: "跳过",
  renamed: "已完成"
};

export const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/;
export const TEMPLATE_TOKENS = new Set([
  "yyyy",
  "MM",
  "dd",
  "MMdd",
  "HH",
  "mm",
  "ss",
  "HHmmss",
  "SSS",
  "index",
  "original"
]);
