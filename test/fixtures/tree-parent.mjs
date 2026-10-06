// Test fixture: parent of a three-level process tree (parent → child →
// grandchild holding an HTTP port). Mirrors how `galcode preview` sits above
// the vite dev server. Records its pid, spawns the child, then idles.
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

appendFileSync(process.env.TREE_PID_FILE, `${process.pid}\n`, "utf8");
const child = spawn(process.execPath, [fileURLToPath(new URL("./tree-child.mjs", import.meta.url))], {
  env: process.env,
  stdio: "ignore"
});
child.on("error", () => {});
setInterval(() => {}, 1000);
