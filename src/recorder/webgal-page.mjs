// WebGAL page preparation for recording, ported from the deleted recorder
// (legacy prepareRecordPage / autoplay / ensureLanguageSelected): seed the
// language keys before page scripts run, survive the LANGUAGE SELECT screen,
// click through the title screen, then start the Space-key auto-advancer
// (~4s per line, WebGAL-proven cadence).
//
// All DOM probing goes through page.evaluate so the same helpers work in
// realtime mode and between beginFrame pumps in deterministic mode.

const TITLE_SELECTOR = ".Title_button, [class*=\"Title_button\"]";
const CANVAS_SELECTOR = "#pixiCanvas, canvas";
const LANGUAGE_CLICK_PATTERN = /简体中文|简体|中文|Chinese|CHS|日本語|English/i;
const START_CLICK_PATTERN = /开始游戏|继续游戏|COMMENCER|CONTINUER|开始|继续|START|CONTINUE/i;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Must be registered before page.goto: seeds WebGAL's language localStorage
// keys so the LANGUAGE SELECT screen is skipped entirely when possible.
export async function installLanguagePreset(page) {
  await page.evaluateOnNewDocument(() => {
    try {
      if (localStorage.getItem("lang") === null) localStorage.setItem("lang", "0");
      if (localStorage.getItem("language") === null) localStorage.setItem("language", "zhCn");
      if (localStorage.getItem("i18nextLng") === null) localStorage.setItem("i18nextLng", "zh-CN");
    } catch { /* storage blocked; the click path below still works */ }
  });
}

export async function bodyText(page) {
  return await page.evaluate(() => document.body?.innerText || "").catch(() => "");
}

export async function isSelectorVisible(page, selector) {
  return Boolean(await page.evaluate((quoted) => {
    const element = document.querySelector(JSON.parse(quoted));
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, JSON.stringify(selector)).catch(() => false));
}

export async function isTitleVisible(page) {
  return await isSelectorVisible(page, TITLE_SELECTOR);
}

export async function waitForAnySelector(page, selectors, timeoutMs, { pollMs = 250 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const selector of selectors) {
      if (await isSelectorVisible(page, selector)) return selector;
    }
    await sleep(pollMs);
  }
  const body = (await bodyText(page)).slice(0, 500).replace(/\s+/g, " ");
  throw new Error(`Timed out waiting for selector: ${selectors.join(" or ")}. Body: ${body}`);
}

async function clickAt(page, x, y) {
  await page.mouse.click(Math.round(x), Math.round(y)).catch(() => {});
  await sleep(120);
}

// Clicks the shortest matching visible element, with full synthetic mouse
// event dispatch (WebGAL listens on bubbling handlers, not just click).
export async function clickElementByText(page, pattern) {
  return Boolean(await page.evaluate((source, flags) => {
    const re = new RegExp(source, flags);
    const elements = Array.from(document.querySelectorAll('button,[role="button"],a,div,span'));
    const candidates = elements
      .map((element) => {
        const text = (element.innerText || element.textContent || "").trim();
        const rect = element.getBoundingClientRect();
        return { element, text, rect };
      })
      .filter((item) => re.test(item.text) && item.rect.width > 0 && item.rect.height > 0)
      .sort((a, b) => a.text.length - b.text.length || (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
    const target = candidates[0]?.element;
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    }
    return true;
  }, pattern.source, pattern.flags).catch(() => false));
}

async function getTitleStartButtonCenter(page) {
  return await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("[class]"))
      .filter((element) => {
        const className = String(element.className || "");
        return className.includes("Title_button")
          && !className.includes("Title_buttonList")
          && !className.includes("Title_button_text")
          && !className.includes("Title_button_disabled");
      })
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter((item) => item.rect.width > 0 && item.rect.height > 0)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const target = buttons[0]?.element;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }).catch(() => null);
}

