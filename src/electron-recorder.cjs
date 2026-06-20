#!/usr/bin/env node
"use strict";

const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const isWindows = process.platform === "win32";
const width = Number(args.width || 1920);
const height = Number(args.height || 1080);
const fps = Number(args.fps || 60);
const duration = Number(args.duration || 180);
const url = args.url;
const out = path.resolve(args.out || "final.mp4");
const ffmpeg = args.ffmpeg || "ffmpeg";
const startDelay = Number(args.startDelay || 1500);

if (!url) fail("Missing --url");

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
app.on("render-process-gone", (_event, _webContents, details) => {
  console.error(`Galcode electron render process gone: ${details.reason} (${details.exitCode})`);
});
app.on("child-process-gone", (_event, details) => {
  console.error(`Galcode electron child process gone: ${details.type} ${details.reason} (${details.exitCode})`);
});
app.on("gpu-process-crashed", (_event, killed) => {
  console.error(`Galcode electron GPU process crashed; killed=${killed}`);
});

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("enable-webgl");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
if (isWindows) {
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

app.whenReady().then(main).catch(fail);

async function main() {
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const win = new BrowserWindow({
    show: false,
    width,
    height,
    backgroundColor: "#000000",
    paintWhenInitiallyHidden: true,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.webContents.setFrameRate(fps);
  win.webContents.audioMuted = true;
  win.webContents.on("did-fail-load", (_event, code, description, failedUrl) => {
    console.error(`Galcode electron failed to load ${failedUrl}: ${code} ${description}`);
  });
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`WebGAL console: ${message} (${sourceId}:${line})`);
  });

  const expectedFrameBytes = width * height * 4;

  await win.loadURL(url);
  await sleep(500);
  if (!args.noAutoplay) await autoplay(win);
  await sleep(startDelay);

  const captureStart = Date.now();

  const encoder = startFfmpegEncoder({ ffmpeg, out, width, height, fps });
  let frameCount = 0;
  let gameEnded = false;
  let lastTitleCheck = 0;
  const targetFrames = Math.max(1, Math.round(duration * fps));
  const titleCheckIntervalMs = 2000;
  const frameIntervalMs = 1000 / fps;
  let loggedFrameInfo = false;

  console.error(`Galcode electron recording: ${width}x${height} @ ${fps} fps, ${duration}s -> ${out}`);

  try {
    let nextCaptureTime = performance.now();

    while (frameCount < targetFrames && !gameEnded) {
      const delay = nextCaptureTime - performance.now();
      if (delay > 0) await sleep(delay);
      loggedFrameInfo = await captureFrame(win, encoder, {
        width,
        height,
        expectedFrameBytes,
        loggedFrameInfo
      });
      frameCount++;
      nextCaptureTime += frameIntervalMs;

      if (nextCaptureTime < performance.now() - frameIntervalMs * 5) {
        console.error(`Galcode electron: capture is behind at frame ${frameCount}; continuing without catch-up burst`);
        nextCaptureTime = performance.now();
      }

      const wallElapsed = Date.now() - captureStart;
      if (!gameEnded && wallElapsed > 10000 && wallElapsed - lastTitleCheck >= titleCheckIntervalMs) {
        lastTitleCheck = wallElapsed;
        const onTitle = await isSelectorVisible(win, ".Title_button, [class*=\"Title_button\"]");
        if (onTitle) {
          console.error(`Galcode electron game ended at ${Math.round(wallElapsed / 1000)}s (frame ${frameCount})`);
          gameEnded = true;
          const tailFrames = Math.round(3 * fps);
          for (let i = 0; i < tailFrames; i += 1) {
            const td = nextCaptureTime - performance.now();
            if (td > 0) await sleep(td);
            loggedFrameInfo = await captureFrame(win, encoder, {
              width,
              height,
              expectedFrameBytes,
              loggedFrameInfo
            });
            frameCount++;
            nextCaptureTime += frameIntervalMs;
          }
          break;
        }
      }
    }
  } catch (error) {
    encoder.child.kill("SIGTERM");
    throw error;
  }

  if (frameCount === 0) throw new Error("No frames were captured.");
  encoder.stdin.end();
  await encoder.done;

  const elapsedSec = Math.max(0.001, (Date.now() - captureStart) / 1000);
  console.error(`Galcode electron captured ${frameCount} frames in ${elapsedSec.toFixed(2)}s (target ${fps} fps)`);

  const outStat = fs.statSync(out, { throwIfNoEntry: false });
  console.error(`Galcode electron output: ${out} (${outStat ? outStat.size + " bytes" : "MISSING"})`);

  win.destroy();
  if (outStat && outStat.size > 0) {
    app.exit(0);
    return;
  }
  console.error("Galcode electron output file missing or empty");
  app.exit(1);
}

