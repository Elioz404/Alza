/**
 * The shop window: the human-visible list of products, grouped by room.
 *
 * Built from DOM nodes and textContent only. The stock is static today, but a product name is
 * the kind of field that one day arrives from an API, and markup assembled from strings turns
 * that day into an XSS. Text set through textContent is never parsed as HTML.
 */

/** @param {number} price */
export const formatMoney = (price) => `€${price.toFixed(0)}`;

/** @param {number} m */
const metres = (m) => m.toFixed(2);

/** How each category reads as a heading; an unknown one is shown as it is. */
const CATEGORY_TITLES = /** @type {Record<string, string>} */ ({
  living: "Living room",
  bedroom: "Bedroom",
  office: "Work",
  dining: "Dining",
});

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @typedef {{ sku: string, name: string, category?: string, w: number, d: number, price: number, color: string, stock: number }} Product
 */

/**
 * @param {Product} p
 * @returns {HTMLLIElement}
 */
export function productRow(p) {
  const out = p.stock === 0;
  const li = /** @type {HTMLLIElement} */ (el("li", out ? "product product--out" : "product"));
  const swatch = el("span", "product__swatch");
  // CSSOM, not a style attribute: no markup is parsed, and a strict style-src still allows it
  swatch.style.background = p.color;

  const mid = el("div", "product__main");
  const meta = el("div", "product__meta");
  meta.append(el("span", "product__dims", `${metres(p.w)} × ${metres(p.d)} m`), el("span", "product__sku", p.sku));
  mid.append(el("div", "product__name", p.name), meta);

  const end = el("div", "product__end");
  end.append(
    el("div", "product__price", formatMoney(p.price)),
    el("div", out ? "product__stock product__stock--out" : "product__stock", out ? "Out of stock" : `${p.stock} in stock`),
  );

  li.append(swatch, mid, end);
  return li;
}

/**
 * Replace the contents of `list` with the products, one group per category in the order the
 * categories first appear.
 *
 * @param {HTMLElement} list
 * @param {readonly Product[]} products
 */
export function renderProducts(list, products) {
  /** @type {Map<string, Product[]>} */
  const groups = new Map();
  for (const p of products) {
    const key = p.category ?? "";
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  const sections = [...groups].map(([category, items]) => {
    const li = el("li", "group");
    const head = el("h2", "group__title", CATEGORY_TITLES[category] ?? (category || "Other"));
    const rows = el("ul", "group__list");
    rows.append(...items.map(productRow));
    li.append(head, rows);
    return li;
  });
  list.replaceChildren(...sections);
}
