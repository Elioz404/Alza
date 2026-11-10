/**
 * The shop window: the human-visible list of products.
 *
 * Built from DOM nodes and textContent only. The stock is static today, but a product name is
 * the kind of field that one day arrives from an API, and markup assembled from strings turns
 * that day into an XSS. Text set through textContent is never parsed as HTML.
 */

/** @param {number} price */
export const formatMoney = (price) => `€${price.toFixed(0)}`;

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
 * @param {{ sku: string, name: string, w: number, d: number, price: number, color: string, stock: number }} p
 * @returns {HTMLLIElement}
 */
export function productRow(p) {
  const li = /** @type {HTMLLIElement} */ (el("li", ""));
  const swatch = el("span", "swatch");
  // CSSOM, not a style attribute: no markup is parsed, and a strict style-src still allows it
  swatch.style.background = p.color;

  const mid = el("div", "");
  const dims = el("div", "dims", `${p.sku} · ${p.w.toFixed(2)} × ${p.d.toFixed(2)} m · `);
  if (p.stock === 0) dims.append(el("span", "oos", "out of stock"));
  else dims.append(`${p.stock} in stock`);
  mid.append(el("div", "name", p.name), dims);

  li.append(swatch, mid, el("div", "price", formatMoney(p.price)));
  return li;
}

/**
 * Replace the contents of `list` with one row per product.
 *
 * @param {HTMLElement} list
 * @param {readonly Parameters<typeof productRow>[0][]} products
 */
export function renderProducts(list, products) {
  list.replaceChildren(...products.map(productRow));
}
