/**
 * A view whose code is fetched the first time it is shown, which can fail to arrive: a
 * stale hashed chunk after a redeploy, a dropped connection, an offline tab. React rethrows a
 * rejected lazy import while rendering, and Suspense does not catch it — without a boundary the
 * whole root unmounts, and the editor, the sidebar and the approval bar go with the one view
 * that failed. Here the failure stays inside the view's own box, which offers to try again.
 *
 * React keeps a lazy component's rejected import for good, so trying again makes a new lazy
 * component around a fresh import rather than re-rendering the failed one.
 */

import { Component, Suspense, lazy, useCallback, useState, type ComponentType, type ReactNode } from "react";

/** A module loader in the shape React.lazy takes. */
export type ViewLoader = () => Promise<{ default: ComponentType }>;

interface BoundaryProps {
  /** what to show in the view's place when its code could not be loaded */
  failed: (retry: () => void) => ReactNode;
  onRetry: () => void;
  children: ReactNode;
}

class LoadBoundary extends Component<BoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.warn("[alza] a view could not be loaded", error);
  }

  private retry = () => {
    this.setState({ error: null });
    this.props.onRetry();
  };

  render() {
    return this.state.error ? this.props.failed(this.retry) : this.props.children;
  }
}

interface LazyViewProps {
  load: ViewLoader;
  /** shown while the code is on its way */
  loading: ReactNode;
  failed: (retry: () => void) => ReactNode;
}

export function LazyView({ load, loading, failed }: LazyViewProps) {
  const [View, setView] = useState(() => lazy(load));
  const retry = useCallback(() => setView(() => lazy(load)), [load]);
  return (
    <LoadBoundary failed={failed} onRetry={retry}>
      <Suspense fallback={loading}>
        <View />
      </Suspense>
    </LoadBoundary>
  );
}
