import fs from "node:fs/promises";
import { normalizeMillisecond } from "../shared/naming.js";

let exiftoolPromise = null;

async function getExiftool() {
  if (!exiftoolPromise) {
    exiftoolPromise = import("exiftool-vendored")
      .then((module) => module.exiftool)
      .catch(() => null);
  }
  return exiftoolPromise;
}

function parseExifDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  const normalized = text
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
    .replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSubsecond(tags, fields) {
  for (const field of fields) {
    const value = tags?.[field];
    if (value !== undefined && value !== null && value !== "") {
      return normalizeMillisecond(value);
    }
  }
  return null;
}

function pickMetadataTime(tags, mediaType) {
  const photoCandidates = [
    ["DateTimeOriginal", "EXIF DateTimeOriginal", ["SubSecTimeOriginal"]],
    ["CreateDate", "EXIF CreateDate", ["SubSecCreateDate", "SubSecTimeDigitized"]],
    ["ModifyDate", "EXIF ModifyDate", ["SubSecModifyDate"]]
  ];
  const videoCandidates = [
    ["CreateDate", "Video creation_time", []],
    ["MediaCreateDate", "Video creation_time", []],
    ["TrackCreateDate", "Video creation_time", []]
  ];
  const candidates = mediaType === "video" ? videoCandidates : photoCandidates;

  for (const [field, source, subsecondFields] of candidates) {
    const date = parseExifDate(tags?.[field]);
    if (date) {
      const subsecond = getSubsecond(tags, subsecondFields);
      if (subsecond !== null) date.setMilliseconds(subsecond);
      return {
        capturedAt: date.toISOString(),
        millisecond: date.getMilliseconds(),
        timeSource: source
      };
    }
  }

  return null;
}

export async function readMetadata(filePath, mediaType) {
  const stat = await fs.stat(filePath);
  const base = {
    fileCreatedAt: stat.birthtime.toISOString(),
    fileModifiedAt: stat.mtime.toISOString(),
    capturedAt: null,
    millisecond: 0,
    timeSource: null,
    metadataError: null
  };

  if (mediaType === "unknown") {
    return base;
  }

  try {
    const exiftool = await getExiftool();
    if (exiftool) {
      const tags = await exiftool.read(filePath);
      const picked = pickMetadataTime(tags, mediaType);
      if (picked) {
        return { ...base, ...picked };
      }
    }
  } catch (error) {
    base.metadataError = error.message;
  }

  return {
    ...base,
    capturedAt: base.fileCreatedAt,
    millisecond: stat.birthtime.getMilliseconds(),
    timeSource: "File created time"
  };
}
