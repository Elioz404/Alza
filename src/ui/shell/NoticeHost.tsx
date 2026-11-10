/**
 * What draws the notices useNotify() asks for: Astryx's toast, with an Undo button on an undo
 * offer. Fetched apart from the first chunk (src/ui/deferred.tsx); the shell mounts it, and
 * notices asked for before it arrived are shown as it connects.
 *
 * The toasts hang from Astryx's layer provider, which arrives here with them: the page's root
 * carries no Astryx at all, so the first paint does not wait for its runtime.
 */

import { useEffect } from "react";
import { LayerProvider, useToast } from "../primitives/astryx";
import { dispatch } from "../../model/commands";
import { MOTION } from "../theme/tokens";
import { connectNoticeHost, type Notice } from "./useNotify";

export function NoticeHost() {
  return (
    <LayerProvider>
      <Notices />
    </LayerProvider>
  );
}

function Notices() {
  const toast = useToast();
  useEffect(
    () =>
      connectNoticeHost(({ body, type = "info", undoable }: Notice) => {
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
      }),
    [toast],
  );
  return null;
}
