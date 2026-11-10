/**
 * The catalogue's thumbnail renderer, loaded on demand.
 *
 * Thumbnails are drawn by three.js (three/thumbnails.ts), and three.js is most of the page's
 * weight. Importing it statically put it in the first chunk, so the 2D editor waited for a 3D
 * engine it does not use. The renderer is imported the first time a catalogue asks for it;
 * until it arrives the cards show their colour swatch, and then every card re-renders with its
 * picture. The import is shared, so it happens once however many components ask.
 */

import { useEffect, useState } from "react";
import type { KindDef } from "../model/types";

type ThumbnailFor = (def: KindDef) => string | null;

let loaded: ThumbnailFor | null = null;
let loading: Promise<ThumbnailFor> | null = null;

const load = (): Promise<ThumbnailFor> =>
  (loading ??= import("../three/thumbnails").then((m) => (loaded = m.thumbnailFor)));

/** The thumbnail renderer once it has loaded, or null until then (the import starts on first use). */
export function useThumbnails(): ThumbnailFor | null {
  const [thumbnailFor, setThumbnailFor] = useState<ThumbnailFor | null>(() => loaded);
  useEffect(() => {
    if (thumbnailFor) return;
    let live = true;
    load().then(
      (fn) => live && setThumbnailFor(() => fn),
      (err) => console.warn("[thumbnails] could not load the 3D renderer; the catalogue keeps its swatches", err),
    );
    return () => {
      live = false;
    };
  }, [thumbnailFor]);
  return thumbnailFor;
}
