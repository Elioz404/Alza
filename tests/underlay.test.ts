/**
 * The blueprint upload's checks, which run before a single pixel is decoded: the file's type
 * and size, then the pixel size read from its header, and the stored size it decodes to.
 */
import { describe, expect, it } from "vitest";
import { UNDERLAY } from "../src/model/limits";
import { underlayFileError, underlayTargetSize } from "../src/ui/underlay";

describe("underlayFileError", () => {
  it("accepts the supported image types within the size limit", () => {
    for (const type of UNDERLAY.acceptedTypes) expect(underlayFileError({ type, size: 1024 })).toBeNull();
  });

  it.each(["application/pdf", "image/svg+xml", "text/html", ""])("refuses %s", (type) => {
    expect(underlayFileError({ type, size: 1024 })).toMatch(/not a supported image/);
  });

  it("refuses a file over the byte limit", () => {
    expect(underlayFileError({ type: "image/png", size: UNDERLAY.maxFileBytes + 1 })).toMatch(/MB/);
    expect(underlayFileError({ type: "image/png", size: UNDERLAY.maxFileBytes })).toBeNull();
  });
});

describe("underlayTargetSize", () => {
  it("caps the longest edge and keeps the aspect", () => {
    expect(underlayTargetSize(4000, 2000)).toEqual({ width: UNDERLAY.maxEdgePx, height: UNDERLAY.maxEdgePx / 2 });
    expect(underlayTargetSize(1000, 3000)).toEqual({ width: Math.round(UNDERLAY.maxEdgePx / 3), height: UNDERLAY.maxEdgePx });
  });

  it("never enlarges a small image", () => {
    expect(underlayTargetSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("refuses a source over the pixel budget, and one with no pixels", () => {
    const side = Math.ceil(Math.sqrt(UNDERLAY.maxSourcePixels)) + 1;
    expect(underlayTargetSize(side, side)).toHaveProperty("error");
    expect(underlayTargetSize(0, 100)).toHaveProperty("error");
    expect(underlayTargetSize(NaN, 100)).toHaveProperty("error");
  });
});
