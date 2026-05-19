import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/shared/constants.js";

const mockState = vi.hoisted(() => ({
  delays: new Map(),
  readStarted: 0,
  activeReads: 0,
  maxActiveReads: 0
}));

vi.mock("../../src/main/metadata-service.js", () => ({
  readMetadata: vi.fn(async (filePath, mediaType) => {
    mockState.readStarted += 1;
    mockState.activeReads += 1;
    mockState.maxActiveReads = Math.max(mockState.maxActiveReads, mockState.activeReads);
    try {
      const fileName = filePath.split(/[\\/]/).pop();
      const delay = mockState.delays.get(fileName) ?? 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return {
        fileCreatedAt: "2026-05-17T19:30:25.128Z",
        fileModifiedAt: "2026-05-17T19:30:25.128Z",
        capturedAt: mediaType === "unknown" ? null : "2026-05-17T19:30:25.128Z",
        millisecond: 128,
        timeSource: mediaType === "unknown" ? null : "EXIF DateTimeOriginal",
        metadataError: null
      };
    } finally {
      mockState.activeReads -= 1;
    }
  })
}));

const { scanDirectory, normalizeMetadataConcurrency } = await import("../../src/main/scan-service.js");

let tempDir;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "renamer-scan-"));
  mockState.delays.clear();
  mockState.readStarted = 0;
  mockState.activeReads = 0;
  mockState.maxActiveReads = 0;
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function writeFiles(names) {
  for (const name of names) {
    await fs.writeFile(path.join(tempDir, name), "");
  }
}

function scan(settings = {}) {
  return scanDirectory({
    directory: tempDir,
    settings: {
      ...DEFAULT_SETTINGS,
      recursive: false,
      ...settings
    }
  });
}

describe("directory scanner", () => {
  it("normalizes metadata concurrency to the CPU range", () => {
    expect(normalizeMetadataConcurrency(null, 8)).toBe(7);
    expect(normalizeMetadataConcurrency("", 8)).toBe(7);
    expect(normalizeMetadataConcurrency(0, 8)).toBe(1);
    expect(normalizeMetadataConcurrency(99, 8)).toBe(8);
    expect(normalizeMetadataConcurrency(2.9, 8)).toBe(2);
    expect(normalizeMetadataConcurrency(null, 1)).toBe(1);
  });

  it("honors single metadata concurrency during scanning", async () => {
    await writeFiles(["001.jpg", "002.jpg", "003.jpg"]);
    for (const name of ["001.jpg", "002.jpg", "003.jpg"]) {
      mockState.delays.set(name, 10);
    }

    await scan({ metadataConcurrency: 1 });

    expect(mockState.maxActiveReads).toBe(1);
  });

  it("keeps scan order when metadata reads finish out of order", async () => {
    await writeFiles(["001-slow.jpg", "002-fast.jpg"]);
    mockState.delays.set("001-slow.jpg", 30);

    const result = await scan();

    expect(result.items.map((item) => item.originalName)).toEqual(["001-slow.jpg", "002-fast.jpg"]);
  });

  it("emits extended reading progress with percent and ETA fields", async () => {
    await writeFiles(["001.jpg", "002.jpg"]);
    const events = [];

    await scanDirectory(
      {
        directory: tempDir,
        settings: { ...DEFAULT_SETTINGS, recursive: false }
      },
      {
        onProgress: (event) => events.push(event)
      }
    );

    const readingEvents = events.filter((event) => event.stage === "reading-metadata");
    expect(readingEvents[0]).toMatchObject({
      current: 0,
      total: 2,
      percent: 0,
      remainingMs: null
    });
    expect(readingEvents.at(-1)).toMatchObject({
      current: 2,
      total: 2,
      percent: 100,
      remainingMs: null
    });
    expect(readingEvents.at(-1).startedAt).toEqual(expect.any(Number));
    expect(readingEvents.at(-1).elapsedMs).toEqual(expect.any(Number));
  });

  it("stops scanning when the current task is cancelled", async () => {
    await writeFiles(["001.jpg", "002.jpg", "003.jpg", "004.jpg"]);
    for (const name of ["001.jpg", "002.jpg", "003.jpg", "004.jpg"]) {
      mockState.delays.set(name, 250);
    }
    const controller = new AbortController();
    const promise = scanDirectory(
      {
        directory: tempDir,
        settings: { ...DEFAULT_SETTINGS, recursive: false }
      },
      { signal: controller.signal }
    );

    await vi.waitFor(() => expect(mockState.readStarted).toBeGreaterThan(0));
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: "TASK_CANCELLED" });
  });
});
