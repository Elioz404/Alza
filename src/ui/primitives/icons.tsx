/**
 * The icon set: one 24-unit grid, one 1.5 stroke (--size-icon-stroke), round caps and joins,
 * no fills except where a mark is solid. Drawn for this product (wall, room, door, window are
 * plan symbols), never glyphs or emoji.
 *
 * Each icon is decorative by default (aria-hidden): the control it sits in carries the name.
 * Pass `title` only when the icon is the sole content that names something.
 */

import type { ReactNode, SVGProps } from "react";

export type IconSize = "xs" | "sm" | "md" | "lg";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** xs 14, sm 16, md 18 (default), lg 20: --size-icon-* */
  size?: IconSize;
  /** an accessible name, for an icon that stands alone */
  title?: string;
}

export type IconComponent = (props: IconProps) => ReactNode;

function make(name: string, paths: ReactNode): IconComponent {
  const Icon = ({ size = "md", title, className, ...rest }: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      className={`icon icon--${size}${className ? ` ${className}` : ""}`}
      data-icon={name}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {paths}
    </svg>
  );
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

// ---- tools
export const IconSelect = make("select", <path d="M5 3.5l6.2 16.5 2.2-6.6 6.6-2.2z" />);
export const IconPan = make("pan", <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />);
export const IconWall = make(
  "wall",
  <>
    <rect x="3" y="9" width="18" height="6" rx="1" />
    <path d="M7 15l4-6M12 15l4-6M17 15l3-4.5" />
  </>,
);
export const IconRoom = make(
  "room",
  <>
    <rect x="4" y="5" width="16" height="14" rx="1" />
    <path d="M4 12h6M14 5v5" />
  </>,
);
export const IconDoor = make(
  "door",
  <>
    <path d="M4 20h16M7 20V7" />
    <path d="M7 7a13 13 0 0 1 13 13" strokeDasharray="2 2.5" />
  </>,
);
export const IconWindow = make(
  "window",
  <>
    <rect x="3" y="9" width="18" height="6" rx="1" />
    <path d="M3 12h18M9 9v6M15 9v6" />
  </>,
);
export const IconStair = make(
  "stair",
  <>
    <rect x="7" y="3" width="10" height="18" rx="1" />
    <path d="M7 7.5h10M7 12h10M7 16.5h10" />
    <path d="M12 19V5.5M10 7.5l2-2 2 2" />
  </>,
);
/** Levels: storeys stacked, as a section shows them. */
export const IconLevels = make(
  "levels",
  <>
    <path d="M3 9l9-5 9 5-9 5z" />
    <path d="M3 14l9 5 9-5" />
  </>,
);
export const IconMeasure = make(
  "measure",
  <>
    <path d="M3.5 16.5L16.5 3.5l4 4-13 13z" />
    <path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2" />
  </>,
);
export const IconFurniture = make(
  "furniture",
  <>
    <path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
    <path d="M3 11h18v6H3zM5 17v2M19 17v2" />
  </>,
);

// ---- 3D cameras
export const IconOrbit = make(
  "orbit",
  <>
    <ellipse cx="12" cy="12" rx="9" ry="4" />
    <path d="M12 3v18" />
    <path d="M17.5 6.5l1.5 1.4-2 .4" />
  </>,
);
export const IconTop = make(
  "top",
  <>
    <rect x="5" y="9" width="14" height="11" rx="1" />
    <path d="M12 2v5M9.5 4.5L12 7l2.5-2.5" />
  </>,
);
export const IconWalk = make(
  "walk",
  <>
    <circle cx="13" cy="4.5" r="1.8" />
    <path d="M10 21l2.5-6.5L15 17v4M12.5 14.5l.8-5.5-3.3 1.6L8.5 14M13.3 9l2.4 2.8 2.8.7" />
  </>,
);

// ---- views and panels
export const IconPlan = make(
  "plan",
  <>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M12 4v7M12 15v5M12 13h8" />
  </>,
);
export const IconCube = make(
  "cube",
  <>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </>,
);
export const IconProperties = make(
  "properties",
  <>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </>,
);
export const IconLibrary = make(
  "library",
  <>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </>,
);
export const IconIssues = make(
  "issues",
  <>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.1" />
  </>,
);
export const IconNote = make(
  "note",
  <>
    <path d="M5 4h10l4 4v12H5z" />
    <path d="M15 4v4h4M8 12h8M8 16h5" />
  </>,
);
export const IconActivity = make("activity", <path d="M4 6h16M4 12h10M4 18h13" />);
export const IconPanel = make(
  "panel",
  <>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M15 4v16" />
  </>,
);

// ---- actions
export const IconUndo = make(
  "undo",
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
);
export const IconDownload = make("download", <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
export const IconCamera = make(
  "camera",
  <>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
    <circle cx="12" cy="13" r="3.2" />
  </>,
);
export const IconTrash = make("trash", <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />);
export const IconPlus = make("plus", <path d="M12 5v14M5 12h14" />);
export const IconMinus = make("minus", <path d="M5 12h14" />);
export const IconFit = make("fit", <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />);
export const IconClose = make("close", <path d="M6 6l12 12M18 6L6 18" />);
export const IconCheck = make("check", <path d="M5 12.5l4 4L19 7" />);
export const IconSearch = make(
  "search",
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="M15.5 15.5L20 20" />
  </>,
);
export const IconImage = make(
  "image",
  <>
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 18l5-5 4 4 3-3 4 4" />
  </>,
);
export const IconTool = make(
  "tool",
  <path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z" />,
);
export const IconKeyboard = make(
  "keyboard",
  <>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M17 14H7" />
  </>,
);
export const IconEye = make(
  "eye",
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </>,
);

// ---- navigation
export const IconChevronDown = make("chevron-down", <path d="M6 9l6 6 6-6" />);
export const IconChevronRight = make("chevron-right", <path d="M9 6l6 6-6 6" />);
export const IconMore = make("more", <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="2.6" />);

// ---- status
export const IconHelp = make(
  "help",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8" />
    <path d="M12 16.8v.1" />
  </>,
);
export const IconInfo = make(
  "info",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.1" />
  </>,
);
export const IconWarning = IconIssues;
export const IconError = make(
  "error",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </>,
);
export const IconAgent = make(
  "agent",
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </>,
);
export const IconPerson = make(
  "person",
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </>,
);
export const IconSystem = make(
  "system",
  <>
    <rect x="4" y="5" width="16" height="11" rx="1.5" />
    <path d="M9 20h6M12 16v4" />
  </>,
);

/**
 * The revision delta: the Alza triangle, numbered. On the drawing and in Activity the same
 * number marks the same change. `tone` picks the actor's colour.
 */
export function DeltaMark({ n, tone = "agent", label }: { n?: number; tone?: "agent" | "human" | "destructive"; label?: string }) {
  return (
    <svg viewBox="0 0 24 22" className={`delta delta--${tone}`} role={label ? "img" : undefined} aria-hidden={label ? undefined : true} aria-label={label}>
      <path className="delta__tri" d="M12 2.5L21.5 19.5h-19z" />
      {n !== undefined ? (
        <text className="delta__num" x="12" y="17" textAnchor="middle">
          {n}
        </text>
      ) : null}
    </svg>
  );
}

/** The Alza mark: a solid rise on a ground line, with a cobalt section cut. */
export function BrandMark() {
  return (
    <svg viewBox="0 0 22 22" className="brand-mark" aria-hidden="true" focusable="false">
      <path className="brand-mark__rise" d="M11 3.5L19 17H3z" />
      <path className="brand-mark__cut" d="M11 3.5L15 10.25H7z" />
      <path className="brand-mark__ground" d="M1.5 19.5h19" />
    </svg>
  );
}
