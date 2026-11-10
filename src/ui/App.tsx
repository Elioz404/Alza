/** The app: the theme root, the shell's state, and the shell. Layout lives in shell/. */

import { ThemeRoot } from "./theme";
import { ShellProvider } from "./shell/ShellContext";
import { AppShell } from "./shell/AppShell";

export function App() {
  return (
    <ThemeRoot>
      <ShellProvider>
        <AppShell />
      </ShellProvider>
    </ThemeRoot>
  );
}
