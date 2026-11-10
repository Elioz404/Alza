/**
 * Everything a surface builds with, from one import:
 *
 *   import { Button, IconButton, Section, Tabs, SegmentedControl, Switch, Tip, IconWall } from "../primitives";
 *
 * All of these are Alza's own, on the tokens, and none of them brings Astryx's runtime: they
 * are what the first paint draws (the panel's tabs, the Plan | 3D switch, the approval switch,
 * the tooltips), and the build fails if any Astryx module reaches the first load
 * (config/firstLoad.js).
 *
 * The heavy components that only open on interaction (dialogs, menus, popovers, toasts, number
 * inputs) are Astryx's, imported from `./astryx` (or `./NumberField`) by the deferred code that
 * opens them, so they arrive after the first paint (src/ui/deferred.tsx).
 */
import "./primitives.css";

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button";
export { IconButton, ariaShortcut, type IconButtonProps } from "./IconButton";
export { Tip, type TipProps, type TipPlacement, type TipAlignment } from "./Tip";
export { Field, TextInput, TextArea, type FieldProps, type FieldControlProps, type TextInputProps, type TextAreaProps } from "./Field";
export { Panel, Section, Badge, EmptyState, type SectionProps, type BadgeProps, type BadgeTone, type EmptyStateProps } from "./Layout";
export * from "./icons";
export { Kbd, type KbdProps } from "./Kbd";
export { Tabs, Tab, type TabsProps, type TabProps } from "./Tabs";
export { SegmentedControl, SegmentedControlItem, type SegmentedControlProps, type SegmentedControlItemProps } from "./SegmentedControl";
export { Switch, type SwitchProps } from "./Switch";
