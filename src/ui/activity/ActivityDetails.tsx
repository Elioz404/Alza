/**
 * Activity's scrolling body: the "Waiting for you" queue, the approval policy, the feed and
 * Developer tools. Fetched apart from the first chunk (src/ui/deferred.tsx); the side panel keeps
 * Activity's head, its count of waiting requests and the note composer in the first one, and the
 * body's box is sized by the panel, so nothing moves when this lands.
 */

import { ApprovalQueue } from "../approvals/ApprovalQueue";
import { ApprovalPolicy } from "../approvals/ApprovalPolicy";
import { ActivityList } from "./Activity";
import { DeveloperTools } from "./DeveloperTools";

export function ActivityDetails() {
  return (
    <>
      <ApprovalQueue />
      <ApprovalPolicy />
      <ActivityList />
      <DeveloperTools />
    </>
  );
}
