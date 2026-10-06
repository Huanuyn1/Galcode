import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

export function resolveDshCliJs() {
  return requireFromGalcode.resolve("@deepseek-ai/dsh/lib/bin.js");
}

export function resolvePnpmCliJs() {
  return requireFromGalcode.resolve("pnpm/bin/pnpm.mjs");
}

export function readGalcodeVersion() {
  try {
    const manifest = JSON.parse(fssync.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
    return manifest.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function resolveDshVersion() {
  try {
    const manifestPath = requireFromGalcode.resolve("@deepseek-ai/dsh/package.json");
    return JSON.parse(fssync.readFileSync(manifestPath, "utf8")).version || "";
  } catch {
    return "";
  }
}

export function dshGalcodeBundleDir() {
  return path.join(PACKAGE_ROOT, "packages", "dsh-galcode");
}

// Same content dsh's initProfile writes; kept byte-compatible so the profile
// looks identical whether `galcode setup` or `dsh plugin` created it.
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`;

const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`;

function pnpmSpecForLocalDir(absoluteDir) {
  // pnpm accepts absolute file: specs; forward slashes keep the spec valid on
  // Windows too (C:/Users/...), where backslashes would be misparsed.
  return `file:${absoluteDir.split(path.sep).join("/")}`;
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

// Idempotent profile init: create/refresh $DSH_HOME/profiles/galcode, install
// its dependencies with the pnpm bundled in this package, then verify the
// composed configuration with `dsh --dump-config`.
export async function setupDshProfile(options = {}) {
  const home = resolveDshHome(options.dshHome);
  const profileDir = resolveProfileDir(home);
  const log = options.log || ((line) => console.log(line));
  log(`dsh home: ${home}`);
  log(`profile: ${profileDir}`);

  await fs.mkdir(profileDir, { recursive: true });

  const manifestPath = path.join(profileDir, "package.json");
  const existing = await readProfileManifest(profileDir) ?? {};
  const bundleSpec = pnpmSpecForLocalDir(dshGalcodeBundleDir());
  const dependencies = {
    ...(existing.dependencies ?? {}),
    [DSH_TUI_PACKAGE]: DSH_TUI_VERSION,
    [DSH_BUNDLE_PACKAGE]: bundleSpec
  };
  const previousBundles = Array.isArray(existing?.dsh?.profile?.bundles) ? existing.dsh.profile.bundles : [];
  const bundles = [DSH_BASE_BUNDLE];
  for (const extra of [DSH_TUI_PACKAGE, DSH_BUNDLE_PACKAGE, ...previousBundles]) {
    if (!bundles.includes(extra)) bundles.push(extra);
  }
  const manifest = {
    name: "dsh-profile-galcode",
    private: true,
    ...existing,
    dependencies,
    dsh: {
      ...(existing.dsh ?? {}),
      profile: {
        ...(existing?.dsh?.profile ?? {}),
        bundles
      }
    }
  };
  const nextText = `${JSON.stringify(manifest, null, 2)}\n`;
  let wroteManifest = false;
  try {
    const current = await fs.readFile(manifestPath, "utf8");
    wroteManifest = current !== nextText;
  } catch {
    wroteManifest = true;
  }
  if (wroteManifest) {
    await fs.writeFile(manifestPath, nextText, "utf8");
    log("wrote package.json");
  } else {
    log("package.json: up to date");
  }

  const patchPath = path.join(profileDir, "cordis.patch.yml");
  if (!fssync.existsSync(patchPath)) {
    await fs.writeFile(patchPath, PROFILE_PATCH_TEMPLATE, "utf8");
    log("wrote cordis.patch.yml (empty user layer)");
  }
  const workspacePath = path.join(profileDir, "pnpm-workspace.yaml");
  if (!fssync.existsSync(workspacePath)) {
    await fs.writeFile(workspacePath, PROFILE_PNPM_WORKSPACE, "utf8");
    log("wrote pnpm-workspace.yaml");
  }

  log("installing profile dependencies with pnpm...");
  const install = options.install ?? (() => run(process.execPath, [resolvePnpmCliJs(), "install"], {
    cwd: profileDir,
    env: { ...process.env, DSH_HOME: home }
  }));
  await install(profileDir);

  const problems = profileReadiness(manifest, profileDir);
  if (problems.length > 0) {
    throw new Error(`profile install incomplete: ${problems.join("; ")}`);
  }

  log("verifying composed configuration (dsh --dump-config)...");
  const verify = options.verify ?? (async () => {
    const dump = await collectOutput(process.execPath, [resolveDshCliJs(), "--profile", DSH_PROFILE_NAME, "--dump-config"], {
      cwd: profileDir,
      env: { ...process.env, DSH_HOME: home, GALCODE_MCP_SERVER: galcodeMcpServerPath() }
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
// Auto-runs setup on first use. Returns the child exit code.
export async function launchDsh(options = {}) {
  const home = resolveDshHome(options.dshHome);
  const profileDir = resolveProfileDir(home);
  const manifest = await readProfileManifest(profileDir);
  const problems = profileReadiness(manifest, profileDir);
  if (problems.length > 0) {
    console.log("Galcode 首次运行,正在初始化 dsh profile……");
    await setupDshProfile({ dshHome: options.dshHome });
  }
  const dshArgs = [resolveDshCliJs(), "--profile", DSH_PROFILE_NAME, ...(options.args ?? [])];
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

  const dshVersion = resolveDshVersion();
  let dshBin = "";
  try { dshBin = resolveDshCliJs(); } catch { dshBin = ""; }
  push("dsh CLI", dshVersion ? `${dshVersion} (${dshBin})` : "not found", Boolean(dshVersion && dshBin));

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
  push("Live2D runtime", live2dMissing.length === 0 ? live2dLib : `missing ${live2dMissing.join(", ")} (Live2D disabled; see skill live2d-licensing)`, live2dMissing.length === 0, true);

  const ffmpeg = await probeCommand("ffmpeg", ["-version"]);
  push("ffmpeg (advisory)", ffmpeg || "not found — only needed for external post-processing", Boolean(ffmpeg), true);

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
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(command)} ${args.join(" ")} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
