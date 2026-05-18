import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/shared/constants.js";
import { buildPreview } from "../../src/main/naming-service.js";

let tempDir;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "renamer-preview-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function item(name, capturedAt = "2026-05-17T19:30:25.128Z") {
  const parsed = path.parse(path.join(tempDir, name));
  return {
    id: name,
    originalPath: path.join(tempDir, name),
    directory: tempDir,
    originalName: parsed.base,
    originalNameWithoutExtension: parsed.name,
    extension: parsed.ext,
    mediaType: "photo",
    capturedAt,
    millisecond: 128,
    timeSource: "EXIF DateTimeOriginal",
    fileCreatedAt: null,
    fileModifiedAt: null,
    message: ""
  };
}

describe("preview builder", () => {
  it("assigns stable conflict indexes", async () => {
    const preview = await buildPreview([item("IMG_0002.JPG"), item("IMG_0001.JPG")], DEFAULT_SETTINGS);
    const names = preview.items.map((entry) => entry.proposedName).sort();
    expect(names).toEqual(["2026_0517_193025_128_00.JPG", "2026_0517_193025_128_01.JPG"]);
    expect(preview.summary.ready).toBe(2);
  });

  it("skips existing target names by incrementing index", async () => {
    await fs.writeFile(path.join(tempDir, "2026_0517_193025_128_00.JPG"), "");
    const preview = await buildPreview([item("IMG_0001.JPG")], DEFAULT_SETTINGS);
    expect(preview.items[0].proposedName).toBe("2026_0517_193025_128_01.JPG");
  });

  it("marks unsupported files as skipped", async () => {
    const preview = await buildPreview(
      [
        {
          ...item("notes.txt"),
          extension: ".txt",
          mediaType: "unknown"
        }
      ],
      DEFAULT_SETTINGS
    );
    expect(preview.items[0].status).toBe("skipped");
  });
});
