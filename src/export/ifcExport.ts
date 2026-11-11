/**
 * Export the plan as IFC, for CAD and BIM tools: the one path the Export menu and the
 * export_ifc tool share. The writer itself (src/export/ifc) is fetched the first time anyone
 * exports, so the page's first load never carries it.
 */

import type { PlanModel } from "../model/types";
import type { IfcSummary } from "./ifc";
import { downloadFile, exportFileName } from "./download";

/**
 * File extension and media type of the download. Here rather than in ifc/config.ts, with the
 * writer's other settings, because the page names the file (to ask the person about it) before
 * the writer is loaded.
 */
export const IFC_FILE = Object.freeze({ extension: "ifc", mediaType: "application/x-step" });

export type { IfcSummary } from "./ifc";

/** The name the IFC file of plan `planName` downloads as. */
export const ifcFileName = (planName: string): string => exportFileName(planName, IFC_FILE.extension);

/** Write `model` as an IFC4 file and hand it to the person as a download; what it holds comes back. */
export async function exportIfc(model: PlanModel): Promise<IfcSummary> {
  const { writeIfc } = await import("./ifc");
  const file = writeIfc(model);
  downloadFile(file.text, file.summary.fileName, file.mediaType);
  return file.summary;
}
