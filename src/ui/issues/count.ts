/** The Issues tab's count, for its badge: in the first chunk, unlike the tab's body. */
import { issuesOf } from "../../model/issues";
import { useAppStore } from "../useAppStore";

/** The number the Issues tab shows (issuesOf is memoised per plan object). */
export const useIssueCount = (): number => useAppStore((s) => issuesOf(s.model).length);
