/**
 * Handing a file the page made to the person: the one path every export takes (the 3D view's
 * OBJ and PNG, the IFC model), so they all name their files the same way and reach the browser's
 * downloads the same way. Nothing leaves the browser: the file is a blob URL clicked on the page.
 */

import { cleanText } from "../model/text";
import { TEXT } from "../model/limits";

/**
 * Characters a file name may not hold on some system the file may be saved on (Windows'
 * reserved set includes all of POSIX's "/"): each becomes a hyphen.
 */
const RESERVED_IN_FILE_NAMES = /[/\\:*?"<>|]/g;
/** What a name is called when nothing of it is left. */
const FALLBACK_NAME = "plan";

/**
 * The file name an export of plan `planName` gets: the plan's name as a clean name (text.ts:
 * no control or invisible formatting characters, at most TEXT.planName characters), with the
 * characters file systems reserve and every space as hyphens, in lower case, and no leading dot
 * or hyphen (which would hide the file, or read as an option). "plan" when nothing is left.
 */
export function exportFileName(planName: string, ext: string): string {
  const base = cleanText(planName, TEXT.planName)
    .replace(RESERVED_IN_FILE_NAMES, "-")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/^[.-]+|[.-]+$/g, "");
  return `${base || FALLBACK_NAME}.${ext}`;
}

/** Download `href` (a data: or blob: URL) as `name`. */
export function downloadHref(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

/** Download `content` as a file called `name`, of media type `type`. */
export function downloadFile(content: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadHref(url, name);
  URL.revokeObjectURL(url);
}
