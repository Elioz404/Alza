/**
 * The Library tab: one place to furnish from, over two sources. "Alza catalogue" is the
 * built-in furniture plus what this plan has added; "Nordika" is the partner shop on its own
 * origin, whose products are adopted into the plan's catalogue when chosen.
 */
import "./library.css";
import { useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "../primitives";
import { Catalogue } from "./Catalogue";
import { Nordika } from "./Nordika";

type Source = "alza" | "nordika";

export function Library() {
  const [source, setSource] = useState<Source>("alza");
  return (
    <div className="library">
      <div className="library__source">
        <SegmentedControl label="Furniture source" value={source} onChange={(v) => setSource(v as Source)} size="sm" layout="fill">
          <SegmentedControlItem value="alza" label="Alza catalogue" />
          <SegmentedControlItem value="nordika" label="Nordika" />
        </SegmentedControl>
      </div>
      {source === "alza" ? <Catalogue /> : <Nordika />}
    </div>
  );
}
