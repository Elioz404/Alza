/**
 * The STEP physical file (ISO 10303-21) the IFC model is written in: values, their encoding,
 * entity instances with their #ids, and the file around them. It knows nothing about IFC or
 * about plans; the mapping layer (model.ts) builds entities through it.
 *
 * Encoding rules (ISO 10303-21:2016, clause 6 and 7):
 *  - an entity instance is `#id=NAME(attr,attr,…);`, its #id unique and positive;
 *  - a string is in apostrophes; an apostrophe in it is doubled and a reverse solidus doubled;
 *    a character outside printable ASCII (U+0020–U+007E) is written as `\X2\hhhh…\X0\`
 *    (UCS-2, four hex digits per character) or, outside the Basic Multilingual Plane,
 *    `\X4\hhhhhhhh…\X0\`;
 *  - a real always has a decimal point (`3.`, `0.25`), an integer never does;
 *  - an enumeration is `.NAME.`, a boolean `.T.` / `.F.`;
 *  - `$` is an unset optional attribute, `*` an attribute a supertype derives;
 *  - a list is `(a,b,…)`, a typed value `TYPENAME(value)`.
 */

import { REAL_DECIMALS, REAL_FIXED_LIMIT, STEP_LABEL_MAX } from "./config";

/** A reference to an entity instance, typed by the entity's name so attributes can ask for one kind. */
export interface Ref<T extends string = string> {
  readonly k: "ref";
  readonly id: number;
  readonly type: T;
}

export type StepValue =
  | Ref
  | { readonly k: "real"; readonly v: number }
  | { readonly k: "int"; readonly v: number }
  | { readonly k: "str"; readonly v: string }
  | { readonly k: "enum"; readonly v: string }
  | { readonly k: "bool"; readonly v: boolean }
  | { readonly k: "unset" }
  | { readonly k: "derived" }
  | { readonly k: "list"; readonly items: readonly StepValue[] }
  | { readonly k: "typed"; readonly type: string; readonly value: StepValue };

/** A STEP identifier: what an entity name, an enumeration value and a type name may be. */
const IDENTIFIER = /^[A-Z][A-Z0-9_]*$/;

const identifier = (name: string): string => {
  const upper = name.toUpperCase();
  if (!IDENTIFIER.test(upper)) throw new Error(`"${name}" is not a STEP identifier.`);
  return upper;
};

export const real = (v: number): StepValue => {
  if (!Number.isFinite(v)) throw new Error(`A STEP real must be finite (got ${v}).`);
  return { k: "real", v };
};
export const int = (v: number): StepValue => {
  if (!Number.isSafeInteger(v)) throw new Error(`A STEP integer must be a whole number (got ${v}).`);
  return { k: "int", v };
};
export const str = (v: string): StepValue => ({ k: "str", v });
export const enumv = (v: string): StepValue => ({ k: "enum", v: identifier(v) });
export const bool = (v: boolean): StepValue => ({ k: "bool", v });
export const UNSET: StepValue = Object.freeze({ k: "unset" });
export const DERIVED: StepValue = Object.freeze({ k: "derived" });
export const list = (items: readonly StepValue[]): StepValue => ({ k: "list", items });
export const typed = (type: string, value: StepValue): StepValue => ({ k: "typed", type: identifier(type), value });
/** An optional value: unset when absent. */
export const opt = <T>(v: T | undefined | null, as: (v: T) => StepValue): StepValue => (v === undefined || v === null ? UNSET : as(v));

/**
 * A real as STEP writes it: rounded to REAL_DECIMALS places, trailing zeros dropped, and always
 * with its decimal point. Minus zero is zero. A magnitude too large for fixed notation (from
 * REAL_FIXED_LIMIT up, where JavaScript itself switches to an exponent) is written in STEP's
 * exponent form, its mantissa keeping the point: `1.E22`, `-2.5E21`.
 */
export function formatReal(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`A STEP real must be finite (got ${v}).`);
  if (Math.abs(v) >= REAL_FIXED_LIMIT) {
    const [mantissa, exponent] = v.toExponential().split("e");
    const point = mantissa.includes(".") ? mantissa : `${mantissa}.`;
    return `${point}E${exponent.replace(/^\+/, "")}`;
  }
  let text = v.toFixed(REAL_DECIMALS);
  if (text.includes(".")) text = text.replace(/0+$/, "");
  if (!text.includes(".")) text += ".";
  if (/^-0\.$/.test(text)) text = "0.";
  return text;
}

/** The value a real is read back as, once written: what the file says, not what was asked. */
export const writtenReal = (v: number): number => Number(formatReal(v));

/**
 * A length IFC requires to be positive (IfcPositiveLengthMeasure: a profile's sides, an
 * extrusion's depth, a door's size, a riser): refused, with `what` it was, unless it is still
 * greater than zero once rounded as the file writes it.
 */
export function positiveLength(v: number, what: string): StepValue {
  if (!Number.isFinite(v) || !(writtenReal(v) > 0)) throw new Error(`${what} must be a positive length (got ${v}).`);
  return real(v);
}

