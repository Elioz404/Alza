/**
 * Astryx's gesture host gives every element it attaches recognizers to the `touch-action`
 * they leave the browser, through an attribute and one zero-specificity rule per value
 * (@astryxdesign/core/dist/gestures/touchActionRule.js). It writes those rules at run time: a
 * constructable stylesheet where the engine has one, a <style> element where it has none. The
 * strict CSP (style-src 'self') refuses the <style>, so on an engine without constructable
 * sheets the rules would be lost, and the page would no longer carry no injected styles at all.
 *
 * The values are a short, closed list (deriveTouchAction in gestures/touchAction.js:
 * `manipulation`, `none`, or pan-x / pan-y / pinch-zoom joined in that order), so the build
 * ships every rule in a static stylesheet, in the same `reset` layer, and replaces the writer
 * with one that only sets the attribute. tests/theme.test.ts holds this to the installed Astryx.
 *
 * Plain JavaScript, like the other files here: the Vite config and the tests load it as-is.
 */

/** The attribute the gesture host marks an element with; its value is the element's touch-action. */
export const TOUCH_ACTION_ATTRIBUTE = "data-astryx-touch-action";

/** The cascade layer Astryx puts the rules in: the first one, so every author rule outranks them. */
export const TOUCH_ACTION_LAYER = "reset";

/** The module the gesture host imports the writer from, as its path ends. */
export const TOUCH_ACTION_RULE_MODULE = "/@astryxdesign/core/dist/gestures/touchActionRule.js";

/** Every value deriveTouchAction can return, in the order it builds them. */
export function touchActionValues() {
  /** @type {string[]} */
  const values = ["manipulation", "none"];
  for (const panX of [true, false]) {
    for (const panY of [true, false]) {
      for (const pinchZoom of [true, false]) {
        const tokens = [panX ? "pan-x" : "", panY ? "pan-y" : "", pinchZoom ? "pinch-zoom" : ""].filter(Boolean);
        if (tokens.length > 0) values.push(tokens.join(" "));
      }
    }
  }
  return values;
}

/** One rule per value, as Astryx writes them, in Astryx's layer. */
export function touchActionCss() {
  const rules = touchActionValues()
    .map((value) => `:where([${TOUCH_ACTION_ATTRIBUTE}="${value}"]){touch-action:${value}}`)
    .join("\n  ");
  return `/* Astryx's touch-action rules, shipped static (config/astryxTouchAction.js). */\n@layer ${TOUCH_ACTION_LAYER} {\n  ${rules}\n}\n`;
}

/**
 * The writer the build puts in place of Astryx's: the same exports and the same answers, with
 * the rules already on the page, so it only marks the element. A detached element, or one in
 * no document or shadow root, is refused as Astryx refuses it, and the host looks again.
 */
export function touchActionRuleSource() {
  return `export const TOUCH_ACTION_ATTRIBUTE = ${JSON.stringify(TOUCH_ACTION_ATTRIBUTE)};
export function markTouchAction(element, value) {
  const root = element.getRootNode();
  if (!element.isConnected || !(root.nodeType === 9 || "host" in root)) return false;
  if (element.getAttribute(TOUCH_ACTION_ATTRIBUTE) !== value) element.setAttribute(TOUCH_ACTION_ATTRIBUTE, value);
  return true;
}
export function unmarkTouchAction(element) {
  element.removeAttribute(TOUCH_ACTION_ATTRIBUTE);
}
`;
}
