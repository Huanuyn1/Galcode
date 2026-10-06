import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { killChildTree } from "../src/proc.mjs";

// Process-tree kill invariant: `galcode preview` stops the vite dev server
// through killChildTree; orphaned grandchildren must not keep the port.
// POSIX covers the process-group branch here; the taskkill /T /F branch is
// asserted on Windows CI.

const isWindows = process.platform === "win32";
const TREE_PARENT = fileURLToPath(new URL("./fixtures/tree-parent.mjs", import.meta.url));

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function portAnswers(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("killChildTree process-tree invariant", () => {
  let child = null;
  let pidFile = "";

  afterEach(async () => {
    if (child) killChildTree(child, "SIGKILL");
    child = null;
    if (pidFile) rmSync(pidFile, { force: true });
    pidFile = "";
    await sleep(100);
  });

  async function growTree() {
    const port = await freePort();
    pidFile = path.join(os.tmpdir(), `galcode-tree-${process.pid}-${Date.now()}.txt`);
    child = spawn(process.execPath, [TREE_PARENT], {
      env: { ...process.env, TREE_PORT: String(port), TREE_PID_FILE: pidFile },
      stdio: "ignore",
      // Same shape as the preview server spawn: POSIX children lead their
      // own process group so the group signal can reach the whole tree.
      detached: !isWindows,
      windowsHide: true
    });
    child.on("error", () => {});
    await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim().split(/\r?\n/).length >= 3, 15000, "three tree pids");
    await waitFor(() => portAnswers(port), 15000, "fixture port");
    const pids = readFileSync(pidFile, "utf8").trim().split(/\r?\n/).map(Number);
    return { port, pids };
  }

  async function assertTreeDead(port, pids) {
    await waitFor(async () => !(await portAnswers(port)), 15000, "port release");
    await waitFor(() => pids.every((pid) => !pidAlive(pid)), 15000, "all pids gone");
    expect(await portAnswers(port)).toBe(false);
    for (const pid of pids) expect(pidAlive(pid)).toBe(false);
  }

  it.runIf(!isWindows)("POSIX: group signal kills parent, child, grandchild and releases the port", async () => {
    const { port, pids } = await growTree();
    expect(pids.every(pidAlive)).toBe(true);
    killChildTree(child);
    await assertTreeDead(port, pids);
  }, 60000);

  it.runIf(isWindows)("Windows: taskkill /T /F kills parent, child, grandchild and releases the port", async () => {
    const { port, pids } = await growTree();
    expect(pids.every(pidAlive)).toBe(true);
    killChildTree(child);
    await assertTreeDead(port, pids);
  }, 60000);
});
