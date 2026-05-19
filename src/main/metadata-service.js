import fs from "node:fs/promises";
import { normalizeMillisecond } from "../shared/naming.js";

let exiftoolPromise = null;

export const EXIFTOOL_READ_OPTIONS = {
  defaultVideosToUTC: false
};

export const EXIFTOOL_VIDEO_UTC_READ_OPTIONS = {
  defaultVideosToUTC: true
};

const VIDEO_UTC_TZ_SOURCES = new Set(["TimeZone", "GPSLatitude/GPSLongitude", "GeolocationTimeZone"]);

async function getExiftool() {
  if (!exiftoolPromise) {
    exiftoolPromise = import("exiftool-vendored")
      .then((module) => module.exiftool)
      .catch(() => null);
  }
  return exiftoolPromise;
}

export function parseExifDate(value) {
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

function diffMinutes(left, right) {
  return Math.abs(left.getTime() - right.getTime()) / 60000;
}

function makePickedTime(date, source, millisecond) {
  return {
    capturedAt: date.toISOString(),
    millisecond,
    timeSource: source
  };
}

function preferReferenceTime(candidates, referenceDate) {
  if (!referenceDate || candidates.length === 0) return candidates[0] ?? null;
  const first = candidates[0];
  const firstDiff = diffMinutes(first.date, referenceDate);
  const closer = candidates.find((candidate) => diffMinutes(candidate.date, referenceDate) <= 120);
  if (closer && diffMinutes(closer.date, referenceDate) + 5 < firstDiff) {
    return closer;
  }
  return first;
}

export function pickMetadataTime(tags, mediaType, options = {}) {
  const photoCandidates = [
    ["SubSecDateTimeOriginal", "EXIF SubSecDateTimeOriginal", []],
    ["DateTimeOriginal", "EXIF DateTimeOriginal", ["SubSecTimeOriginal"]],
    ["CreateDate", "EXIF CreateDate", ["SubSecCreateDate", "SubSecTimeDigitized"]],
    ["CreationDate", "Metadata CreationDate", []],
    ["ModifyDate", "EXIF ModifyDate", ["SubSecModifyDate"]]
  ];
  const videoCandidates = [
    ["CreationDate", "Video CreationDate", []],
    ["SubSecMediaCreateDate", "QuickTime SubSecMediaCreateDate", []],
    ["MediaCreateDate", "QuickTime MediaCreateDate", []],
    ["TrackCreateDate", "QuickTime TrackCreateDate", []],
    ["CreateDate", "QuickTime CreateDate", []],
    ["DateTimeOriginal", "Video DateTimeOriginal", ["SubSecTimeOriginal"]],
    ["CreationTime", "Video CreationTime", []],
    ["DateUTC", "Video DateUTC", []]
  ];
  const candidates = mediaType === "video" ? videoCandidates : photoCandidates;
  const matches = [];

  for (const [field, source, subsecondFields] of candidates) {
    const date = parseExifDate(tags?.[field]);
    if (date) {
      const subsecond = getSubsecond(tags, subsecondFields);
      if (subsecond !== null) date.setMilliseconds(subsecond);
      matches.push({
        date,
        millisecond: date.getMilliseconds(),
        source
      });
    }
  }

  const picked =
    mediaType === "video" ? preferReferenceTime(matches, options.referenceDate) : matches[0] ?? null;
  return picked ? makePickedTime(picked.date, picked.source, picked.millisecond) : null;
}

export function shouldReadVideoAsUtc(tags, mediaType) {
  return (
    mediaType === "video" &&
    (VIDEO_UTC_TZ_SOURCES.has(tags?.tzSource) ||
      Boolean(tags?.TimeZone) ||
      Boolean(tags?.OffsetTimeOriginal) ||
      Boolean(tags?.OffsetTimeDigitized) ||
      Boolean(tags?.OffsetTime))
  );
}

function shouldPreferUtcVideoRead(localPicked, utcPicked, referenceDate) {
  if (!localPicked?.capturedAt || !utcPicked?.capturedAt || !referenceDate) return false;
  const localDiff = diffMinutes(new Date(localPicked.capturedAt), referenceDate);
  const utcDiff = diffMinutes(new Date(utcPicked.capturedAt), referenceDate);
  return utcDiff <= 120 && localDiff - utcDiff >= 240;
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
      let tags = await exiftool.read(filePath, EXIFTOOL_READ_OPTIONS);
      let picked = pickMetadataTime(tags, mediaType, { referenceDate: stat.mtime });
      if (shouldReadVideoAsUtc(tags, mediaType)) {
        tags = await exiftool.read(filePath, EXIFTOOL_VIDEO_UTC_READ_OPTIONS);
        picked = pickMetadataTime(tags, mediaType, { referenceDate: stat.mtime });
      } else if (mediaType === "video" && picked?.capturedAt) {
        const localPicked = picked;
        if (diffMinutes(new Date(localPicked.capturedAt), stat.mtime) > 120) {
          const utcTags = await exiftool.read(filePath, EXIFTOOL_VIDEO_UTC_READ_OPTIONS);
          const utcPicked = pickMetadataTime(utcTags, mediaType, { referenceDate: stat.mtime });
          if (shouldPreferUtcVideoRead(localPicked, utcPicked, stat.mtime)) {
            picked = utcPicked;
          }
        }
      }
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
