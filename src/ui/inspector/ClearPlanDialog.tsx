/**
 * "Clear the whole plan?": the confirmation behind Properties' Clear plan…, an Astryx
 * AlertDialog. Fetched the first time it opens (src/ui/LazyLayer.tsx).
 */

import { AlertDialog } from "../primitives/astryx";
import type { LayerProps } from "../LazyLayer";

export function ClearPlanDialog({ isOpen, onOpenChange, onAction }: LayerProps & { onAction(): void }) {
  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Clear the whole plan?"
      description="This removes every wall, door, window, room and piece of furniture, the blueprint image and the notes. Undo brings them back."
      cancelLabel="Keep the plan"
      actionLabel="Clear plan"
      onAction={onAction}
    />
  );
}