export async function ensureLanguageSelected(page, { width, height, log = () => {} } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const text = await bodyText(page);
    if (!/LANGUAGE SELECT|语言选择|Language Select/i.test(text)) return;
    const clicked = await clickElementByText(page, LANGUAGE_CLICK_PATTERN);
    if (!clicked) await clickAt(page, width * 0.11, height * 0.55);
    log("Selected language from WebGAL language screen");
    await sleep(1000);
  }
  // Last resort: force the language keys and reload.
  const forced = await page.evaluate(() => {
    try {
      localStorage.setItem("lang", localStorage.getItem("lang") || "0");
      localStorage.setItem("language", localStorage.getItem("language") || "zhCn");
      localStorage.setItem("i18nextLng", localStorage.getItem("i18nextLng") || "zh-CN");
      location.reload();
      return true;
    } catch {
      return false;
    }
  }).catch(() => false);
  if (forced) {
    log("Forced default WebGAL language in localStorage");
    await sleep(1500);
  }
}

// Full title/language bypass + auto-advance, WebGAL-proven sequence.
export async function prepareWebGALPage(page, {
  width,
  height,
  startDelayMs = 1500,
  sceneDelayMs = 8000,
  noAutoplay = false,
  autoAdvanceIntervalMs = 4000,
  log = () => {}
} = {}) {
  await sleep(500);
  if (noAutoplay) {
    await sleep(startDelayMs);
    return;
  }

  await ensureLanguageSelected(page, { width, height, log });
  await clickAt(page, width / 2, height / 2);

  await waitForAnySelector(page, [TITLE_SELECTOR, CANVAS_SELECTOR], 30000);
  if (await isTitleVisible(page)) {
    await sleep(500);
    await page.keyboard.press("Space").catch(() => {});
    await sleep(300);
    const startButton = await getTitleStartButtonCenter(page);
    if (startButton) await clickAt(page, startButton.x, startButton.y);
    else if (!(await clickElementByText(page, START_CLICK_PATTERN))) await clickAt(page, width * 0.095, height * 0.26);
    await sleep(300);
    if (await isTitleVisible(page)) {
      await clickAt(page, width * 0.095, height * 0.26);
    }
  }

  await waitForAnySelector(page, [CANVAS_SELECTOR], 30000);
  await sleep(sceneDelayMs);

  if (autoAdvanceIntervalMs > 0) await startAutoAdvance(page, autoAdvanceIntervalMs, log);
  await sleep(startDelayMs);
}

// Space every ~4s, dispatched as synthetic key events on document — this is
// what WebGAL's dialogue advance handler listens to (proven in the Electron
// recorder; CDP-level keyboard.press does not reach it as reliably).
export async function startAutoAdvance(page, intervalMs = 4000, log = () => {}) {
  await page.evaluate((interval) => {
    function sendKey() {
      const make = (type) => {
        const event = new KeyboardEvent(type, { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true });
        try { Object.defineProperty(event, "keyCode", { get: () => 32 }); } catch { /* ignore */ }
        try { Object.defineProperty(event, "which", { get: () => 32 }); } catch { /* ignore */ }
        return event;
      };
      document.dispatchEvent(make("keydown"));
      document.dispatchEvent(make("keyup"));
    }
    window.__galcodeAutoInterval = setInterval(sendKey, interval);
  }, autoAdvanceIntervalMsValue(intervalMs)).catch(() => {});
  log(`Auto-advance: Space every ${intervalMs} ms`);
}

function autoAdvanceIntervalMsValue(intervalMs) {
  return Math.max(250, Number(intervalMs) || 4000);
}

// Deterministic-mode advancer: driven by rAF so it follows the virtual frame
// clock under HeadlessExperimental.beginFrame, not the wall clock. advanceEvery
// is counted in frames (e.g. 4s * fps).
export async function startVirtualAutoAdvance(page, advanceEveryFrames) {
  await page.evaluate((every) => {
    function sendKey() {
      const make = (type) => new KeyboardEvent(type, { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true });
      document.dispatchEvent(make("keydown"));
      document.dispatchEvent(make("keyup"));
    }
    window.__galcodeRafTicks = window.__galcodeRafTicks || 0;
    window.__galcodeVirtualAdvances = window.__galcodeVirtualAdvances || 0;
    const step = () => {
      window.__galcodeRafTicks += 1;
      if (window.__galcodeRafTicks % every === 0) {
        window.__galcodeVirtualAdvances += 1;
        sendKey();
      }
      window.__galcodeVirtualAdvancer = requestAnimationFrame(step);
    };
    if (!window.__galcodeVirtualAdvancer) window.__galcodeVirtualAdvancer = requestAnimationFrame(step);
  }, Math.max(1, Math.round(advanceEveryFrames))).catch(() => {});
}

