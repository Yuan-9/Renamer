import { describe, expect, it } from "vitest";
import {
  EXIFTOOL_READ_OPTIONS,
  EXIFTOOL_VIDEO_UTC_READ_OPTIONS,
  parseExifDate,
  pickMetadataTime,
  shouldReadVideoAsUtc
} from "../../src/main/metadata-service.js";

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
    expect(EXIFTOOL_VIDEO_UTC_READ_OPTIONS.defaultVideosToUTC).toBe(true);
  });

  it("uses UTC interpretation for videos with an explicit QuickTime timezone", () => {
    expect(shouldReadVideoAsUtc({ TimeZone: "+08:00" }, "video")).toBe(true);
    expect(shouldReadVideoAsUtc({ tzSource: "TimeZone" }, "video")).toBe(true);
    expect(shouldReadVideoAsUtc({ tzSource: "GPSLatitude/GPSLongitude" }, "video")).toBe(true);
    expect(shouldReadVideoAsUtc({ OffsetTimeOriginal: "+08:00" }, "video")).toBe(true);
    expect(shouldReadVideoAsUtc({ TimeZone: "+08:00" }, "photo")).toBe(false);
    expect(shouldReadVideoAsUtc({ MediaCreateDate: "2024:08:11 12:32:03" }, "video")).toBe(false);
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

  it("keeps QuickTime media creation time before video EXIF original time", () => {
    const picked = pickMetadataTime(
      {
        DateTimeOriginal: "2024:08:11 20:32:03",
        MediaCreateDate: "2024:08:11 12:32:03"
      },
      "video"
    );

    expect(picked.timeSource).toBe("QuickTime MediaCreateDate");
    expect(localParts(picked.capturedAt)).toMatchObject({
      HH: 12,
      mm: 32,
      ss: 3
    });
  });

  it("uses a later video candidate when it is much closer to the file modification time", () => {
    const picked = pickMetadataTime(
      {
        MediaCreateDate: "2025:11:01 08:20:25",
        CreateDate: "2025:10:31 22:10:57"
      },
      "video",
      { referenceDate: new Date("2025-10-31T22:10:57") }
    );

    expect(picked.timeSource).toBe("QuickTime CreateDate");
    expect(localParts(picked.capturedAt)).toMatchObject({
      dd: 31,
      HH: 22,
      mm: 10,
      ss: 57
    });
  });

  it("uses explicit video creation dates before QuickTime track dates", () => {
    const picked = pickMetadataTime(
      {
        CreationDate: "2024:08:11 12:32:03+08:00",
        MediaCreateDate: "2024:08:11 04:32:03"
      },
      "video"
    );

    expect(picked.timeSource).toBe("Video CreationDate");
    expect(localParts(picked.capturedAt)).toMatchObject({
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

  it("uses photo subsecond datetime before plain original datetime", () => {
    const picked = pickMetadataTime(
      {
        SubSecDateTimeOriginal: "2024:08:11 12:32:03.456",
        DateTimeOriginal: "2024:08:11 12:32:03"
      },
      "photo"
    );

    expect(picked.timeSource).toBe("EXIF SubSecDateTimeOriginal");
    expect(picked.millisecond).toBe(456);
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
