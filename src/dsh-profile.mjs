import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { killChildTree } from "./proc.mjs";
import { recorderBrowserStatus } from "./recorder/browser.mjs";
import { probeCubismCoreGeneration } from "./live2d-compat.mjs";

// dsh (DeepSeek Harness) integration for the Galcode launcher: DSH_HOME
// resolution, idempotent `galcode` profile setup, dsh process spawning, and
// the `galcode doctor` environment checks. Everything here is side-effect
// free at import time (unlike src/galcode.js, which chdirs to the project
// root) so the TUI inherits the user's real working directory.
//
// Cross-platform note: every child process is spawned as
// `node <script.js>` or as a real executable (ffmpeg), never as a bare
// npm/pnpm `.cmd` shim, so no Windows shell normalization is required.

export const DSH_PROFILE_NAME = "galcode";
export const DSH_TUI_PACKAGE = "@deepseek-harness-tui/dsh-tui";
export const DSH_TUI_VERSION = "0.13.0";
export const DSH_BUNDLE_PACKAGE = "dsh-galcode";
const DSH_BASE_BUNDLE = "@deepseek-ai/dsh-base";
const DSH_HOME_ENV = "DSH_HOME";
const DSH_HOME_DIR_NAME = ".dsh";
export const DSH_PACKAGE = "@deepseek-ai/dsh";
// dsh is an EXTERNAL dependency (plugin-style): not bundled in the npm package;
// resolved at first run or auto-installed globally. We accept the 0.2.x line
// at >= 0.2.0-rc.2 (our bundle declares ^0.2.0-rc.2 peers).
export const DSH_MIN_VERSION = "0.2.0-rc.2";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromGalcode = createRequire(path.join(PACKAGE_ROOT, "src", "dsh-profile.mjs"));

// Mirrors @deepseek-ai/dsh-home-paths resolveDshHome(): an explicit
// configured path wins, then $DSH_HOME (blank = unset), then ~/.dsh; `~`,
// `~/` and `~\` prefixes expand against the OS home; the result is absolute.
export function resolveDshHome(configured, env = process.env) {
  const fromEnv = env[DSH_HOME_ENV];
  const raw = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : path.join(os.homedir(), DSH_HOME_DIR_NAME));
  return path.resolve(expandHomePath(raw));
}

function expandHomePath(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveProfileDir(home, profileName = DSH_PROFILE_NAME) {
  return path.join(home, "profiles", profileName);
}

export function galcodePackageRoot() {
  return PACKAGE_ROOT;
}

export function galcodeMcpServerPath() {
  return path.join(PACKAGE_ROOT, "bin", "galcode-mcp.js");
}

export function resolvePnpmCliJs() {
  return requireFromGalcode.resolve("pnpm/bin/pnpm.mjs");
}

// --- dsh binary resolution (plugin-style; dsh is NOT bundled) --------------

export function parseDshVersion(text) {
  const match = String(text || "").match(/(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: match[4] === undefined ? null : Number(match[4]),
    text: match[0]
  };
}

export function compareDshVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.rc === b.rc) return 0;
  if (a.rc === null) return 1; // release > rc
  if (b.rc === null) return -1;
  return a.rc - b.rc;
}

export function dshVersionCompatible(version) {
  const parsed = typeof version === "string" ? parseDshVersion(version) : version;
  if (!parsed) return false;
  return parsed.major === 0 && parsed.minor === 2
    && compareDshVersions(parsed, parseDshVersion(DSH_MIN_VERSION)) >= 0;
}

function dshJsUnderNodeModules(nodeModulesDir) {
  const jsPath = path.join(nodeModulesDir, ...DSH_PACKAGE.split("/"), "lib", "bin.js");
  return fssync.existsSync(jsPath) ? jsPath : "";
}