export async function readVirtualClock(page) {
  return await page.evaluate(() => ({
    rafTicks: window.__galcodeRafTicks || 0,
    advances: window.__galcodeVirtualAdvances || 0
  })).catch(() => ({ rafTicks: 0, advances: 0 }));
}

// Authoritative runtime check: the moc3 format version the page's
// live2dcubismcore.min.js actually supports (null = core not loaded).
export async function probePageCubismCore(page) {
  return await page.evaluate(() => {
    try {
      const version = window.Live2DCubismCore?.Version;
      return typeof version?.csmGetLatestMocVersion === "function" ? version.csmGetLatestMocVersion() : null;
    } catch {
      return null;
    }
  }).catch(() => null);
}

// Unified virtual clock for deterministic (beginFrame) mode.
//
// Measured on chrome-headless-shell 155: HeadlessExperimental.beginFrame
// controls WHEN rAF fires (one callback per frame), but the rAF timestamp,
// performance.now, Date.now and DOM timers all stay on the WALL clock. Under
// software rendering a frame takes far longer than 1/fps wall time, so
// wall-clocked animation (PIXI ticker's rAF-timestamp deltaMS; pixi-live2d-
// display's performance.now motion/fade stamps) plays several times too fast.
// Emulation.setVirtualTimePolicy was probed too: it virtualizes
// performance.now/Date.now/timers but NOT the rAF timestamp — still broken.
//
// So deterministic mode owns the clock in-page: one rAF hook (installed before
// any page script, re-registered first each frame) counts frames; every frame
// advances the virtual clock by exactly frameMs, and rAF timestamps /
// performance.now / Date.now / setTimeout / setInterval all read from it.
export async function installVirtualClock(page, frameMs) {
  await page.evaluateOnNewDocument((frameMs) => {
    const realPerformanceNow = performance.now.bind(performance);
    const realDateNow = Date.now.bind(Date);
    const realRaf = window.requestAnimationFrame.bind(window);
    const realCancelRaf = window.cancelAnimationFrame?.bind(window);
    const perfBase = realPerformanceNow();
    const dateBase = realDateNow();

    let frames = 0;
    let virtualMs = 0;
    let nextTimerId = 1;
    const timers = new Map();

    performance.now = () => perfBase + virtualMs;
    Date.now = () => dateBase + virtualMs;
    window.__galcodeVirtualNow = () => virtualMs;

    // rAF still fires once per beginFrame; only the timestamp argument is
    // replaced with the virtual frame time.
    window.requestAnimationFrame = (callback) => realRaf(() => callback(perfBase + virtualMs));
    if (realCancelRaf) window.cancelAnimationFrame = (id) => realCancelRaf(id);

    window.setTimeout = (fn, delay = 0, ...args) => {
      const id = nextTimerId++;
      timers.set(id, { due: virtualMs + Math.max(0, Number(delay) || 0), fn, args, interval: 0 });
      return id;
    };
    window.setInterval = (fn, delay = 0, ...args) => {
      const id = nextTimerId++;
      const every = Math.max(1, Number(delay) || 0);
      timers.set(id, { due: virtualMs + every, fn, args, interval: every });
      return id;
    };
    window.clearTimeout = (id) => timers.delete(id);
    window.clearInterval = (id) => timers.delete(id);

    function tick() {
      frames += 1;
      virtualMs = frames * frameMs;
      // Snapshot semantics: timers scheduled by callbacks during this pass
      // fire on a later frame, so a setTimeout(fn, 0) chain cannot starve a
      // frame. Sub-frame intervals are quantized to frame boundaries.
      for (const [id, timer] of [...timers]) {
        if (timer.due > virtualMs) continue;
        try {
          timer.fn(...timer.args);
        } catch (error) {
          console.error("[galcode virtual clock] timer callback failed:", error);
        }
        if (timer.interval) {
          timer.due += timer.interval;
          if (timer.due <= virtualMs) timer.due = virtualMs + timer.interval;
        } else {
          timers.delete(id);
        }
      }
      realRaf(tick);
    }
    realRaf(tick);
  }, frameMs);
}
