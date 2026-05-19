import { describe, expect, it } from "vitest";
import { EXIFTOOL_READ_OPTIONS, parseExifDate, pickMetadataTime } from "../../src/main/metadata-service.js";

function localParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  return {
    yyyy: date.getFullYear(),
    MM: date.getMonth() + 1,
    dd: date.getDate(),
    HH: date.getHours(),
    mm: date.getMinutes(),
    ss: date.getSeconds()
  };
}

describe("metadata time selection", () => {
  it("disables ExifTool's default UTC assumption for videos", () => {
    expect(EXIFTOOL_READ_OPTIONS.defaultVideosToUTC).toBe(false);
  });

  it("parses datestamps without a timezone as local wall time", () => {
    const date = parseExifDate("2024:08:11 12:32:03");

    expect(localParts(date)).toEqual({
      yyyy: 2024,
      MM: 8,
      dd: 11,
      HH: 12,
      mm: 32,
      ss: 3
    });
  });

  it("prefers video media creation time before container creation time", () => {
    const picked = pickMetadataTime(
      {
        CreateDate: "2024:08:11 04:32:03",
        MediaCreateDate: "2024:08:11 12:32:03",
        TrackCreateDate: "2024:08:11 09:32:03"
      },
      "video"
    );

    expect(picked.timeSource).toBe("QuickTime MediaCreateDate");
    expect(localParts(picked.capturedAt)).toMatchObject({
      yyyy: 2024,
      MM: 8,
      dd: 11,
      HH: 12,
      mm: 32,
      ss: 3
    });
  });

  it("falls back to video track creation time before container creation time", () => {
    const picked = pickMetadataTime(
      {
        CreateDate: "2024:08:11 04:32:03",
        TrackCreateDate: "2024:08:11 12:32:03"
      },
      "video"
    );

    expect(picked.timeSource).toBe("QuickTime TrackCreateDate");
    expect(localParts(picked.capturedAt)).toMatchObject({
      HH: 12,
      mm: 32,
      ss: 3
    });
  });

  it("keeps photo original date as the first choice", () => {
    const picked = pickMetadataTime(
      {
        DateTimeOriginal: "2024:08:11 12:32:03",
        CreateDate: "2024:08:11 04:32:03"
      },
      "photo"
    );

    expect(picked.timeSource).toBe("EXIF DateTimeOriginal");
    expect(localParts(picked.capturedAt)).toMatchObject({
      HH: 12,
      mm: 32,
      ss: 3
    });
  });
});