// Map a PATH-found dsh binary to its underlying JS entry so we can always
// spawn `node <bin.js>` — never a bare .cmd shim. npm global layouts:
//   POSIX:   <prefix>/bin/dsh (symlink → ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js)
//   Windows: <prefix>/dsh.cmd + <prefix>/node_modules/@deepseek-ai/dsh/...
async function dshJsFromPathBinary(binPath) {
  const stat = await fs.lstat(binPath).catch(() => null);
  const real = stat?.isSymbolicLink() ? await fs.realpath(binPath).catch(() => binPath) : binPath;
  if (real.endsWith(".js") && fssync.existsSync(real)) return real;
  const prefix = path.dirname(real);
  const candidates = [
    path.join(prefix, "node_modules"),     // Windows: shim sits next to node_modules
    path.join(path.dirname(prefix), "lib", "node_modules") // POSIX: bin/ next to lib/
  ];
  for (const nodeModules of candidates) {
    const jsPath = dshJsUnderNodeModules(nodeModules);
    if (jsPath) return jsPath;
  }
  return "";
}

async function findDshOnPath(env) {
  const pathEnv = env.PATH || env.Path || "";
  const isWindows = process.platform === "win32";
  const names = isWindows ? ["dsh.cmd", "dsh.exe", "dsh"] : ["dsh"];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (!fssync.existsSync(candidate)) continue;
      const jsPath = await dshJsFromPathBinary(candidate);
      if (jsPath) return { jsPath, binPath: candidate };
    }
  }
  return null;
}

function resolveNpmCliJs(execPath = process.execPath) {
  const dir = path.dirname(execPath);
  const candidates = [
    path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),       // Windows
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js") // POSIX
  ];
  for (const candidate of candidates) {
    if (fssync.existsSync(candidate)) return path.resolve(candidate);
  }

  const pathEnv = process.env.PATH || process.env.Path || "";
  const names = process.platform === "win32" ? ["npm.cmd", "npm.exe", "npm"] : ["npm"];
  for (const pathDir of pathEnv.split(path.delimiter)) {
    if (!pathDir) continue;
    for (const name of names) {
      const shim = path.join(pathDir, name);
      if (!fssync.existsSync(shim)) continue;
      const real = fssync.realpathSync(shim);
      if (real.endsWith("npm-cli.js")) return real;
      const prefix = path.dirname(real);
      for (const candidate of [
        path.join(prefix, "node_modules", "npm", "bin", "npm-cli.js"),
        path.join(path.dirname(prefix), "lib", "node_modules", "npm", "bin", "npm-cli.js")
      ]) {
        if (fssync.existsSync(candidate)) return path.resolve(candidate);
      }
    }
  }
  return "";
}

async function defaultNpmGlobalRoot(execPath) {
  const npmCli = resolveNpmCliJs(execPath);
  if (!npmCli) return "";
  try {
    const out = await collectOutput(execPath, [npmCli, "root", "-g"], { timeoutMs: 20000 });
    return out.trim();
  } catch {
    return "";
  }
}

async function defaultProbeVersion(execPath, jsPath) {
  const out = await collectOutput(execPath, [jsPath, "--version"], { timeoutMs: 20000 });
  const parsed = parseDshVersion(out);
  return parsed ? parsed.text : "";
}

// Resolution order: (a) repo-local node_modules (dev mode), (b) `dsh` on PATH,
// (c) npm global root. Returns null when nothing is found.
export async function resolveDshInstallation(options = {}) {
  const env = options.env || process.env;
  const execPath = options.execPath || process.execPath;
  const repoRoot = options.repoRoot || PACKAGE_ROOT;
  const probeVersion = options.probeVersion || defaultProbeVersion;
  const npmGlobalRoot = options.npmGlobalRoot || (() => defaultNpmGlobalRoot(execPath));

  const candidates = [];
  const repoJs = dshJsUnderNodeModules(path.join(repoRoot, "node_modules"));
  if (repoJs) candidates.push({ jsPath: repoJs, source: "repo-dev" });
  const onPath = await findDshOnPath(env);
  if (onPath) candidates.push({ jsPath: onPath.jsPath, source: "PATH", binPath: onPath.binPath });
  const globalRoot = await npmGlobalRoot();
  if (globalRoot) {
    const globalJs = dshJsUnderNodeModules(globalRoot);
    if (globalJs && !candidates.some((c) => c.jsPath === globalJs)) {
      candidates.push({ jsPath: globalJs, source: "global" });
    }
  }

  for (const candidate of candidates) {
    let version = "";
    try {
      version = await probeVersion(execPath, candidate.jsPath);
    } catch {
      continue; // broken install — try the next source
    }
    const compatible = dshVersionCompatible(version);
    return {
      ...candidate,
      version,
      compatible,
      warning: compatible
        ? ""
        : `dsh ${version || "?"} at ${candidate.jsPath} is outside the supported 0.2.x (>= ${DSH_MIN_VERSION}) line. ` +
          `Upgrade with: npm i -g ${DSH_PACKAGE}@${DSH_MIN_VERSION} — continuing with the found one as fallback (bundle peer checks may refuse).`
    };
  }
  return null;
}

