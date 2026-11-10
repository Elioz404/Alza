/**
 * Blueprint upload: turn a file the human picked into the underlay copy the page keeps.
 *
 * The file is untrusted and can be anything — a 200 MB TIFF, a PDF renamed .png, a
 * 30 000 × 30 000 scan. Decoding that at full size to then shrink it on a canvas is how a
 * tab runs out of memory, so the order is: check the declared type and the byte size, read
 * the pixel size from the header (no full decode), refuse what is too big, and then decode
 * straight to the stored size with createImageBitmap's resize options. Every limit is in
 * model/limits.ts → UNDERLAY.
 */

import { UNDERLAY } from "../model/limits";
import type { Underlay } from "../model/types";

/** Why this file cannot be used as an underlay, judged before reading a single pixel. */
export function underlayFileError(file: { type: string; size: number }): string | null {
  if (!UNDERLAY.acceptedTypes.includes(file.type)) {
    const accepted = UNDERLAY.acceptedTypes.map((t) => t.replace("image/", "")).join(", ");
    return `"${file.type || "unknown type"}" is not a supported image. Use ${accepted}.`;
  }
  if (file.size > UNDERLAY.maxFileBytes) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    return `The image is ${mb(file.size)} MB; the most the page accepts is ${mb(UNDERLAY.maxFileBytes)} MB.`;
  }
  return null;
}

/**
 * The stored size for a source of `width × height` pixels: the longest edge capped at
 * UNDERLAY.maxEdgePx, aspect kept, never enlarged. Refuses sources over the pixel budget.
 */
export function underlayTargetSize(width: number, height: number): { width: number; height: number } | { error: string } {
  if (!(width > 0 && height > 0)) return { error: "The image has no pixels." };
  if (width * height > UNDERLAY.maxSourcePixels) {
    const mp = (n: number) => (n / 1_000_000).toFixed(0);
    return { error: `The image is ${mp(width * height)} megapixels; the most the page accepts is ${mp(UNDERLAY.maxSourcePixels)}.` };
  }
  const scale = Math.min(1, UNDERLAY.maxEdgePx / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Pixel size from the header. An <img> reports it on load and decodes the pixels lazily, on draw. */
function intrinsicSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("The file could not be read as an image."));
    img.src = url;
  });
}

/** Read, bound and re-encode an uploaded blueprint into a ready-to-store underlay. */
export async function decodeUnderlay(file: File): Promise<Underlay> {
  const bad = underlayFileError(file);
  if (bad) throw new Error(bad);
  const url = URL.createObjectURL(file);
  try {
    const source = await intrinsicSize(url);
    const target = underlayTargetSize(source.width, source.height);
    if ("error" in target) throw new Error(target.error);
    const bitmap = await createImageBitmap(file, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "high",
    });
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser cannot draw the image.");
      ctx.drawImage(bitmap, 0, 0);
      const dataUrl = canvas.toDataURL(UNDERLAY.encodeType, UNDERLAY.encodeQuality);
      const aspect = source.height / source.width;
      return {
        dataUrl,
        opacity: UNDERLAY.defaultOpacity,
        x: 0,
        y: 0,
        w: UNDERLAY.defaultWidth,
        h: UNDERLAY.defaultWidth * aspect,
        pw: canvas.width,
        ph: canvas.height,
      };
    } finally {
      bitmap.close();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
