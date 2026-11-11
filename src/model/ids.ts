/**
 * Ids the page makes up. An entity's id only has to be unique within its plan, so a clock and
 * a counter are enough; a plan's own id must tell it apart from every other plan, on any
 * machine (the IFC export derives every GlobalId from it), so it is random.
 */

let idCounter = 0;

/** An id for a new entity of the plan: `prefix_<time>_<counter>`. */
export const uid = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/** Random bytes in a plan id: 128 bits, as many as a UUID carries. */
const PLAN_ID_BYTES = 16;

/** A new plan's identity: `plan_` and 128 random bits in hex. */
export function newPlanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PLAN_ID_BYTES));
  return `plan_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
