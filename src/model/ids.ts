/**
 * Ids the page makes up. An entity's id only has to be unique within its plan, so a clock, a
 * counter and a few random characters for the page are enough: the tabs of a shared session
 * (src/session/) add to one plan, so two pages adding something in the same millisecond must
 * not make up the same id. A plan's own id must tell it apart from every other plan, on any
 * machine (the IFC export derives every GlobalId from it), so it is random.
 */

let idCounter = 0;

/** Random characters that tell this page's ids from another page's: base 36, so ids stay snake_case. */
const PAGE_TAG_CHARS = 4;
const pageTag = (): string =>
  [...crypto.getRandomValues(new Uint8Array(PAGE_TAG_CHARS))].map((b) => (b % 36).toString(36)).join("");
const PAGE_TAG = pageTag();

/** An id for a new entity of the plan: `prefix_<time><page>_<counter>`. */
export const uid = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${PAGE_TAG}_${(idCounter++).toString(36)}`;

/** Random bytes in a plan id: 128 bits, as many as a UUID carries. */
const PLAN_ID_BYTES = 16;

/** A new plan's identity: `plan_` and 128 random bits in hex. */
export function newPlanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PLAN_ID_BYTES));
  return `plan_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
