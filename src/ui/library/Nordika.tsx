/**
 * Nordika, the partner shop. It runs on its OWN ORIGIN inside an iframe that carries
 * `allow="tools"` (the `tools` Permissions Policy): that attribute is what lets the embedded
 * origin register WebMCP tools at all, and `exposedTo` on its side is what shares them with
 * this page. The agent then sees both toolsets at once and composes them. The frame here is
 * display-only, for the person; the page talks to the partner through SupplierBridge.
 *
 * "Pull catalogue" reads the partner's listing (a read: nothing in the plan changes, so
 * nothing is dispatched; malformed products are dropped and reported by the supplier boundary
 * itself). Choosing a product adopts it into the plan's catalogue through
 * dispatch({ type: "import_supplier_product" }) and starts placing it.
 */

import { useState } from "react";
import { pageActions } from "../../model/store";
import { dispatch } from "../../model/commands";
import { SUPPLIER_ORIGIN, listProducts, supplierFrameSrc, type SupplierProduct } from "../../mcp/supplier";
import { useAppStore } from "../useAppStore";
import { useShell } from "../shell/ShellContext";
import { useBreakpoint } from "../theme/media";
import { Badge, Button, EmptyState, IconChevronRight, IconDownload, Tip } from "../primitives";

type Transport = Awaited<ReturnType<typeof listProducts>>["transport"];

const TRANSPORT_WORDS: Record<string, string> = {
  webmcp: "Read through cross-origin WebMCP",
};
const transportWords = (t: Transport): string => TRANSPORT_WORDS[String(t)] ?? "Read through the postMessage fallback";

/** Prices read the way the rest of the page's English does: "€749". */
const PRICE_LOCALE = "en-GB";

function price(p: SupplierProduct): string {
  try {
    return new Intl.NumberFormat(PRICE_LOCALE, { style: "currency", currency: p.currency, maximumFractionDigits: 0 }).format(p.price);
  } catch {
    return `${p.price} ${p.currency}`;
  }
}

/** Rows shaped like the products that are coming, while the listing loads. */
function LoadingRows() {
  return (
    <ul className="products products--loading" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="product product--skeleton">
          <span className="product__swatch" />
          <span className="product__main">
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--meta" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProductRow({ product, onError }: { product: SupplierProduct; onError: (message: string) => void }) {
  const { setPanelOpen } = useShell();
  const narrow = useBreakpoint("drawer");
  const out = product.stock === 0;
  const choose = () => {
    if (out) return;
    const r = dispatch({ type: "import_supplier_product", product }, { actor: "human" });
    if (r.ok) {
      pageActions.setDrawMode("place", String(r.kind));
      if (narrow) setPanelOpen(false);
    } else onError(r.summary);
  };
  const row = (
    <button
      type="button"
      className="product"
      aria-disabled={out || undefined}
      aria-label={`${product.name}, ${product.w.toFixed(2)} × ${product.d.toFixed(2)} m, ${price(product)}${out ? ", out of stock" : ""}`}
      onClick={choose}
    >
      <span className="product__swatch" style={{ backgroundColor: product.color }} aria-hidden="true" />
      <span className="product__main">
        <span className="product__name">{product.name}</span>
        <span className="product__meta">
          <span className="num">
            {product.w.toFixed(2)} × {product.d.toFixed(2)} m
          </span>
          <span className="code">{product.sku}</span>
        </span>
      </span>
      <span className="product__end">
        <span className="product__price num">{price(product)}</span>
        <span className={out ? "product__stock product__stock--out" : "product__stock"}>{out ? "Out of stock" : `${product.stock} in stock`}</span>
      </span>
      {out ? null : <IconChevronRight size="sm" className="product__go" />}
    </button>
  );
  return <li>{out ? <Tip content="Out of stock at Nordika, so it cannot be placed">{row}</Tip> : row}</li>;
}

export function Nordika() {
  const supplierTools = useAppStore((s) => s.supplierTools);
  const [products, setProducts] = useState<SupplierProduct[] | null>(null);
  const [rejected, setRejected] = useState(0);
  const [transport, setTransport] = useState<Transport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pull = async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await listProducts({});
      setProducts(r.products);
      setRejected(r.rejected);
      setTransport(r.transport);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="nordika">
      <div className="nordika__intro">
        <div className="nordika__status">
          <Badge tone={supplierTools.length > 0 ? "agent" : "neutral"}>
            {supplierTools.length > 0 ? `${supplierTools.length} tools shared with your agent` : "No tools shared with your agent"}
          </Badge>
        </div>
        <p className="library-help">
          Nordika is a separate shop on its own site, publishing its stock as tools. Your agent can read it and put real products into this
          plan at their true size. Try asking it to <q>furnish the living room with in-stock Nordika pieces under €400</q>.
        </p>
        <p className="library-help">
          Its site: <span className="code">{SUPPLIER_ORIGIN}</span>
        </p>
      </div>

      <div className="nordika__pull">
        <Button variant="primary" icon={IconDownload} aria-busy={loading || undefined} disabledReason={loading ? "Reading Nordika's catalogue" : null} onClick={pull}>
          {loading ? "Pulling catalogue…" : products ? "Pull again" : "Pull catalogue"}
        </Button>
        {transport && !loading ? <span className="library-help">{transportWords(transport)}</span> : null}
      </div>

      {error ? (
        <p className="library-error" role="alert">
          Could not read Nordika's catalogue. {error}
        </p>
      ) : null}

      {loading ? (
        <LoadingRows />
      ) : products ? (
        products.length === 0 ? (
          <EmptyState title="Nordika lists no products right now" body="Pull again later, or furnish from the Alza catalogue." />
        ) : (
          <>
            <p className="library-help">Choose a product to add it to this plan's catalogue and start placing it.</p>
            <ul className="products" aria-label="Nordika products">
              {products.map((p) => (
                <ProductRow key={p.sku} product={p} onError={setError} />
              ))}
            </ul>
            {rejected > 0 ? (
              <p className="library-help">
                {rejected === 1 ? "One product was" : `${rejected} products were`} left out because Nordika sent incomplete data for{" "}
                {rejected === 1 ? "it" : "them"}.
              </p>
            ) : null}
          </>
        )
      ) : null}

      <details className="nordika__shop" open={!products}>
        <summary className="nordika__shop-summary">
          <IconChevronRight size="sm" className="nordika__shop-chevron" />
          Nordika's shop, as its own site shows it
        </summary>
        <iframe className="nordika__frame" src={supplierFrameSrc({ display: true })} title="Nordika supplier catalogue" allow="tools" />
      </details>
    </div>
  );
}