// Find dsh or install it globally. Progress streams through; permission
// failures get an actionable message.
export async function ensureDshInstallation(options = {}) {
  const log = options.log || (() => {});
  const existing = await resolveDshInstallation(options);
  if (existing) {
    if (existing.warning) console.warn(`WARNING: ${existing.warning}`);
    return existing;
  }

  const execPath = options.execPath || process.execPath;
  const npmCli = resolveNpmCliJs(execPath);
  if (!npmCli) throw new Error("dsh not found and npm is unavailable next to the running Node — install dsh manually: npm i -g " + DSH_PACKAGE + "@" + DSH_MIN_VERSION);
  const spec = `${DSH_PACKAGE}@${DSH_MIN_VERSION}`;
  log(`dsh not found — installing globally: npm i -g ${spec}`);
  const runInstall = options.installImpl || (async () => {
    let output = "";
    const code = await new Promise((resolve) => {
      const child = spawn(execPath, [npmCli, "i", "-g", spec], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const echo = (chunk) => {
        output += chunk.toString();
        if (output.length > 60000) output = output.slice(-60000);
        process.stdout.write(chunk);
      };
      child.stdout.on("data", echo);
      child.stderr.on("data", echo);
      child.on("error", () => resolve(-1));
      child.on("exit", (exitCode) => resolve(exitCode ?? -1));
    });
    return { code, output };
  });
  const { code, output } = await runInstall(spec);
  if (code !== 0) {
    const permission = /EACCES|EPERM|permission denied/i.test(output);
    throw new Error([
      `Failed to install ${spec} (npm exit ${code}).`,
      permission
        ? "This looks like a permissions problem (EACCES/EPERM). Fix the npm global prefix instead of using sudo, e.g.: npm config set prefix ~/.npm-global && export PATH=\"$HOME/.npm-global/bin:$PATH\" — or rerun with sudo if you understand the implications."
        : "Check the npm output above, fix the network/registry, and retry.",
      "Then run `galcode setup` again."
    ].join(" "));
  }

  const installed = await resolveDshInstallation(options);
  if (!installed) {
    throw new Error(`npm reported success but dsh is still not resolvable. Check that the npm global bin directory is on PATH (npm prefix -g), then run \`galcode setup\` again.`);
  }
  if (installed.warning) console.warn(`WARNING: ${installed.warning}`);
  log(`dsh ready: ${installed.version} (${installed.source})`);
  return installed;
}

export function readGalcodeVersion() {
  try {
    const manifest = JSON.parse(fssync.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
    return manifest.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function dshGalcodeBundleDir() {
  return path.join(PACKAGE_ROOT, "packages", "dsh-galcode");
}

export async function readProfileManifest(profileDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(profileDir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

export function profileReadiness(manifest, profileDir) {
  const problems = [];
  if (!manifest) {
    problems.push("package.json missing");
    return problems;
  }
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  for (const required of [DSH_BASE_BUNDLE, DSH_TUI_PACKAGE, DSH_BUNDLE_PACKAGE]) {
    if (!bundles.includes(required)) problems.push(`bundle list missing ${required}`);
  }
  const nodeModules = path.join(profileDir, "node_modules");
  if (!fssync.existsSync(path.join(nodeModules, ...DSH_TUI_PACKAGE.split("/")))) problems.push(`${DSH_TUI_PACKAGE} not installed`);
  if (!fssync.existsSync(path.join(nodeModules, DSH_BUNDLE_PACKAGE))) problems.push(`${DSH_BUNDLE_PACKAGE} not installed`);
  return problems;
}

// Let dsh own profile creation, dependency installation and bundle membership.
// Re-running `plugin add` reconciles the same packages without discarding user
// dependencies, bundle ordering or the profile's cordis.patch.yml layer.
export async function setupDshProfile(options = {}) {
  const home = resolveDshHome(options.dshHome);
  const profileDir = resolveProfileDir(home);
  const log = options.log || ((line) => console.log(line));
  log(`dsh home: ${home}`);
  log(`profile: ${profileDir}`);

  const ensureDsh = options.ensureDsh || ensureDshInstallation;
  const dsh = options.dsh || await ensureDsh({ log });
  const pnpmBinDir = path.join(PACKAGE_ROOT, "node_modules", ".bin");
  const env = {
    ...process.env,
    DSH_HOME: home,
    PATH: `${pnpmBinDir}${path.delimiter}${process.env.PATH || ""}`
  };
  log("installing profile bundles with dsh plugin...");
  const bundleSpec = `link:${dshGalcodeBundleDir().split(path.sep).join("/")}`;
  const install = options.install ?? (() => run(process.execPath, [
    dsh.jsPath,
    "plugin",
    "--profile", DSH_PROFILE_NAME,
    "add", `${DSH_TUI_PACKAGE}@${DSH_TUI_VERSION}`, bundleSpec
  ], { cwd: PACKAGE_ROOT, env }));
  await install(profileDir, dsh);

  const manifest = await readProfileManifest(profileDir);
  const problems = profileReadiness(manifest, profileDir);
  if (problems.length > 0) {
    throw new Error(`profile install incomplete: ${problems.join("; ")}`);
  }

  log("verifying composed configuration (dsh --dump-config)...");
  const verify = options.verify ?? (async () => {
    const dump = await collectOutput(process.execPath, [dsh.jsPath, "--profile", DSH_PROFILE_NAME, "--dump-config"], {
      cwd: profileDir,
      env: { ...env, GALCODE_MCP_SERVER: galcodeMcpServerPath() }
    });
    const requiredRows = ["mcp-galcode", "preset-galcode", "@deepseek-ai/dsh-mcp-client", "@deepseek-ai/dsh-agent-preset", DSH_TUI_PACKAGE, DSH_BUNDLE_PACKAGE];
    const missing = requiredRows.filter((needle) => !dump.includes(needle));
    if (missing.length > 0) {
      const dumpLog = path.join(profileDir, "galcode-dump-config.yml");
      await fs.writeFile(dumpLog, dump, "utf8");
      throw new Error(`dump-config self-check failed, missing: ${missing.join(", ")} (full dump: ${dumpLog})`);
    }
  });
  await verify(profileDir);
  log("self-check OK: mcp-galcode, preset-galcode, dsh-tui, dsh-galcode all present");
  log("");
  log("Galcode profile ready. Run `galcode` to start the studio.");
  return { home, profileDir };
}

// Launch dsh with the galcode profile, inheriting the terminal for the TUI.
// Auto-installs dsh when missing, auto-runs setup on first use. Returns the
// child exit code.
export async function launchDsh(options = {}) {
  const home = resolveDshHome(options.dshHome);
  const profileDir = resolveProfileDir(home);
  const dsh = await ensureDshInstallation({ log: (line) => console.log(line) });
  const manifest = await readProfileManifest(profileDir);
  const problems = profileReadiness(manifest, profileDir);
  if (problems.length > 0) {
    console.log("Galcode 首次运行,正在初始化 dsh profile……");
    await setupDshProfile({ dshHome: options.dshHome });
  }
  const dshArgs = [dsh.jsPath, "--profile", DSH_PROFILE_NAME, ...(options.args ?? [])];
  const child = spawn(process.execPath, dshArgs, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      DSH_HOME: home,
      GALCODE_MCP_SERVER: galcodeMcpServerPath()
    }
  });
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (typeof code === "number") resolve(code);
      else if (signal === "SIGINT") resolve(130);
      else resolve(1);
    });
  });
}

