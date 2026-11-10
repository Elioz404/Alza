/**
 * The shortcut sheet (? or the help button): every key and gesture the page answers, from
 * SHORTCUT_SHEET, in a native modal dialog (focus trap, Escape, focus returned on close). The
 * shell fetches it the first time it opens (src/ui/LazyLayer.tsx).
 */

import { Dialog, DialogHeader, Kbd } from "../primitives";
import type { LayerProps } from "../LazyLayer";
import { SHORTCUT_SHEET } from "./shortcuts";

export function ShortcutsDialog({ isOpen, onOpenChange }: LayerProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="info" width={520}>
      <DialogHeader title="Keyboard shortcuts" onOpenChange={onOpenChange} />
      <div className="shortcuts">
        {SHORTCUT_SHEET.map((group) => (
          <section key={group.title} className="shortcuts__group">
            <h3 className="shortcuts__title">{group.title}</h3>
            <dl className="shortcuts__list">
              {group.rows.map((row) => (
                <div key={`${group.title}:${row.does}`} className="shortcuts__row">
                  <dt className="shortcuts__keys">
                    {row.keys.length > 0
                      ? row.keys.map((k, i) => (
                          <span key={k} className="shortcuts__key">
                            {i > 0 && !row.isSet ? <span className="shortcuts__or">or</span> : null}
                            <Kbd keys={k} />
                          </span>
                        ))
                      : <span className="shortcuts__gesture">{row.gesture}</span>}
                  </dt>
                  <dd className="shortcuts__does">{row.does}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
