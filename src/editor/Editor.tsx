/**
 * Editor — precise 2D SVG plan editor.
 * Chained wall drawing, rooms, openings with door arcs, furniture, blueprint underlay,
 * metric dimensions, 5 cm snap, pan & zoom. Everything mutates the same store the agent uses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore, actions, logActivity } from "../model/store";
import type { Opening, Wall } from "../model/types";
import { snap, segLen, segPoint } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { catalogByKind } from "../model/catalog";

interface View {
  x: number; // world coords at top-left
  y: number;
  scale: number; // px per meter
}

const FLOOR_FILL: Record<string, string> = {
  oak: "#e8d5b5",
  tile: "#e3e0d8",
  carpet: "#cfd6c4",
  concrete: "#d4d4d0",
};

export function Editor() {
  const model = useAppStore((s) => s.model);
  const editor = useAppStore((s) => s.editor);
  const [view, setView] = useState<View>({ x: -1.5, y: -1.5, scale: 90 });
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [dragItem, setDragItem] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [dragRoom, setDragRoom] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [roomStart, setRoomStart] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // auto-fit the plan on first mount
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const m = model;
    const xs = m.walls.flatMap((w) => [w.ax, w.bx]);
    const ys = m.walls.flatMap((w) => [w.ay, w.by]);
    if (xs.length === 0) return;
    const minX = Math.min(...xs) - 0.8;
    const maxX = Math.max(...xs) + 0.8;
    const minY = Math.min(...ys) - 0.8;
    const maxY = Math.max(...ys) + 0.8;
    const planW = maxX - minX;
    const planH = maxY - minY;
    const scale = Math.max(
      15,
      Math.min(el.clientWidth / planW, el.clientHeight / planH),
    );
    // Centre it. Only the tighter axis is filled by the fit, so the other one has slack —
    // anchoring at (minX, minY) dumped all of that slack on one side, which left a tall
    // plan sitting against the left edge with dead canvas beside it.
    setView({
      x: minX - (el.clientWidth / scale - planW) / 2,
      y: minY - (el.clientHeight / scale - planH) / 2,
      scale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: view.x + (clientX - rect.left) / view.scale,
        y: view.y + (clientY - rect.top) / view.scale,
      };
    },
    [view],
  );

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "Escape") {
        actions.setDrawMode("select");
        setRoomStart(null);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const { selectedWallId, selectedItemId, selectedRoomId } = editor;
        if (selectedWallId) {
          const r = actions.removeWall(selectedWallId);
          logActivity("human", "remove_wall", r.summary, r.ok);
          actions.selectWall(null);
        } else if (selectedItemId) {
          const r = actions.removeItem(selectedItemId);
          logActivity("human", "remove_item", r.summary, r.ok);
          actions.selectItem(null);
        } else if (selectedRoomId) {
          const r = actions.removeRoom(selectedRoomId);
          logActivity("human", "remove_room", r.summary, r.ok);
          actions.selectRoom(null);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        const r = actions.undo();
        logActivity("human", "undo", r.summary, r.ok);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  // ---- wheel zoom ----
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView((v) => {
        const scale = Math.min(600, Math.max(15, v.scale * factor));
        return {
          scale,
          x: p.x - (p.x - v.x) / factor,
          y: p.y - (p.y - v.y) / factor,
        };
      });
    },
    [toWorld],
  );

  // ---- pointer handlers ----
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    setMouse({ x: snap(p.x), y: snap(p.y) });
    if (panning) {
      setView((v) => ({
        ...v,
        x: panning.vx - (e.clientX - panning.px) / v.scale,
        y: panning.vy - (e.clientY - panning.py) / v.scale,
      }));
      return;
    }
    if (dragItem) {
      actions.moveItem(dragItem.id, snap(p.x - dragItem.dx), snap(p.y - dragItem.dy));
    }
    if (dragRoom) {
      const room = model.rooms.find((r) => r.id === dragRoom.id);
      if (room) actions.updateRoom(room.id, { x: snap(p.x - dragRoom.dx), y: snap(p.y - dragRoom.dy) });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    const sp = { x: snap(p.x), y: snap(p.y) };
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setPanning({ px: e.clientX, py: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    if (editor.drawMode === "wall") {
      if (!editor.pendingWallStart) {
        actions.setPendingWallStart(sp);
      } else {
        const s = editor.pendingWallStart;
        if (Math.hypot(sp.x - s.x, sp.y - s.y) >= 0.2) {
          const r = actions.addWall(s.x, s.y, sp.x, sp.y, 0.15, 2.7);
          logActivity("human", "add_wall", r.summary, r.ok);
          actions.setPendingWallStart(sp); // chain
        }
      }
      return;
    }
    if (editor.drawMode === "room") {
      setRoomStart(sp);
      return;
    }
    if (editor.drawMode === "place" && editor.placingKind) {
      const r = actions.placeItem(editor.placingKind, sp.x, sp.y, 0);
      logActivity("human", "place_item", r.summary, r.ok);
      return;
    }
    // select mode: background click clears selection / starts pan
    actions.selectWall(null);
    actions.selectItem(null);
    actions.selectRoom(null);
    setPanning({ px: e.clientX, py: e.clientY, vx: view.x, vy: view.y });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (panning) setPanning(null);
    if (dragItem) {
      const it = model.items.find((i) => i.id === dragItem.id);
      if (it) logActivity("human", "move_item", `Moved ${catalogByKind(it.kind)?.label ?? it.kind} to (${it.x.toFixed(2)}, ${it.y.toFixed(2)}).`);
      setDragItem(null);
    }
    if (dragRoom) setDragRoom(null);
    if (roomStart) {
      const p = toWorld(e.clientX, e.clientY);
      const sp = { x: snap(p.x), y: snap(p.y) };
      const x = Math.min(roomStart.x, sp.x);
      const y = Math.min(roomStart.y, sp.y);
      const w = Math.abs(sp.x - roomStart.x);
      const h = Math.abs(sp.y - roomStart.y);
      if (w >= 0.5 && h >= 0.5) {
        const r = actions.addRoom(x, y, w, h, `Room ${model.rooms.length + 1}`, "oak");
        logActivity("human", "add_room", r.summary, r.ok);
      }
      setRoomStart(null);
    }
  };

  const onWallClick = (w: Wall, e: React.MouseEvent) => {
    if (editor.drawMode !== "select") return; // let wall/room/place modes receive the click
    e.stopPropagation();
    actions.selectWall(w.id);
  };

  const onItemDown = (id: string, e: React.PointerEvent) => {
    if (editor.drawMode !== "select") return; // let place mode receive the click
    e.stopPropagation();
    actions.selectItem(id);
    const p = toWorld(e.clientX, e.clientY);
    const it = model.items.find((i) => i.id === id)!;
    setDragItem({ id, dx: p.x - it.x, dy: p.y - it.y });
  };

  const onRoomDown = (id: string, e: React.PointerEvent) => {
    if (editor.drawMode !== "select") return; // let place mode receive the click
    e.stopPropagation();
    actions.selectRoom(id);
    const p = toWorld(e.clientX, e.clientY);
    const room = model.rooms.find((r) => r.id === id)!;
    setDragRoom({ id, dx: p.x - room.x, dy: p.y - room.y });
  };

  // ---- rendering helpers ----
  const S = view.scale;
  const wallById = new Map(model.walls.map((w) => [w.id, w]));

  const renderOpening = (o: Opening) => {
    const wall = wallById.get(o.wallId);
    if (!wall) return null;
    const [t0, t1] = openingSpan(wall, o);
    const p0 = segPoint({ x: wall.ax, y: wall.ay }, { x: wall.bx, y: wall.by }, t0);
    const p1 = segPoint({ x: wall.ax, y: wall.ay }, { x: wall.bx, y: wall.by }, t1);
    const c = segPoint({ x: wall.ax, y: wall.ay }, { x: wall.bx, y: wall.by }, o.t);
    const angle = (Math.atan2(wall.by - wall.ay, wall.bx - wall.ax) * 180) / Math.PI;
    if (o.kind === "door") {
      const r = o.width;
      return (
        <g key={o.id} transform={`rotate(${angle} ${c.x * S} ${c.y * S})`}>
          <line x1={p0.x * S} y1={p0.y * S} x2={p1.x * S} y2={p1.y * S} stroke="#f7f4ee" strokeWidth={Math.max(2, wall.thickness * S)} />
          <path
            d={`M ${p0.x * S} ${p0.y * S} A ${r * S} ${r * S} 0 0 1 ${p0.x * S + r * S} ${p0.y * S - r * S}`}
            fill="none"
            stroke="#b0793f"
            strokeWidth={1.4}
          />
          <line x1={p0.x * S} y1={p0.y * S} x2={p0.x * S} y2={p0.y * S - r * S} stroke="#b0793f" strokeWidth={2.2} />
        </g>
      );
    }
    return (
      <g key={o.id} transform={`rotate(${angle} ${c.x * S} ${c.y * S})`}>
        <line x1={p0.x * S} y1={p0.y * S} x2={p1.x * S} y2={p1.y * S} stroke="#f7f4ee" strokeWidth={Math.max(2, wall.thickness * S)} />
        <line x1={p0.x * S} y1={p0.y * S} x2={p1.x * S} y2={p1.y * S} stroke="#4f86b0" strokeWidth={2.4} />
        <line x1={p0.x * S} y1={p0.y * S - 0.06 * S} x2={p1.x * S} y2={p1.y * S - 0.06 * S} stroke="#4f86b0" strokeWidth={1} />
        <line x1={p0.x * S} y1={p0.y * S + 0.06 * S} x2={p1.x * S} y2={p1.y * S + 0.06 * S} stroke="#4f86b0" strokeWidth={1} />
      </g>
    );
  };

  const gridStep = view.scale > 120 ? 0.5 : 1;
  const gx0 = Math.floor(view.x / gridStep) * gridStep;
  const gy0 = Math.floor(view.y / gridStep) * gridStep;
  const gx1 = view.x + (svgRef.current?.clientWidth ?? 1200) / view.scale;
  const gy1 = view.y + (svgRef.current?.clientHeight ?? 800) / view.scale;
  const gridLines = [];
  for (let x = gx0; x <= gx1; x += gridStep) {
    gridLines.push(<line key={`gx${x.toFixed(2)}`} x1={x * S} y1={gy0 * S} x2={x * S} y2={gy1 * S} stroke={Math.abs(x % 1) < 0.01 ? "#e3ded4" : "#efece4"} strokeWidth={1} />);
  }
  for (let y = gy0; y <= gy1; y += gridStep) {
    gridLines.push(<line key={`gy${y.toFixed(2)}`} x1={gx0 * S} y1={y * S} x2={gx1 * S} y2={y * S} stroke={Math.abs(y % 1) < 0.01 ? "#e3ded4" : "#efece4"} strokeWidth={1} />);
  }

  return (
    <svg
      ref={svgRef}
      className="editor-svg"
      viewBox={`${view.x * S} ${view.y * S} ${(svgRef.current?.clientWidth ?? 1200)} ${(svgRef.current?.clientHeight ?? 800)}`}
      onWheel={onWheel}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        actions.setDrawMode("select");
      }}
    >
      {gridLines}

      {/* blueprint underlay */}
      {model.underlay && (
        <image
          href={model.underlay.dataUrl}
          x={model.underlay.x * S}
          y={model.underlay.y * S}
          width={model.underlay.w * S}
          height={model.underlay.h * S}
          opacity={model.underlay.opacity}
          preserveAspectRatio="none"
        />
      )}

      {/* rooms */}
      {model.rooms.map((r) => (
        <g key={r.id} onPointerDown={(e) => onRoomDown(r.id, e)} style={{ cursor: "move" }}>
          <rect
            x={r.x * S}
            y={r.y * S}
            width={r.w * S}
            height={r.h * S}
            fill={FLOOR_FILL[r.floor] ?? FLOOR_FILL.oak}
            stroke={editor.selectedRoomId === r.id ? "#e07b39" : "#c9c2b2"}
            strokeWidth={editor.selectedRoomId === r.id ? 2.5 : 1}
          />
          <text x={(r.x + 0.12) * S} y={(r.y + 0.32) * S} fontSize={Math.max(10, 0.28 * S)} fill="#8a8070" fontFamily="Inter, sans-serif">
            {r.label} · {(r.w * r.h).toFixed(1)} m²
          </text>
        </g>
      ))}

      {/* walls */}
      {model.walls.map((w) => {
        const selected = editor.selectedWallId === w.id;
        const len = segLen(w.ax, w.ay, w.bx, w.by);
        const mid = segPoint({ x: w.ax, y: w.ay }, { x: w.bx, y: w.by }, 0.5);
        const nx = (-(w.by - w.ay) / len) * 0.22;
        const ny = ((w.bx - w.ax) / len) * 0.22;
        return (
          <g key={w.id} onClick={(e) => onWallClick(w, e)} style={{ cursor: "pointer" }}>
            <line
              x1={w.ax * S}
              y1={w.ay * S}
              x2={w.bx * S}
              y2={w.by * S}
              stroke={selected ? "#e07b39" : "#4a4238"}
              strokeWidth={Math.max(3, w.thickness * S)}
              strokeLinecap="square"
            />
            <line x1={w.ax * S} y1={w.ay * S} x2={w.bx * S} y2={w.by * S} stroke="transparent" strokeWidth={Math.max(14, w.thickness * S)} />
            {/* dimension */}
            <text
              x={(mid.x + nx) * S}
              y={(mid.y + ny) * S}
              fontSize={Math.max(9, 0.22 * S)}
              fill="#9a8f7c"
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
            >
              {len.toFixed(2)}
            </text>
          </g>
        );
      })}

      {/* openings */}
      {model.openings.map(renderOpening)}

      {/* furniture */}
      {model.items.map((it) => {
        const cat = catalogByKind(it.kind);
        if (!cat) return null;
        const selected = editor.selectedItemId === it.id;
        return (
          <g
            key={it.id}
            transform={`translate(${it.x * S} ${it.y * S}) rotate(${-it.rotation})`}
            onPointerDown={(e) => onItemDown(it.id, e)}
            style={{ cursor: "move" }}
          >
            <rect
              x={(-cat.w / 2) * S}
              y={(-cat.d / 2) * S}
              width={cat.w * S}
              height={cat.d * S}
              rx={0.04 * S}
              fill={cat.color}
              fillOpacity={0.85}
              stroke={selected ? "#e07b39" : "#5a5248"}
              strokeWidth={selected ? 2.5 : 1}
            />
            <text
              x={0}
              y={0}
              fontSize={Math.max(8, 0.2 * S)}
              fill="#fff"
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="Inter, sans-serif"
              transform={`rotate(${it.rotation})`}
            >
              {S > 55 ? cat.label : ""}
            </text>
          </g>
        );
      })}

      {/* wall draw preview */}
      {editor.drawMode === "wall" && editor.pendingWallStart && mouse && (
        <line
          x1={editor.pendingWallStart.x * S}
          y1={editor.pendingWallStart.y * S}
          x2={mouse.x * S}
          y2={mouse.y * S}
          stroke="#e07b39"
          strokeWidth={Math.max(3, 0.15 * S)}
          strokeDasharray="8 5"
          strokeLinecap="square"
        />
      )}
      {editor.drawMode === "wall" && editor.pendingWallStart && mouse && (
        <text x={mouse.x * S + 10} y={mouse.y * S - 10} fontSize={12} fill="#e07b39" fontFamily="ui-monospace, monospace">
          {segLen(editor.pendingWallStart.x, editor.pendingWallStart.y, mouse.x, mouse.y).toFixed(2)} m
        </text>
      )}

      {/* room draw preview */}
      {roomStart && mouse && (
        <rect
          x={Math.min(roomStart.x, mouse.x) * S}
          y={Math.min(roomStart.y, mouse.y) * S}
          width={Math.abs(mouse.x - roomStart.x) * S}
          height={Math.abs(mouse.y - roomStart.y) * S}
          fill="#e07b3930"
          stroke="#e07b39"
          strokeDasharray="6 4"
        />
      )}

      {/* snap cursor */}
      {mouse && editor.drawMode !== "select" && (
        <circle cx={mouse.x * S} cy={mouse.y * S} r={4} fill="#e07b39" />
      )}
    </svg>
  );
}
