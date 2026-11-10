/**
 * Binary assets the plan refers to but does not hold — today, the blueprint underlay's image.
 *
 * The plan is plain, immutable data, and the undo history keeps the plans it replaced by
 * reference. An image inside the plan (it used to be a base64 data URL on the underlay) was
 * copied into every plan object the history kept and into every get_model answer, so a 1 MB
 * blueprint and sixty renames held fifty megabytes and the agent was sent the pixels it was
 * told it would never get. The plan now names its image by id, and the bytes live here once,
 * as a Blob, with an object URL made for it when something first needs to draw it.
 *
 * An asset lives exactly as long as something refers to it: the current plan, a plan in the
 * undo history, or whoever put it and has not let go yet (an upload between decoding the image
 * and the plan taking it). The store tells this module which ids its plans refer to after every
 * change (releaseUnreferencedAssets, wired in store.ts), and every asset that neither they nor a
 * holder keep is released — its object URL revoked and its Blob dropped — so an image leaves
 * memory when its last undo step does.
 *
 * Nothing here knows about the store, which is why the store can depend on it.
 */

import { UNDERLAY } from "./limits";

export type AssetId = string;

interface Asset {
  readonly blob: Blob;
  /** made on first use: an object URL pins the Blob in the browser until it is revoked */
  url: string | null;
  /** whether whoever put it still holds it; a held asset is kept even if no plan refers to it */
  held: boolean;
}

const assets = new Map<AssetId, Asset>();
let assetSeq = 0;

/**
 * Keep `blob` and return the id the plan refers to it by. The caller holds the new asset until
 * it calls letGoOfAsset (store.ts → releaseHeldAsset): after that it lives only as long as a
 * plan refers to it, and an image whose change was refused is released straight away.
 */
export function putAsset(blob: Blob): AssetId {
  const id = `asset_${Date.now().toString(36)}_${(assetSeq++).toString(36)}`;
  assets.set(id, { blob, url: null, held: true });
  return id;
}

/** Stop holding an asset put earlier. It is released by the next collection no plan refers to it in. */
export function letGoOfAsset(id: AssetId): void {
  const asset = assets.get(id);
  if (asset) asset.held = false;
}

export const hasAsset = (id: unknown): boolean => typeof id === "string" && assets.has(id);

/** The bytes of an asset, or undefined once it has been released. */
export const assetBlob = (id: AssetId): Blob | undefined => assets.get(id)?.blob;

/** A URL to draw the asset with (an <image> href), or null once it has been released. */
export function assetUrl(id: AssetId): string | null {
  const asset = assets.get(id);
  if (!asset) return null;
  asset.url ??= URL.createObjectURL(asset.blob);
  return asset.url;
}

/** How many assets are held right now. */
export const assetCount = (): number => assets.size;

/**
 * Release every asset that is neither in `referenced` nor held. Returns how many were released.
 * Called by the store with the ids its current plan and its undo history refer to.
 */
export function releaseUnreferencedAssets(referenced: ReadonlySet<AssetId>): number {
  let released = 0;
  for (const [id, asset] of assets) {
    if (asset.held || referenced.has(id)) continue;
    if (asset.url) URL.revokeObjectURL(asset.url);
    assets.delete(id);
    released++;
  }
  return released;
}

/**
 * Why `id` cannot be an underlay's image, or null when it can: it must be an asset this page
 * holds, an image, and no bigger than the copy the upload would ever keep.
 */
export function imageAssetError(id: unknown): string | null {
  if (!hasAsset(id)) return "assetId must name an image this page holds (upload the blueprint first).";
  const blob = assets.get(id as AssetId)!.blob;
  if (!blob.type.startsWith("image/")) return `The underlay asset is ${blob.type || "untyped"}, not an image.`;
  if (blob.size > UNDERLAY.maxStoredBytes) {
    return `The underlay image is too large to keep (${blob.size} bytes, max ${UNDERLAY.maxStoredBytes}).`;
  }
  return null;
}

/**
 * The Blob a `data:` URL encodes, without fetching it (a fetch of a data: URL is a network
 * request the page's connect-src does not allow). Used by the scripts' test hook, which
 * hands the page an image as text.
 */
export function blobFromDataUrl(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Not a data: URL.");
  const [, type, base64, payload] = match;
  if (!base64) return new Blob([decodeURIComponent(payload)], { type });
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