/**
 * Text IFC caps at STRING(255) (IfcLabel, IfcIdentifier: names, tags, types): refused, with
 * `what` it was, when it is longer, counted in characters. The mapping cuts every name it
 * writes to fit (model.ts label); this is the writer making sure no mapping gets past it.
 */
export function boundedText(v: string, what: string): StepValue {
  if ([...v].length > STEP_LABEL_MAX) throw new Error(`${what} is longer than ${STEP_LABEL_MAX} characters.`);
  return str(v);
}

const hex = (n: number, digits: number): string => n.toString(16).toUpperCase().padStart(digits, "0");

/**
 * A string's characters as STEP writes them, between its apostrophes. Printable ASCII stands
 * as itself (apostrophe and reverse solidus doubled); every run of other characters is one
 * \X2\ (or, outside the BMP, \X4\) group. A lone surrogate, which is no character, is written
 * as U+FFFD.
 */
export function encodeString(s: string): string {
  let out = "";
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const wide = run.some((cp) => cp > 0xffff);
    out += wide ? `\\X4\\${run.map((cp) => hex(cp, 8)).join("")}\\X0\\` : `\\X2\\${run.map((cp) => hex(cp, 4)).join("")}\\X0\\`;
    run = [];
  };
  for (const ch of s) {
    let cp = ch.codePointAt(0) ?? 0xfffd;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp >= 0x20 && cp <= 0x7e) {
      // a run of BMP and astral characters must not mix widths: flush when the width changes
      flush();
      out += ch === "'" ? "''" : ch === "\\" ? "\\\\" : ch;
    } else {
      if (run.length > 0 && run[0] > 0xffff !== cp > 0xffff) flush();
      run.push(cp);
    }
  }
  flush();
  return out;
}

/** One value as STEP text. */
export function formatValue(v: StepValue): string {
  switch (v.k) {
    case "ref":
      return `#${v.id}`;
    case "real":
      return formatReal(v.v);
    case "int":
      return String(v.v);
    case "str":
      return `'${encodeString(v.v)}'`;
    case "enum":
      return `.${v.v}.`;
    case "bool":
      return v.v ? ".T." : ".F.";
    case "unset":
      return "$";
    case "derived":
      return "*";
    case "list":
      return `(${v.items.map(formatValue).join(",")})`;
    case "typed":
      return `${v.type}(${formatValue(v.value)})`;
  }
}

/** The header's three entities (ISO 10303-21, 8.2). */
export interface StepHeader {
  description: readonly string[];
  implementationLevel: string;
  fileName: string;
  /** ISO 8601, to the second */
  timeStamp: string;
  author: readonly string[];
  organization: readonly string[];
  preprocessor: string;
  originatingSystem: string;
  authorization: string;
  schemas: readonly string[];
}

/**
 * A STEP file being written: entity instances numbered from #1 in the order they are added,
 * so the same model always gets the same #ids. Shared instances (a point, a direction) are
 * written once and their reference handed back to every caller that asks for the same one.
 */
export class StepFile {
  private readonly lines: string[] = [];
  private readonly shared = new Map<string, Ref>();
  private readonly counts = new Map<string, number>();

  /** Add an entity instance; its #id is the next one. */
  add<T extends string>(name: T, attributes: readonly StepValue[]): Ref<Uppercase<T>> {
    const type = identifier(name) as Uppercase<T>;
    const id = this.lines.length + 1;
    this.lines.push(`#${id}=${type}(${attributes.map(formatValue).join(",")});`);
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
    return { k: "ref", id, type };
  }

  /** Add an entity instance, or hand back the one already added with the same attributes. */
  addShared<T extends string>(name: T, attributes: readonly StepValue[]): Ref<Uppercase<T>> {
    const key = `${identifier(name)}(${attributes.map(formatValue).join(",")})`;
    const known = this.shared.get(key);
    if (known) return known as Ref<Uppercase<T>>;
    const ref = this.add(name, attributes);
    this.shared.set(key, ref);
    return ref;
  }

  /** How many instances of each entity the file holds, by entity name. */
  entityCounts(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  get size(): number {
    return this.lines.length;
  }

  /** The whole file: header, data section, end. */
  serialize(header: StepHeader): string {
    const strings = (xs: readonly string[]) => formatValue(list(xs.map(str)));
    const head = [
      "ISO-10303-21;",
      "HEADER;",
      `FILE_DESCRIPTION(${strings(header.description)},${formatValue(str(header.implementationLevel))});`,
      `FILE_NAME(${[
        formatValue(str(header.fileName)),
        formatValue(str(header.timeStamp)),
        strings(header.author),
        strings(header.organization),
        formatValue(str(header.preprocessor)),
        formatValue(str(header.originatingSystem)),
        formatValue(str(header.authorization)),
      ].join(",")});`,
      `FILE_SCHEMA(${strings(header.schemas)});`,
      "ENDSEC;",
      "DATA;",
    ];
    return [...head, ...this.lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
  }
}
