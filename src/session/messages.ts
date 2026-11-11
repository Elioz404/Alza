/**
 * What the tabs of a shared session say to each other, and the check every message passes before
 * the session does anything with it.
 *
 * A message is plain data (no functions, no code: nothing in it is ever run). Anything that is
 * not one of ours — another app on the channel, another version of this one, a message for
 * another tab, a malformed or oversized one — is ignored, never half-read: parseMessage answers
 * null. A write is checked against the kind of register it names (replica.ts): an entity against
 * the plan format's own record for it (model/planFormat.ts), with its id matching the register's,
 * an order against a list of ids, a setting against its text limit. Whatever a check strips (a
 * field the plan does not have) does not reach the plan.
 */

import { z } from "zod";
import { ENTITY_RECORDS } from "../model/planFormat";
import { NOTE_AUTHORS, PARTICIPANT_KINDS, PRESENCE_VIEWS, SESSION, TEXT, TOOL_NAME } from "../model/limits";
import { COLLECTIONS, PLAN_KEYS, type Collection, type Write } from "./replica";

/** Every message carries this, so another app's messages on the channel are told apart. */
export const APP = "alza";

/** A tab's id in the session: random, lowercase hex. */
export const TAB_ID = /^[0-9a-f]{16,64}$/;
const tabId = z.string().regex(TAB_ID);
const entityId = z.string().min(1).max(SESSION.maxKey);
const finite = z.number();
const clock = z.int().nonnegative();
/** a tool's or a command's name, as a feed line or an agent's label names it: never free text */
const toolName = z.string().max(TEXT.ref).regex(TOOL_NAME);

const noteRecord = z.object({ id: entityId, author: z.enum(NOTE_AUTHORS), text: z.string().max(TEXT.note), at: finite });

/** Each collection's record, as one register of it holds it: every entity on its level, as the current format has it. */
const onLevel = { levelId: entityId };
const R = ENTITY_RECORDS;
const RECORDS: Record<Collection, z.ZodType<Record<string, unknown>>> = {
  levels: R.levelRecord,
  walls: R.wallRecord.extend(onLevel),
  openings: R.openingRecord,
  rooms: R.roomRecord.extend(onLevel),
  items: R.itemRecord.extend(onLevel),
  stairs: R.stairRecord,
  kinds: R.kindRecord,
  notes: noteRecord,
};

const rawWrite = z.strictObject({ k: z.string().min(1).max(SESSION.maxKey), c: clock, t: tabId, v: z.unknown() });

const isCollection = (name: string): name is Collection => (COLLECTIONS as readonly string[]).includes(name);

/** A write checked against the register it names: the write with its checked value, or null. */
export function checkWrite(w: z.output<typeof rawWrite>): Write | null {
  const at = w.k.indexOf(":");
  const head = w.k.slice(0, at);
  const rest = w.k.slice(at + 1);
  if (at <= 0 || rest === "") return null;
  if (head === "plan") {
    if (!(PLAN_KEYS as readonly string[]).includes(rest)) return null;
    const max = rest === "name" ? TEXT.planName : TEXT.ref;
    const v = z.string().min(1).max(max).safeParse(w.v);
    return v.success ? { ...w, v: v.data } : null;
  }
  if (head === "order") {
    if (!isCollection(rest)) return null;
    const v = z.array(entityId).max(SESSION.maxWrites).safeParse(w.v);
    return v.success ? { ...w, v: v.data } : null;
  }
  if (!isCollection(head)) return null;
  if (w.v === null) return { ...w, v: null };
  const v = RECORDS[head].safeParse(w.v);
  if (!v.success) return null;
  const own = head === "kinds" ? v.data.kind : v.data.id;
  return own === rest ? { ...w, v: v.data } : null;
}

const writes = z.array(rawWrite).max(SESSION.maxWrites);

const point = z.strictObject({ x: finite, y: finite });

/** What a tab shares of its person (and its agent) while they work. */
const presenceState = z.strictObject({
  kind: z.enum(PARTICIPANT_KINDS),
  view: z.enum(PRESENCE_VIEWS),
  levelId: entityId.nullable(),
  selection: entityId.nullable(),
  /** null while the person does not share it, or their pointer is off the plan */
  pointer: point.nullable(),
  editing: z.array(entityId).max(SESSION.maxFocus),
  agent: z
    .strictObject({
      state: z.enum(["idle", "working", "waiting"]),
      tool: toolName.nullable(),
      focus: z.array(entityId).max(SESSION.maxFocus),
    })
    .nullable(),
});
export type PresenceStateMessage = z.output<typeof presenceState>;

const base = { app: z.literal(APP), protocol: z.literal(SESSION.protocol), from: tabId };

/** What a change was, for the other tabs' activity feeds. */
const meta = z.strictObject({
  actor: z.enum([...NOTE_AUTHORS, "system"]),
  as: toolName,
  summary: z.string().max(SESSION.maxSummary),
  /** the gesture it is a frame of: the other tabs fold its frames into one step, as this one does */
  gesture: z.string().max(TEXT.ref).nullable(),
});
export type ChangeMeta = z.output<typeof meta>;

const message = z.discriminatedUnion("type", [
  /** a tab arrived: whoever holds the plan answers with a snapshot */
  z.strictObject({ ...base, type: z.literal("hello"), startedAt: finite, established: z.boolean() }),
  /** every register, for the tab `to` */
  z.strictObject({ ...base, type: z.literal("snapshot"), to: tabId, startedAt: finite, established: z.boolean(), writes }),
  /** a change */
  z.strictObject({ ...base, type: z.literal("ops"), writes, meta }),
  /** where its person is, and what its agent does */
  z.strictObject({ ...base, type: z.literal("presence"), startedAt: finite, state: presenceState }),
  /** the tab is closing */
  z.strictObject({ ...base, type: z.literal("bye") }),
]);

type Raw = z.output<typeof message>;
type Checked<M> = M extends { writes: unknown } ? Omit<M, "writes"> & { writes: Write[] } : M;
export type SessionMessage = Checked<Raw>;
/** A message as it is sent: what the parse gives back, before the channel copies it. */
export type OutgoingMessage = SessionMessage;

/**
 * `data` as one of this app's messages for tab `self`, or null: not ours, not for this tab, from
 * this tab itself, malformed, or carrying a write that does not hold what its register should.
 */
export function parseMessage(data: unknown, self: string): SessionMessage | null {
  const parsed = message.safeParse(data);
  if (!parsed.success) return null;
  const m = parsed.data;
  if (m.from === self) return null;
  if (m.type === "snapshot" && m.to !== self) return null;
  if (m.type !== "snapshot" && m.type !== "ops") return m;
  const checked: Write[] = [];
  for (const w of m.writes) {
    const ok = checkWrite(w);
    if (!ok) return null;
    checked.push(ok);
  }
  return { ...m, writes: checked };
}
