/**
 * A layer the page opens rarely (the shortcut sheet, the Clear-plan confirmation), kept out of the
 * first chunk: Astryx's Dialog and what it brings arrive with the idle prefetch after the first
 * paint (src/ui/deferred.tsx), or the first time the layer opens if that comes sooner. Until it
 * first opens nothing is mounted; once opened it stays mounted, so its closing motion and focus
 * return run as Astryx wrote them.
 *
 * If its code cannot arrive (a stale chunk after a redeploy, a dropped connection), the layer
 * reports itself closed, so the control that opened it works again, and the next opening asks
 * for the code afresh.
 */

import { useEffect, useState, type ComponentType } from "react";
import { loadable, useLoadable } from "./deferred";

/** What a lazily loaded layer is driven by: whether it is open, and how it says it closed. */
export interface LayerProps {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
}

/** The component `load` resolves to, mounted the first time it is open. */
export function lazyLayer<P extends LayerProps>(name: string, load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const code = loadable(name, load);
  function LazyLayer(props: P) {
    const [opened, setOpened] = useState(false);
    if (!opened && props.isOpen) setOpened(true);
    const { value: Layer } = useLoadable(code, false);
    const { onOpenChange } = props;
    // asked for when it first opens (unless the idle prefetch brought it already), and again on
    // the next opening after a failure; a fetch that fails closes the layer
    useEffect(() => {
      if (!opened || code.state().value !== null) return;
      let live = true;
      code.load().catch(() => {
        if (!live) return;
        setOpened(false);
        onOpenChange(false);
      });
      return () => {
        live = false;
      };
    }, [opened, onOpenChange]);
    return opened && Layer ? <Layer {...props} /> : null;
  }
  LazyLayer.displayName = `LazyLayer(${name})`;
  return LazyLayer;
}
