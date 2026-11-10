/**
 * The partner origin, mounted once for the whole session.
 *
 * On a WebMCP runtime the cross-origin call goes through `executeTool()` and needs no frame at
 * all — but the postMessage fallback does, and an agent can call `get_supplier_catalog` at any
 * moment, not only while the human happens to be looking at the Supplier tab. So the transport
 * frame lives here, always mounted; the Supplier panel renders its own visible copy for the
 * human. `allow="tools"` is the `tools` Permissions Policy that lets the embedded origin
 * register WebMCP tools in the first place.
 */

import { useEffect, useRef } from "react";
import { registerSupplierFrame, supplierFrameSrc } from "../mcp/supplier";

export function SupplierBridge() {
  const ref = useRef<HTMLIFrameElement>(null);
  /** Undoes the current registration; this component owns the transport's frame for its lifetime. */
  const release = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
    },
    [],
  );

  // Registered on load, not on mount: before the partner page is in the frame, a message
  // addressed to the partner's origin would be dropped by the browser and only time out.
  const onLoad = () => {
    release.current?.();
    const win = ref.current?.contentWindow;
    release.current = win ? registerSupplierFrame(win) : null;
  };

  return (
    <iframe
      ref={ref}
      className="supplier-bridge"
      src={supplierFrameSrc()}
      title="Partner catalogue bridge"
      allow="tools"
      aria-hidden="true"
      tabIndex={-1}
      onLoad={onLoad}
    />
  );
}
