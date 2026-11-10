/**
 * A layer the page opens rarely (the shortcut sheet, the Clear-plan confirmation), fetched the
 * first time it opens rather than with the page: Astryx's Dialog and what it brings stay out of
 * the first chunk. Until then nothing is mounted; once opened it stays mounted, so its closing
 * motion and focus return run as Astryx wrote them.
 *
 * If its code cannot arrive (a stale chunk after a redeploy, a dropped connection), the layer
 * reports itself closed, so the control that opened it works again, and the next opening asks
 * for the code afresh.
 */

import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from "react";

/** What a lazily loaded layer is driven by: whether it is open, and how it says it closed. */
export interface LayerProps {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
}

class LayerBoundary extends Component<{ children: ReactNode; onFailed: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[alza] a layer could not be loaded", error);
    this.props.onFailed();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The component `load` resolves to, fetched the first time it is open. */
export function lazyLayer<P extends LayerProps>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const make = () => lazy(() => load().then((C) => ({ default: C })));
  return function LazyLayer(props: P) {
    const [Layer, setLayer] = useState<ComponentType<P> | null>(null);
    if (!Layer && props.isOpen) setLayer(() => make());
    if (!Layer) return null;
    return (
      <LayerBoundary
        onFailed={() => {
          setLayer(null);
          props.onOpenChange(false);
        }}
      >
        <Suspense fallback={null}>
          <Layer {...props} />
        </Suspense>
      </LayerBoundary>
    );
  };
}
