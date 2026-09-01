/**
 * Supplier panel — the partner catalogue, running on its OWN ORIGIN inside an iframe that
 * carries `allow="tools"` (the `tools` Permissions Policy). That attribute is what lets the
 * embedded origin register WebMCP tools at all; `exposedTo` on its side is what shares them
 * with this page. The agent then sees both toolsets at once and composes them.
 */

import { useState } from "react";
import { useAppStore, actions, logActivity } from "../model/store";
import { SUPPLIER_ORIGIN, SUPPLIER_URL, listProducts, type SupplierProduct } from "../mcp/supplier";

export function SupplierPanel() {
  const supplierTools = useAppStore((s) => s.supplierTools);
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [transport, setTransport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pull = async () => {
    setError(null);
    try {
      const { products: p, transport: t } = await listProducts({});
      setProducts(p);
      setTransport(t);
      logActivity("human", "get_supplier_catalog", `Pulled ${p.length} product(s) from ${SUPPLIER_ORIGIN} via ${t}.`, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="panel supplier-panel">
      <div className="supplier-head">
        <div>
          <strong>Nordika</strong> — partner origin
          <div className="supplier-origin">{SUPPLIER_ORIGIN}</div>
        </div>
        <span className={`pill ${supplierTools.length > 0 ? "live" : "off"}`}>
          {supplierTools.length > 0 ? `● ${supplierTools.length} cross-origin tools` : "○ no cross-origin tools"}
        </span>
      </div>

      <p className="supplier-hint">
        A second website, on its own origin, publishing its stock as WebMCP tools. Your agent can read it
        and drop real products into this plan at their true dimensions — ask it to
        <em> “furnish the living room with in-stock Nordika pieces under €400”</em>.
      </p>

      <iframe
        className="supplier-frame"
        src={`${SUPPLIER_URL}?host=${encodeURIComponent(location.origin)}&display=1`}
        title="Nordika supplier catalogue"
        allow="tools"
      />

      <div className="supplier-actions">
        <button onClick={pull}>Pull catalogue</button>
        {transport && (
          <span className="supplier-transport">
            via {transport === "webmcp" ? "cross-origin WebMCP" : "postMessage fallback"}
          </span>
        )}
      </div>
      {error && <p className="supplier-error">{error}</p>}

      {products.length > 0 && (
        <div className="supplier-list">
          {products.map((p) => (
            <button
              key={p.sku}
              className="supplier-row"
              disabled={p.stock === 0}
              title={p.stock === 0 ? "Out of stock at the supplier" : `${p.w} × ${p.d} m — click, then click on the plan`}
              onClick={() => {
                actions.importSupplierProduct(p);
                actions.setDrawMode("place", `nordika:${p.sku}`);
              }}
            >
              <span className="catalog-swatch" style={{ background: p.color }} />
              <span className="supplier-name">
                {p.name}
                <span className="supplier-dims">
                  {p.sku} · {p.w.toFixed(2)} × {p.d.toFixed(2)} m
                </span>
              </span>
              <span className="supplier-price">€{p.price}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
