/**
 * The furniture catalogue: the built-in pieces plus whatever this plan has added (pieces an
 * agent defined, products adopted from Nordika), with search and a category filter. Choosing a
 * piece starts placing it: every click on the plan then puts one down, until Esc.
 */

import { useState } from "react";
import { pageActions } from "../../model/store";
import { catalogFor, type KindDef } from "../../model/catalog";
import { ITEM_CATEGORIES } from "../../model/limits";
import { useAppStore } from "../useAppStore";
import { useThumbnails } from "../useThumbnails";
import { useShell } from "../shell/ShellContext";
import { useBreakpoint } from "../theme/media";
import { Badge, Button, EmptyState, IconSearch, Kbd } from "../primitives";
import { metres } from "../inspector/entities";
import { placeInMiddle } from "../../editor/canvasState";

const CATEGORY_LABEL: Record<(typeof ITEM_CATEGORIES)[number], string> = {
  living: "Living",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  bath: "Bath",
  office: "Office",
  decor: "Decor",
};

const ALL = "all";

const matches = (def: KindDef, query: string): boolean => {
  if (!query) return true;
  const q = query.toLowerCase();
  return def.label.toLowerCase().includes(q) || def.kind.toLowerCase().includes(q) || String(def.category).toLowerCase().includes(q);
};

const dims = (def: KindDef): string => `${def.w.toFixed(2)} × ${def.d.toFixed(2)} m`;

function PieceCard({ def, thumb, isPlacing }: { def: KindDef; thumb: string | null; isPlacing: boolean }) {
  const { setPanelOpen } = useShell();
  const narrow = useBreakpoint("drawer");
  return (
    <li>
      <button
        type="button"
        className="piece"
        aria-pressed={isPlacing}
        aria-label={`${def.label}, ${dims(def)}, ${metres(def.h)} tall`}
        onClick={() => {
          if (isPlacing) pageActions.setDrawMode("select");
          else {
            pageActions.setDrawMode("place", def.kind);
            // the plan is where the next click goes; a drawer over it would be in the way
            if (narrow) setPanelOpen(false);
          }
        }}
      >
        <span className="piece__picture" aria-hidden="true">
          {thumb ? (
            <img className="piece__thumb" src={thumb} alt="" draggable={false} />
          ) : (
            <span className="piece__swatch" style={{ backgroundColor: def.color }} />
          )}
        </span>
        <span className="piece__label">{def.label}</span>
        <span className="piece__dims num">{dims(def)}</span>
        {def.source === "supplier" ? (
          <Badge className="piece__badge">Nordika</Badge>
        ) : def.source === "custom" ? (
          <Badge className="piece__badge" tone="agent">
            Agent
          </Badge>
        ) : null}
      </button>
    </li>
  );
}

export function Catalogue() {
  const kinds = useAppStore((s) => s.model.kinds);
  const placing = useAppStore((s) => (s.editor.drawMode === "place" ? s.editor.placingKind : null));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const catalog = catalogFor(kinds);
  // three.js arrives with the first catalogue that needs a picture; swatches until then
  const thumbnailFor = useThumbnails();

  const present = ITEM_CATEGORIES.filter((c) => catalog.entries.some((d) => d.category === c));
  const shown = catalog.entries.filter((d) => (category === ALL || d.category === category) && matches(d, query.trim()));
  const placingDef = placing ? catalog.get(placing) : undefined;

  return (
    <div className="catalogue">
      <div className="catalogue__filters">
        <label className="search">
          <IconSearch size="sm" className="search__icon" />
          <input
            className="input search__input"
            type="search"
            aria-label="Search the catalogue"
            placeholder="Search furniture"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="chips" role="group" aria-label="Category">
          {[ALL, ...present].map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c === ALL ? "All" : CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]}
            </button>
          ))}
        </div>
      </div>

      <p className="catalogue__status" role="status">
        {placingDef ? (
          <>
            Placing {placingDef.label}. Each click on the plan puts one down, or{" "}
            <button type="button" className="text-link" onClick={placeInMiddle}>
              put one in the middle
            </button>{" "}
            of the view (<Kbd keys="enter" />). <Kbd keys="esc" /> stops.
          </>
        ) : (
          "Choose a piece, then click on the plan to place it at its true size."
        )}
      </p>

      {shown.length === 0 ? (
        <EmptyState
          title={query.trim() ? `Nothing matches “${query.trim()}”` : "No pieces in this category"}
          body="Try another word, or look through every category."
          actions={
            <Button
              size="sm"
              onClick={() => {
                setQuery("");
                setCategory(ALL);
              }}
            >
              Show everything
            </Button>
          }
        />
      ) : (
        <ul className="catalogue__grid" aria-label="Furniture">
          {shown.map((def) => (
            <PieceCard key={def.kind} def={def} thumb={thumbnailFor?.(def) ?? null} isPlacing={placing === def.kind} />
          ))}
        </ul>
      )}
    </div>
  );
}