async function captureFrame(win, encoder, options) {
  const { width, height, expectedFrameBytes } = options;
  const image = await win.webContents.capturePage();
  const frameImage = image.resize({ width, height, quality: "best" });
  const bitmap = frameImage.toBitmap();
  if (!options.loggedFrameInfo) {
    const size = image.getSize();
    console.error(`Galcode electron capturePage: ${size.width}x${size.height} -> ${width}x${height}, ${bitmap.length} bytes`);
  }
  await writeFrame(encoder.stdin, normalizeBitmap(bitmap, expectedFrameBytes));
  return true;
}

function normalizeBitmap(bitmap, expectedBytes) {
  if (bitmap.length === expectedBytes) return bitmap;
  const fixed = Buffer.alloc(expectedBytes);
  bitmap.copy(fixed, 0, 0, Math.min(bitmap.length, expectedBytes));
  return fixed;
}

function startFfmpegEncoder({ ffmpeg, out, width, height, fps }) {
  const ffmpegArgs = [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "bgra",
    "-s", `${width}x${height}`,
    "-framerate", String(fps),
    "-i", "pipe:0",
    "-an",
    "-r", String(fps),
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", String(args.crf || 23),
    out
  ];
  console.error(`Galcode electron ffmpeg: ${ffmpeg} ${ffmpegArgs.map(quoteArg).join(" ")}`);
  const child = spawn(ffmpeg, ffmpegArgs, {
    stdio: ["pipe", "ignore", "inherit"],
    windowsHide: true
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${ffmpeg} exited with ${code ?? signal}`));
    });
  });
  return { child, stdin: child.stdin, done };
}

async function writeFrame(stream, frame) {
  if (stream.destroyed) throw new Error("ffmpeg stdin closed before recording finished.");
  if (stream.write(frame)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

function quoteArg(value) {
  const text = String(value);
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

async function autoplay(win) {
  const wc = win.webContents;
  await ensureLanguageSelected(win);
  await click(wc, Math.floor(width / 2), Math.floor(height / 2));

  await waitForAnySelector(win, [".Title_button, [class*=\"Title_button\"]", "#pixiCanvas", "canvas"], 30000);
  if (await isSelectorVisible(win, ".Title_button, [class*=\"Title_button\"]")) {
    await sleep(500);
    wc.sendInputEvent({ type: "keyDown", keyCode: "Space" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Space" });
    await sleep(300);
    const startButton = await getTitleStartButtonCenter(win);
    if (startButton) await click(wc, startButton.x, startButton.y);
    else if (!(await clickElementByText(win, /开始游戏|继续游戏|START|CONTINUE/i))) await click(wc, Math.floor(width * 0.095), Math.floor(height * 0.26));
    await sleep(300);
    if (await isSelectorVisible(win, ".Title_button, [class*=\"Title_button\"]")) {
      await click(wc, Math.floor(width * 0.095), Math.floor(height * 0.26));
    }
  }

  await waitForAnySelector(win, ["#pixiCanvas", "canvas"], 30000);
  await sleep(Number(args.sceneDelay || 8000));

  await wc.executeJavaScript(`
    (() => {
      function sendKey() {
        const make = (type) => {
          const e = new KeyboardEvent(type, { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
          try { Object.defineProperty(e, 'keyCode', { get: () => 32 }); } catch(_) {}
          try { Object.defineProperty(e, 'which', { get: () => 32 }); } catch(_) {}
          return e;
        };
        document.dispatchEvent(make('keydown'));
        document.dispatchEvent(make('keyup'));
      }
      window.__galcodeAutoInterval = setInterval(sendKey, 4000);
    })()
  `, true).catch(() => {});
  console.error('Galcode electron: auto-advance timer started');
}

async function ensureLanguageSelected(win) {
  const wc = win.webContents;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const text = await getBodyText(win);
    if (!/LANGUAGE SELECT|语言选择|Language Select/i.test(text)) return;
    const clicked = await clickElementByText(win, /简体中文|简体|中文|Chinese|CHS|日本語|English/i);
    if (!clicked) await click(wc, Math.floor(width * 0.11), Math.floor(height * 0.55));
    console.error("Galcode electron: selected language from WebGAL language screen");
    await sleep(1000);
  }

  const forced = await wc.executeJavaScript(`
(() => {
  try {
    localStorage.setItem('lang', localStorage.getItem('lang') || '0');
    localStorage.setItem('language', localStorage.getItem('language') || 'zhCn');
    localStorage.setItem('i18nextLng', localStorage.getItem('i18nextLng') || 'zh-CN');
    location.reload();
    return true;
  } catch (_) {
    return false;
  }
})()
`, true).catch(() => false);
  if (forced) {
    console.error("Galcode electron: forced default WebGAL language in localStorage");
    await sleep(1500);
  }
}

async function click(wc, x, y) {
  wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  await sleep(120);
}

async function waitForSelector(win, selector, timeoutMs) {
  await waitForAnySelector(win, [selector], timeoutMs);
}

async function waitForAnySelector(win, selectors, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const selector of selectors) {
      if (await isSelectorVisible(win, selector)) return selector;
    }
    await sleep(250);
  }
  await saveDebugCapture(win, "timeout");
  const body = await getBodyText(win);
  throw new Error(`Timed out waiting for selector: ${selectors.join(" or ")}. Body: ${body.slice(0, 500).replace(/\s+/g, " ")}`);
}

async function isSelectorVisible(win, selector) {
  const quotedSelector = JSON.stringify(selector);
  return Boolean(await win.webContents.executeJavaScript(`
(() => {
  const element = document.querySelector(${quotedSelector});
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
})()
`, true).catch(() => false));
}

async function getBodyText(win) {
  return await win.webContents.executeJavaScript("document.body?.innerText || ''", true).catch(() => "");
}

async function saveDebugCapture(win, reason) {
  try {
    const image = await win.webContents.capturePage();
    const file = path.join(path.dirname(out), `electron-recorder-${reason.replace(/[^a-z0-9-]+/gi, "-")}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, image.toPNG());
    console.error(`Galcode electron debug capture: ${file}`);
  } catch (error) {
    console.error(`Galcode electron debug capture failed: ${error.message}`);
  }
}

async function clickElementByText(win, pattern) {
  const source = `
(() => {
  const pattern = ${pattern.toString()};
  const elements = Array.from(document.querySelectorAll('button,[role="button"],a,div,span'));
  const candidates = elements
    .map((element) => {
      const text = (element.innerText || element.textContent || '').trim();
      const rect = element.getBoundingClientRect();
      return { element, text, rect };
    })
    .filter((item) => pattern.test(item.text) && item.rect.width > 0 && item.rect.height > 0)
    .sort((a, b) => a.text.length - b.text.length || (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
  const target = candidates[0]?.element;
  if (!target) return false;
  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  }
  return true;
})()
`;
  return Boolean(await win.webContents.executeJavaScript(source, true).catch(() => false));
}

async function getTitleStartButtonCenter(win) {
  const source = `
(() => {
  const buttons = Array.from(document.querySelectorAll('[class]'))
    .filter((element) => {
      const className = String(element.className || '');
      return className.includes('Title_button')
        && !className.includes('Title_buttonList')
        && !className.includes('Title_button_text')
        && !className.includes('Title_button_disabled');
    })
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter((item) => item.rect.width > 0 && item.rect.height > 0)
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  const target = buttons[0]?.element;
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
})()
`;
  return await win.webContents.executeJavaScript(source, true).catch(() => null);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function fail(error) {
  console.error(error?.stack || error?.message || String(error));
  app.exit(1);
}
