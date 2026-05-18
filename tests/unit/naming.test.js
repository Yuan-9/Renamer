import { describe, expect, it } from "vitest";
import {
  applyExtensionCase,
  formatDateParts,
  formatIndex,
  normalizeMillisecond,
  renderTemplate,
  validateTemplate
} from "../../src/shared/naming.js";

describe("naming helpers", () => {
  it("validates required template rules", () => {
    expect(validateTemplate("{yyyy}_{MMdd}_{HHmmss}_{SSS}_{index}").ok).toBe(true);
    expect(validateTemplate("").ok).toBe(false);
    expect(validateTemplate("{yyyy}:{index}").ok).toBe(false);
    expect(validateTemplate("{yyyy}_{missing}_{index}").ok).toBe(false);
    expect(validateTemplate("{yyyy}_{MMdd}").ok).toBe(false);
  });

  it("formats dates with required token shapes", () => {
    const parts = formatDateParts(new Date("2026-05-17T19:30:25.128"));
    expect(parts).toMatchObject({
      yyyy: "2026",
      MM: "05",
      dd: "17",
      MMdd: "0517",
      HH: "19",
      mm: "30",
      ss: "25",
      HHmmss: "193025",
      SSS: "128"
    });
  });

  it("normalizes subseconds by padding on the right", () => {
    expect(normalizeMillisecond("1")).toBe(100);
    expect(normalizeMillisecond("12")).toBe(120);
    expect(normalizeMillisecond("128")).toBe(128);
    expect(normalizeMillisecond(null)).toBe(0);
  });

  it("formats conflict indexes", () => {
    expect(formatIndex(0)).toBe("00");
    expect(formatIndex(9)).toBe("09");
    expect(formatIndex(99)).toBe("99");
    expect(formatIndex(100)).toBe("100");
  });

  it("renders the default template and preserves original name token", () => {
    const item = {
      effectiveCapturedAt: "2026-05-17T19:30:25.128",
      millisecond: 128,
      originalNameWithoutExtension: "IMG_0001"
    };
    expect(renderTemplate("{yyyy}_{MMdd}_{HHmmss}_{SSS}_{index}", item, "00")).toBe("2026_0517_193025_128_00");
    expect(renderTemplate("{original}_{index}", item, "02")).toBe("IMG_0001_02");
  });

  it("applies extension case policy", () => {
    expect(applyExtensionCase(".JPG", "preserve")).toBe(".JPG");
    expect(applyExtensionCase(".JPG", "lower")).toBe(".jpg");
    expect(applyExtensionCase(".jpg", "upper")).toBe(".JPG");
  });
});
