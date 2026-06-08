import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/main/log-service.js", () => ({
  writeRunLog: vi.fn(async () => path.join(os.tmpdir(), "renamer-test-log.json")),
  readLastLog: vi.fn(async () => null)
}));

const { executeRename } = await import("../../src/main/rename-service.js");

let tempDir;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "renamer-rename-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function renameItem(id, sourceName, targetName) {
  const originalPath = path.join(tempDir, sourceName);
  await fs.writeFile(originalPath, "");
  return {
    id,
    originalPath,
    proposedPath: path.join(tempDir, targetName),
    status: "ready"
  };
}

describe("rename executor", () => {
  it("emits extended rename progress with percent and ETA fields", async () => {
    const items = [await renameItem("1", "001.jpg", "renamed-001.jpg"), await renameItem("2", "002.jpg", "renamed-002.jpg")];
    const events = [];

    await executeRename(items, {}, { onProgress: (event) => events.push(event) });

    const renameEvents = events.filter((event) => event.stage === "renaming");
    expect(renameEvents[0]).toMatchObject({
      current: 0,
      total: 2,
      percent: 0,
      remainingMs: null
    });
    expect(renameEvents.at(-1)).toMatchObject({
      current: 2,
      total: 2,
      percent: 100,
      remainingMs: null
    });
    expect(renameEvents.at(-1).startedAt).toEqual(expect.any(Number));
    expect(renameEvents.at(-1).elapsedMs).toEqual(expect.any(Number));
    expect(renameEvents.some((event) => event.current === 1 && event.percent === 50)).toBe(true);
  });
});
