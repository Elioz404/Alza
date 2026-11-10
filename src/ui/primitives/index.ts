/**
 * Everything a surface builds with, from one import:
 *
 *   import { Button, IconButton, Section, NumberField, Tabs, Menu, IconWall } from "../primitives";
 *
 * Lean components on the tokens are Alza's own (Button, IconButton, Field, Panel, Section,
 * Badge, EmptyState, the icons). Components whose accessibility is hard to get right are
 * Astryx's, imported per subpath and re-exported here under the names surfaces use: dialogs,
 * tooltips, menus, popovers, tabs, segmented controls, switches, number inputs, toasts, Kbd.
 * Do not import Astryx's barrel (`@astryxdesign/core`), nor DateInput, CodeBlock or Chat: they
 * inject <style> at run time, which the CSP refuses.
 */
import "./primitives.css";

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button";
export { IconButton, ariaShortcut, type IconButtonProps } from "./IconButton";
export { Tip, type TipProps } from "./Tip";
export {
  Field,
  TextInput,
  TextArea,
  NumberField,
  type FieldProps,
  type FieldControlProps,
  type TextInputProps,
  type TextAreaProps,
  type NumberFieldProps,
} from "./Field";
export { Panel, Section, Badge, EmptyState, type SectionProps, type BadgeProps, type BadgeTone, type EmptyStateProps } from "./Layout";
export * from "./icons";
export { Kbd, type KbdProps } from "./Kbd";

// ---- Astryx, accessibility-bearing components
export { Dialog, DialogHeader, type DialogProps, type DialogHeaderProps } from "@astryxdesign/core/Dialog";
export { AlertDialog, type AlertDialogProps } from "@astryxdesign/core/AlertDialog";
export {
  DropdownMenu as Menu,
  DropdownMenuItem as MenuItem,
  DropdownMenuDivider as MenuDivider,
  DropdownMenuGroup as MenuGroup,
  DropdownMenuCheckboxItem as MenuCheckboxItem,
  type DropdownMenuProps as MenuProps,
  type DropdownMenuTriggerProps as MenuTriggerProps,
} from "@astryxdesign/core/DropdownMenu";
export { Popover, type PopoverProps } from "@astryxdesign/core/Popover";
export { TabList as Tabs, Tab, type TabListProps as TabsProps, type TabProps } from "@astryxdesign/core/TabList";
export {
  SegmentedControl,
  SegmentedControlItem,
  type SegmentedControlProps,
  type SegmentedControlItemProps,
} from "@astryxdesign/core/SegmentedControl";
export { Switch, type SwitchProps } from "@astryxdesign/core/Switch";
export { useToast, type ToastOptions } from "@astryxdesign/core/Toast";
