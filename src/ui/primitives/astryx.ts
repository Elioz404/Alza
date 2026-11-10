/**
 * The Astryx components the page opens on interaction: dialogs, menus, popovers, toasts and
 * the layer provider toasts hang from. Only deferred code imports this module (the shortcut
 * sheet, the plan and export menus, the approval policy, the notice host…), so it and Astryx's
 * runtime arrive after the first paint, with the first of them (src/ui/deferred.tsx). The
 * first load is held free of Astryx by the build (config/firstLoad.js).
 *
 * Importing it registers the built stone theme: Astryx's components find the theme by the name
 * <html> carries (index.html, THEME in tokens.ts) and take its icons from the registration. The
 * theme is a built one, so registering it writes no <style> (the CSP would refuse one).
 *
 * Two stylesheets come with it, standing in for what Astryx's runtime would otherwise write as a
 * <style> (which the CSP refuses), both built from the installed Astryx (vite.config.ts):
 * - virtual:astryx-slide-rules.css, its anchored layers' @position-try rules; index.html
 *   carries the marker element that tells Astryx they are already on the page;
 * - virtual:astryx-touch-action.css, the touch-action rules its gesture host would write; the
 *   build swaps that writer for one that only marks the element (config/astryxTouchAction.js).
 *
 * Never import Astryx's barrel (`@astryxdesign/core`), nor DateInput, CodeBlock or Chat: they
 * inject <style> at run time, which the CSP refuses (tests/theme.test.ts).
 */
import "virtual:astryx-slide-rules.css";
import "virtual:astryx-touch-action.css";
import { registerTheme } from "@astryxdesign/core/theme";
import { stoneTheme } from "@astryxdesign/theme-stone/built";

registerTheme(stoneTheme);

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
export { useToast, type ToastOptions } from "@astryxdesign/core/Toast";
export { LayerProvider } from "@astryxdesign/core/Layer";
export { NumberInput, type NumberInputProps } from "@astryxdesign/core/NumberInput";
