// Test fixture: middle level of the process tree. Records its pid, spawns
// the grandchild, then idles.
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

appendFileSync(process.env.TREE_PID_FILE, `${process.pid}\n`, "utf8");
const child = spawn(process.execPath, [fileURLToPath(new URL("./tree-grandchild.mjs", import.meta.url))], {
  env: process.env,
  stdio: "ignore"
});
child.on("error", () => {});
setInterval(() => {}, 1000);