export async function doctorDsh(options = {}) {
  const home = resolveDshHome(options.dshHome);
  const profileDir = resolveProfileDir(home);
  const rows = [];
  const push = (name, value, ok, advisory = false) => rows.push({ name, value, ok, advisory });

  const [major, minor] = process.versions.node.split(".").map((part) => Number(part));
  const nodeOk = major >= 24 || (major === 22 && minor >= 19);
  push("Node.js ^22.19 || >=24", process.version, nodeOk);

  const dsh = await resolveDshInstallation();
  push(
    "dsh CLI",
    dsh
      ? `${dsh.version || "?"} (${dsh.source}: ${dsh.jsPath})${dsh.compatible ? "" : ` — incompatible, upgrade: npm i -g ${DSH_PACKAGE}@${DSH_MIN_VERSION}`}`
      : `not found — will be auto-installed on first run (npm i -g ${DSH_PACKAGE}@${DSH_MIN_VERSION})`,
    Boolean(dsh && dsh.compatible)
  );

  let pnpmCli = "";
  try { pnpmCli = resolvePnpmCliJs(); } catch { pnpmCli = ""; }
  push("pnpm (bundled)", pnpmCli, Boolean(pnpmCli));

  push("DSH_HOME", `${home}${process.env.DSH_HOME ? " (from env)" : " (default)"}`, true);

  const manifest = await readProfileManifest(profileDir);
  const problems = profileReadiness(manifest, profileDir);
  push("dsh profile galcode", problems.length === 0 ? profileDir : `${profileDir} — ${problems.join("; ")} (run \`galcode setup\`)`, problems.length === 0);

  const webgalDir = path.join(PACKAGE_ROOT, "vendor", "webgal-mygo");
  const webgalPackage = path.join(webgalDir, "packages", "webgal", "package.json");
  push("WebGAL engine", webgalPackage, fssync.existsSync(webgalPackage));
  const webgalModules = path.join(webgalDir, "node_modules");
  push("WebGAL node_modules", webgalModules, fssync.existsSync(webgalModules));
  const parserBuild = path.join(webgalDir, "packages", "parser", "build", "es", "index.js");
  push("WebGAL parser build", parserBuild, fssync.existsSync(parserBuild));

  const live2dLib = path.join(webgalDir, "packages", "webgal", "public", "lib");
  const live2dMissing = ["live2d.min.js", "live2dcubismcore.min.js"].filter((file) => !fssync.existsSync(path.join(live2dLib, file)));
  const coreProbe = probeCubismCoreGeneration(live2dLib);
  const live2dValue = live2dMissing.length === 0
    ? `${live2dLib} — ${coreProbe.note}`
    : `missing ${live2dMissing.join(", ")} (Live2D disabled; see skill live2d-licensing)`;
  push("Live2D runtime", live2dValue, live2dMissing.length === 0 && coreProbe.generation !== 4, true);

  const ffmpeg = await probeCommand("ffmpeg", ["-version"]);
  push("ffmpeg (required for `galcode record`)", ffmpeg || "not found — recording unavailable; install ffmpeg", Boolean(ffmpeg), true);

  const recorderBrowser = await recorderBrowserStatus();
  push("Recorder browser (chrome-headless-shell)", recorderBrowser.detail, recorderBrowser.ok, true);

  console.log("Galcode Doctor");
  console.log(`Root: ${PACKAGE_ROOT}`);
  for (const row of rows) {
    const mark = row.ok ? "[OK]  " : row.advisory ? "[WARN]" : "[MISS]";
    console.log(`${mark} ${row.name}: ${row.value}`);
  }
  const failed = rows.filter((row) => !row.ok && !row.advisory);
  if (failed.length > 0) {
    console.log("");
    if (options.advisory) {
      console.log(`Advisory mode: ${failed.length} component(s) missing but exit code stays 0 (CI smoke).`);
    } else {
      console.log(`Missing ${failed.length} required component(s). Run \`galcode setup\` for profile issues, or ./install.sh (install.bat on Windows) for WebGAL engine issues.`);
      process.exitCode = 1;
    }
  }
  return rows;
}

function probeCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk.toString(); });
    child.stderr.on("data", (chunk) => { text += chunk.toString(); });
    child.on("error", () => resolve(""));
    child.on("exit", (code) => resolve(code === 0 ? text.split(/\r?\n/)[0] || command : ""));
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true, ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function collectOutput(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs, ...spawnOptions } = options;
    const child = spawn(command, args, { ...spawnOptions, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = timeoutMs
      ? setTimeout(() => {
          killChildTree(child);
          reject(new Error(`${path.basename(command)} ${args.join(" ")} timed out after ${timeoutMs} ms`));
        }, timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(command)} ${args.join(" ")} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
