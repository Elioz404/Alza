/**
 * The IFC export's entry: the plan in, an IFC4 STEP file out, with a summary of what it holds.
 * Loaded on demand (src/export/ifcExport.ts), never with the page: nothing here is first load.
 */

import type { PlanModel } from "../../model/types";
import { IFC_FILE, ifcFileName } from "../ifcExport";
import { planRangeErrors } from "../../model/planRanges";
import { IFC_HEADER, IFC_SCHEMA, REFUSAL_LISTED } from "./config";
import { PlanToIfc, type IfcElementCounts } from "./model";

export interface IfcSummary {
  schema: typeof IFC_SCHEMA;
  fileName: string;
  /** the file's size, in bytes (it is plain ASCII: one byte a character) */
  bytes: number;
  /** what the plan became, by kind of element */
  elements: IfcElementCounts;
  /** every entity the file holds, by IFC entity name */
  entities: Record<string, number>;
}

export interface IfcFile {
  text: string;
  mediaType: string;
  summary: IfcSummary;
}

export interface IfcOptions {
  /** when the file is written, for its header; the tests pass a fixed one */
  now?: Date;
}

/** A moment as ISO 8601 local date and time, to the second: what FILE_NAME's time stamp holds. */
export function isoLocal(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/**
 * A plan the export will not write, and why: one of its numbers is outside the range the editor
 * keeps it to (a loaded plan may hold one, planFormat.ts), and the building model would not be
 * a valid one. The message names the first few, for the person or the agent to fix.
 */
export class IfcExportRefused extends Error {
  constructor(readonly problems: readonly string[]) {
    const listed = problems.slice(0, REFUSAL_LISTED).join(" ");
    const more = problems.length > REFUSAL_LISTED ? ` And ${problems.length - REFUSAL_LISTED} more.` : "";
    super(`The plan has values outside the ranges the editor allows, so no IFC file was written. ${listed}${more} Fix them, then export again.`);
    this.name = "IfcExportRefused";
  }
}

/**
 * The plan as an IFC4 file. Pure apart from the clock: the same plan and time give the same
 * bytes. Throws IfcExportRefused for a plan outside its ranges (planRanges.ts), rather than
 * writing a file a reader would refuse.
 */
export function writeIfc(model: PlanModel, options: IfcOptions = {}): IfcFile {
  const problems = planRangeErrors(model);
  if (problems.length > 0) throw new IfcExportRefused(problems);
  const mapping = new PlanToIfc(model);
  mapping.build();
  const fileName = ifcFileName(model.name);
  const text = mapping.ifc.file.serialize({
    description: [IFC_HEADER.viewDefinition],
    implementationLevel: IFC_HEADER.implementationLevel,
    fileName,
    timeStamp: isoLocal(options.now ?? new Date()),
    author: [""],
    organization: [""],
    preprocessor: IFC_HEADER.preprocessor,
    originatingSystem: IFC_HEADER.originatingSystem,
    authorization: "",
    schemas: [IFC_SCHEMA],
  });
  return {
    text,
    mediaType: IFC_FILE.mediaType,
    summary: { schema: IFC_SCHEMA, fileName, bytes: text.length, elements: mapping.counts(), entities: mapping.ifc.file.entityCounts() },
  };
}
