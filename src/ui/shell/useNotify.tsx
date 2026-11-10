/**
 * Short notices at the edge of the page, on Astryx's toast (a polite live region, swipe and
 * Escape to dismiss). Use them for what the canvas cannot show by itself: a failure with its
 * reason and the way out, or an undo offer after a change that replaced or removed a lot.
 * Success the canvas already shows needs no notice.
 *
 *   const notify = useNotify();
 *   notify({ body: "Plan cleared", undoable: true });
 *   notify({ body: r.summary, type: "error" });
 *
 * An undo offer stays for MOTION.undoOfferMs and its Undo goes through dispatch as the human,
 * exactly like the Undo button.
 */

import { useCallback, type ReactNode } from "react";
import { useToast } from "@astryxdesign/core/Toast";
import { dispatch } from "../../model/commands";
import { MOTION } from "../theme/tokens";

export interface Notice {
  body: ReactNode;
  type?: "info" | "error";
  /** offer an Undo button that undoes the last change */
  undoable?: boolean;
}

export function useNotify(): (notice: Notice) => void {
  const toast = useToast();
  return useCallback(
    ({ body, type = "info", undoable }: Notice) => {
      let dismiss: (() => void) | null = null;
      const undoButton = undoable ? (
        <button
          type="button"
          className="btn btn--sm btn--ghost notice__undo"
          onClick={() => {
            dispatch({ type: "undo" }, { actor: "human" });
            dismiss?.();
          }}
        >
          Undo
        </button>
      ) : undefined;
      dismiss = toast({
        body,
        type,
        endContent: undoButton,
        isAutoHide: true,
        autoHideDuration: MOTION.undoOfferMs,
      });
    },
    [toast],
  );
}
