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
import { SUPPLIER_URL, attachSupplierFrame } from "../mcp/supplier";

export function SupplierBridge() {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const id = setTimeout(() => attachSupplierFrame(ref.current?.contentWindow ?? null), 300);
    return () => {
      clearTimeout(id);
      attachSupplierFrame(null);
    };
  }, []);

  return (
    <iframe
      ref={ref}
      className="supplier-bridge"
      src={`${SUPPLIER_URL}?host=${encodeURIComponent(location.origin)}`}
      title="Partner catalogue bridge"
      allow="tools"
      aria-hidden="true"
      tabIndex={-1}
      onLoad={() => attachSupplierFrame(ref.current?.contentWindow ?? null)}
    />
  );
}
