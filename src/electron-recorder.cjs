#!/usr/bin/env node
"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = parseArgs(process.argv.slice(2));
const width = Number(args.width || 1920);
const height = Number(args.height || 1080);
const fps = Number(args.fps || 60);
const duration = Number(args.duration || 180);
const url = args.url;
const out = path.resolve(args.out || "final.mp4");
const ffmpeg = args.ffmpeg || "ffmpeg";
const startDelay = Number(args.startDelay || 1500);

if (!url) fail("Missing --url");

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.whenReady().then(main).catch(fail);

async function main() {
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const win = new BrowserWindow({
    show: false,
    width,
    height,
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

  const expectedFrameBytes = width * height * 4;

  await win.loadURL(url);
  await sleep(500);
  if (!args.noAutoplay) await autoplay(win);
  await sleep(startDelay);

  const captureStart = Date.now();

  // === capturePage pipeline ===
  // Start first capture immediately; at each tick we await it,
  // write the bitmap, then fire the next capture. This pipelines
  // the async capturePage call so we never wait for it cold.
  const rawFile = path.join(os.tmpdir(), `galcode-electron-${process.pid}.bgra`);
  const fd = fs.openSync(rawFile, "w");

  let frameCount = 0;
  let gameEnded = false;
  let lastTitleCheck = 0;
  const captureEnd = captureStart + duration * 1000;
  const titleCheckIntervalMs = 2000;
  const frameIntervalMs = 1000 / fps;

  // Prime the pipeline
  let pendingCapture = win.webContents.capturePage();
  let loggedFrameInfo = false;

  try {
    let nextCaptureTime = performance.now();

    while (Date.now() < captureEnd && !gameEnded) {
      // Wait until next tick deadline
      const delay = nextCaptureTime - performance.now();
      if (delay > 1) await sleep(delay - 0.5);
      while (performance.now() < nextCaptureTime) { /* spin for sub-ms precision */ }

      // Resolve the pre-fetched capture
      const image = await pendingCapture;

      // Fire next capture immediately (pipelining hides latency)
      pendingCapture = win.webContents.capturePage();

      // Convert to bitmap and write
      const frameImage = image.resize({ width, height, quality: "best" });
      const bitmap = frameImage.toBitmap();

      if (!loggedFrameInfo) {
        console.error(`Galcode electron capturePage: ${image.getSize().width}x${image.getSize().height} -> ${width}x${height}, ${bitmap.length} bytes`);
        loggedFrameInfo = true;
      }

      if (bitmap.length !== expectedFrameBytes) {
        const fixed = Buffer.alloc(expectedFrameBytes);
        bitmap.copy(fixed, 0, 0, Math.min(bitmap.length, expectedFrameBytes));
        fs.writeSync(fd, fixed);
      } else {
        fs.writeSync(fd, bitmap);
      }
      frameCount++;
      nextCaptureTime += frameIntervalMs;

      // Drift correction
      if (nextCaptureTime < performance.now() - frameIntervalMs * 2) {
        console.error(`Galcode electron: drift corrected at frame ${frameCount}`);
        nextCaptureTime = performance.now() + frameIntervalMs;
      }

      // Game-end detection (every 2s after 10s)
      const wallElapsed = Date.now() - captureStart;
      if (!gameEnded && wallElapsed > 10000 && wallElapsed - lastTitleCheck >= titleCheckIntervalMs) {
        lastTitleCheck = wallElapsed;
        const onTitle = await win.webContents.executeJavaScript(`
          (() => {
            const buttons = document.querySelectorAll('.Title_button, [class*="Title_button"]');
            return Array.from(buttons).some(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          })()
        `, true).catch(() => false);
        if (onTitle) {
          console.error(`Galcode electron game ended at ${Math.round(wallElapsed / 1000)}s (frame ${frameCount})`);
          gameEnded = true;
          const titleEnd = Date.now() + 3000;
          while (Date.now() < titleEnd) {
            const td = nextCaptureTime - performance.now();
            if (td > 1) await sleep(td - 0.5);
            while (performance.now() < nextCaptureTime) { /* spin */ }
            const img = await pendingCapture;
            pendingCapture = win.webContents.capturePage();
            const fImg = img.resize({ width, height, quality: "best" });
            const bmp = fImg.toBitmap();
            if (bmp.length !== expectedFrameBytes) {
              const fix = Buffer.alloc(expectedFrameBytes);
              bmp.copy(fix, 0, 0, Math.min(bmp.length, expectedFrameBytes));
              fs.writeSync(fd, fix);
            } else {
              fs.writeSync(fd, bmp);
            }
            frameCount++;
            nextCaptureTime += frameIntervalMs;
            if (nextCaptureTime < performance.now() - frameIntervalMs * 2) {
              nextCaptureTime = performance.now() + frameIntervalMs;
            }
          }
          break;
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  const wallSec = Math.round((Date.now() - captureStart) / 1000);
  console.error(`Galcode electron captured ${frameCount} frames in ${wallSec}s (target ${fps} fps)`);

  const rawSize = fs.statSync(rawFile).size;
  console.error(`Galcode electron raw file: ${rawSize} bytes (expected ${frameCount * expectedFrameBytes})`);

  // === Encode with ffmpeg ===
  // capturePage gives us the true screen content at each tick — no more
  // minterpolate needed. Simple fps filter for uniform output.
  const { execSync } = require("node:child_process");
  const ffmpegCmd = `${ffmpeg} -y -f rawvideo -pix_fmt bgra -s ${width}x${height} -framerate ${fps} -i ${rawFile} -r ${fps} -pix_fmt yuv420p -c:v libx264 -preset ultrafast -crf 23 ${out}`;
  console.error(`Galcode electron ffmpeg: ${ffmpegCmd}`);
  try {
    execSync(ffmpegCmd, { stdio: "inherit", timeout: Math.max(120000, duration * 5000) });
  } catch (ffmpegErr) {
    console.error(`Galcode electron ffmpeg failed: ${ffmpegErr.message}`);
  }

  fs.rmSync(rawFile, { force: true });

  const outStat = fs.statSync(out, { throwIfNoEntry: false });
  console.error(`Galcode electron output: ${out} (${outStat ? outStat.size + " bytes" : "MISSING"})`);

  win.destroy();
  if (outStat && outStat.size > 0) process.exit(0);
  console.error("Galcode electron output file missing or empty");
  process.exit(1);
}

async function autoplay(win) {
  const wc = win.webContents;
  await click(wc, Math.floor(width / 2), Math.floor(height / 2));
  await waitForSelector(win, ".Title_button, [class*=\"Title_button\"]", 30000);
  await sleep(500);
  wc.sendInputEvent({ type: "keyDown", keyCode: "Space" });
  wc.sendInputEvent({ type: "keyUp", keyCode: "Space" });
  await sleep(300);
  const startButton = await getTitleStartButtonCenter(win);
  if (startButton) await click(wc, startButton.x, startButton.y);
  else if (!(await clickElementByText(win, /开始游戏|START/i))) await click(wc, Math.floor(width * 0.095), Math.floor(height * 0.26));
  await sleep(300);
  await click(wc, Math.floor(width * 0.095), Math.floor(height * 0.26));
  await waitForSelector(win, "#pixiCanvas", 30000);
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

async function click(wc, x, y) {
  wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  await sleep(120);
}

async function waitForSelector(win, selector, timeoutMs) {
  const started = Date.now();
  const quotedSelector = JSON.stringify(selector);
  while (Date.now() - started < timeoutMs) {
    const found = await win.webContents.executeJavaScript(`
(() => {
  const element = document.querySelector(${quotedSelector});
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
})()
`, true).catch(() => false);
    if (found) return;
    await sleep(250);
  }
  fail(`Timed out waiting for selector: ${selector}`);
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
