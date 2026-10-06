import { spawnSync } from "node:child_process";

// Process-lifetime helpers shared by the legacy CLI and tests.
const isWindows = process.platform === "win32";

// Kill a spawned child and its whole process tree. Node's child.kill()
// only reaches the direct child; grandchildren (the vite dev server behind
// `npm run dev`) would survive as orphans and keep holding ports and file
// locks, which breaks later runs and even blocks deleting the project
// folder. Windows uses taskkill /T; POSIX signals the child's process
// group (server children are spawned detached so they lead their own
// group; for non-detached children the group signal just fails and we
// fall back to the plain signal).
export function killChildTree(child, signal = "SIGTERM") {
  if (!child || child.killed || child.exitCode !== null) return;
  if (isWindows && child.pid) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    } catch {
      // fall through to the plain signal below
    }
  }
  if (!isWindows && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // not a process-group leader; fall through to the plain signal below
    }
  }
  try {
    child.kill(signal);
  } catch {
    // process already exited
  }
}
