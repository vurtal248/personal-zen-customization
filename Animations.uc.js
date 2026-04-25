// ==UserScript==
// @name           Animations
// @version        1.6.6
// @author         vur
// @description    JS
// @compatibility  Firefox 100+
// ==/UserScript==

(function InjectScript() {
  "use strict";

  const STYLE_ID = "obsidian-glass-anim";

  // REFACTOR: Replaced magic numbers across scripts with named animation constants
  const COMMON_TIMING = {
    maxDtStep: 0.05,
    defaultDt: 0.016,
  };

  const TAB_CLOSE = {
    durationMs: 560,         // 800→560: UI exits must feel instant, not theatrical
    safetyMs: 1400,
    antiMs: 100,             // 180→100: snappy haptic confirmation, not a bounce
    antiPx: 7.0,             // 12→7: subtle press-acknowledgement, not a recoil
    ghostDelayMs: 60,        // 90→60: tighter trail for visual cohesion
    shineDurationMs: 500,    // proportionally scaled
    opacityStart: 0.20,
    opacitySpan: 0.80,
    ghostTravelFactor: 0.72, // 0.85→0.72: more depth separation between main and ghost
    blurMaxPx: 18.0,         // 32→18: GPU-safe; 32px causes compositor thrash
    travelFactor: 1.35,
    ghostOpacityStart: 0.55,
    shinePeakOpacity: 0.80,
    shineSkewDeg: -28,
    shineStartX: -120,
    shineEndX: 220,
    settledPx: 0.05,
    spacerSpring: { stiffness: 320, damping: 38 }, // faster collapse, zero wobble
    ghostFadeOffset: 0.1,
    ghostFadeSpan: 0.9,
    spacerRemoveSafetyMs: 700,
  };

  const SEARCH_OPEN = {
    fadeMs: 260,             // 350→260: opacity resolves quickly so element feels present
    safetyMs: 1000,
    startY: 22,              // 32→22: cinematic but not theatrical travel distance
    startScaleX: 0.95,      // 0.94→0.95: barely-there scale start; real world physics
    startScaleY: 0.90,      // 0.88→0.90: same; nothing appears from nothing
    settleY: 0.01,
    settleScale: 0.0001,
  };

  const SEARCH_OPEN_SPRINGS = {
    y:  { stiffness: 480, damping: 40 }, // 420/34→480/40: faster arrival, zero overshoot
    sx: { stiffness: 440, damping: 36 }, // 380/30→440/36
    sy: { stiffness: 440, damping: 36 },
  };

  const SEARCH_CLOSE = {
    durationMs: 320,         // 450→320: dismiss must feel instant
    safetyMs: 700,
    targetY: 28,             // 36→28: proportionally scaled to tighter duration
    targetScaleX: 0.95,
    targetScaleY: 0.90,
    opacityHoldStart: 0.0,
    opacityFadeSpan: 0.85,   // 1.0→0.85: fade completes before spring settles
    settleY: 0.02,
    settleScale: 0.0001,
  };

  const SEARCH_CLOSE_SPRINGS = {
    y:  { stiffness: 420, damping: 38 }, // 340/32→420/38: crisper exit
    sy: { stiffness: 360, damping: 34 }, // 280/28→360/34
    sx: { stiffness: 360, damping: 34 },
  };

  const searchAnimationState = new WeakMap();
  // REVIEWED: no stagger sequences present in this file or needed for current interactions
  let searchObserver = null;
  let startupObserver = null;
  let tabCloseHandler = null;
  let unloadHandler = null;

  // ── Styles ──────────────────────────────────────────────────────
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* ── Tab deletion masks ─────────────────────── */
      .og-mask, .og-ghost-mask {
        position:       fixed   !important;
        pointer-events: none    !important;
        overflow:       hidden  !important;
        border-radius:  6px     !important;
      }
      .og-mask       { z-index: 9999 !important; }
      .og-ghost-mask { z-index: 9998 !important; }
 
      .og-clone, .og-ghost {
        position: absolute  !important;
        inset:    0         !important;
        width:    100%      !important;
        height:   100%      !important;
        pointer-events: none !important;
      }
      .og-clone { will-change: transform, opacity, filter !important; }
      .og-ghost {
        filter:      blur(5px) !important;
        will-change: transform, opacity, filter !important;
      }
      .og-shine {
        position:       absolute !important;
        inset:          0        !important;
        pointer-events: none     !important;
        will-change:    transform, opacity !important;
        background: linear-gradient(
          108deg,
          transparent              0%,
          rgba(255,255,255,0.00)  38%,
          rgba(255,255,255,0.50)  50%,
          rgba(255,255,255,0.00)  62%,
          transparent             100%
        ) !important;
      }
 
      /* ── Search bar entrance ────────────────────────
         We drive transform via JS springs, but we need
         transform-origin set so the expand reads as
         "growing from the bottom center" not the top.
         overflow:hidden on the urlbar container clips
         any intermediate scale state cleanly.
      ─────────────────────────────────────────────── */
      #urlbar.og-search-animating {
        transform-origin: bottom center !important;
        will-change: transform, opacity !important;
        overflow: visible !important;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Spring integrator ───────────────────────────────────────────
  function createSpring({ stiffness = 140, damping = 22 } = {}) {
    return {
      pos: 0,
      vel: 0,
      target: 0,
      stiffness,
      damping,
      step(dt) {
        const F = -this.stiffness * (this.pos - this.target) - this.damping * this.vel;
        this.vel += F * dt;
        this.pos += this.vel * dt;
        return this.pos;
      },
      settled(eps = 0.002) {
        return Math.abs(this.pos - this.target) < eps
          && Math.abs(this.vel) < eps;
      },
    };
  }

  // ── Easings ─────────────────────────────────────────────────────
  // Emil principle: ease-OUT for entering/exiting elements (immediate movement).
  // ease-IN starts slow — the exact moment users are watching most closely.
  // easeOutExpo used for all UI exit/enter slides.
  // easeInOutExpo reserved for on-screen morphs (shine sweep, ghost fade).
  const easeInExpo    = t => t * t * t * t * t;  // ⚠ use sparingly — only for deliberate stagger
  const easeOutExpo   = t => 1 - Math.pow(1 - t, 5); // primary exit/enter curve
  const easeInOutExpo = t => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function mix(a, b, weight = 0.5) {
    return a * (1 - weight) + b * weight;
  }

  function formatTranslateScale(y, sx, sy) {
    return `
        translateY(${y.toFixed(3)}px)
        scaleX(${sx.toFixed(4)})
        scaleY(${sy.toFixed(4)})
      `;
  }

  function getSearchState(urlbar) {
    let state = searchAnimationState.get(urlbar);
    if (!state) {
      state = {
        mode: "idle",
        // REFACTOR: Simplified state to use promise cancel function
        cancel: null,
      };
      searchAnimationState.set(urlbar, state);
    }
    return state;
  }

  function resetUrlbarVisualState(urlbar) {
    urlbar.style.transform = "";
    urlbar.style.opacity = "";
    // ANIMATION: Removing will-change (via class) after animation completes
    urlbar.classList.remove("og-search-animating");
  }

  function stopSearchAnimation(urlbar, nextMode = "idle") {
    const state = getSearchState(urlbar);
    if (state.cancel) {
      state.cancel();
      state.cancel = null;
    }
    state.mode = nextMode;
    resetUrlbarVisualState(urlbar);
  }

  // REFACTOR: Centralized Promise-based animation loop to flatten nesting, handle safety timers, and deduplicate RAF code
  function runAnimationLoop(safetyMs, updateFn) {
    let cancelFn;
    const promise = new Promise(resolve => {
      let rafId = 0, safetyId = 0, finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        if (rafId) cancelAnimationFrame(rafId);
        if (safetyId) clearTimeout(safetyId);
        resolve();
      };
      cancelFn = cleanup;

      // ANIMATION: Missing/incorrect cleanup of timers replaced with encapsulated safety boundaries
      if (safetyMs) safetyId = setTimeout(cleanup, safetyMs);

      let start = null, last = null;
      // ANIMATION: Ensuring all continuous animations use requestAnimationFrame appropriately
      function frame(now) {
        if (finished) return;
        if (!start) start = last = now;
        const elapsed = now - start;
        const dt = Math.min((now - last) / 1000, COMMON_TIMING.maxDtStep);
        last = now;

        const keepGoing = updateFn({ elapsed, dt, now });
        if (keepGoing) {
          rafId = requestAnimationFrame(frame);
        } else {
          cleanup();
        }
      }
      rafId = requestAnimationFrame(frame);
    });
    return { promise, cancel: cancelFn };
  }

  // ── Spacer collapse ─────────────────────────────────────────────
  async function collapseSpacer(spacer, fromH) {
    const spring = createSpring(TAB_CLOSE.spacerSpring);
    spring.pos = fromH;
    spring.target = 0;

    await runAnimationLoop(TAB_CLOSE.spacerRemoveSafetyMs, ({ dt }) => {
      if (!spacer.isConnected) return false;
      spring.step(dt);
      const h = Math.max(0, spring.pos);
      // REVIEWED: explicit height animation, not left/top/margin
      spacer.style.height = `${h.toFixed(2)}px`;
      spacer.style.minHeight = `${h.toFixed(2)}px`;
      return !spring.settled(TAB_CLOSE.settledPx);
    }).promise;

    if (spacer.isConnected) {
      spacer.remove();
    }
  }

  function createAnimationClone(node, extraClass) {
    const clone = node.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.add(extraClass);
    return clone;
  }

  function disconnectStartupObserver() {
    if (!startupObserver || typeof Services === "undefined" || !Services?.obs) return;
    Services.obs.removeObserver(startupObserver, "browser-delayed-startup-finished");
    startupObserver = null;
  }

  // ── Tab deletion ────────────────────────────────────────────────
  async function animateTabClose(tab) {
    if (!tab?.isConnected || !tab.parentNode) return;

    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const W = rect.width;
    const H = rect.height;

    const spacer = document.createElement("div");
    // REFACTOR: Use cssText for multiple sequential style assignments
    spacer.style.cssText = `width: ${W}px; height: ${H}px; min-height: ${H}px; flex-shrink: 0; pointer-events: none; visibility: hidden;`;
    tab.parentNode.insertBefore(spacer, tab.nextSibling);

    const ghostMask = document.createElement("div");
    ghostMask.classList.add("og-ghost-mask");
    // REVIEWED: Static positioning layout initializers, no left/top/margin animations present
    ghostMask.style.cssText = `left: ${rect.left}px; top: ${rect.top}px; width: ${W}px; height: ${H}px;`;

    const ghostClone = createAnimationClone(tab, "og-ghost");
    ghostMask.appendChild(ghostClone);

    const mask = document.createElement("div");
    mask.classList.add("og-mask");
    mask.style.cssText = `left: ${rect.left}px; top: ${rect.top}px; width: ${W}px; height: ${H}px;`;

    const clone = createAnimationClone(tab, "og-clone");

    const shine = document.createElement("div");
    shine.classList.add("og-shine");
    clone.appendChild(shine);
    mask.appendChild(clone);

    const mount = document.body ?? document.documentElement;
    mount.appendChild(ghostMask);
    mount.appendChild(mask);

    const travel = -(W * TAB_CLOSE.travelFactor);

    await runAnimationLoop(TAB_CLOSE.safetyMs, ({ elapsed }) => {
      if (!mask.isConnected || !ghostMask.isConnected) return false;

      const rawP = clamp(elapsed / TAB_CLOSE.durationMs, 0, 1);
      const antP = clamp(elapsed / TAB_CLOSE.antiMs, 0, 1);
      const antX = Math.sin(antP * Math.PI) * TAB_CLOSE.antiPx;

      const exitP = clamp((elapsed - TAB_CLOSE.antiMs) / (TAB_CLOSE.durationMs - TAB_CLOSE.antiMs), 0, 1);

      // Emil: use ease-OUT for the exit slide — starts fast (immediate feedback)
      // easeInExpo was starting slow, making dismiss feel sluggish at the critical first frame
      const slideP = easeOutExpo(exitP);
      const tx = antX + lerp(0, travel, slideP);

      const opP = clamp((rawP - TAB_CLOSE.opacityStart) / TAB_CLOSE.opacitySpan, 0, 1);
      // Emil: opacity-out uses easeOutExpo so it fades quickly up front,
      // giving an illusion of speed — same as a fast-spinning spinner reads as faster loading
      const opacity = lerp(1, 0, easeOutExpo(opP));
      const blurPx  = lerp(0, TAB_CLOSE.blurMaxPx, easeOutExpo(opP));

      const shineP = clamp(elapsed / TAB_CLOSE.shineDurationMs, 0, 1);
      const shineX = lerp(TAB_CLOSE.shineStartX, TAB_CLOSE.shineEndX, easeOutExpo(shineP));
      const shineOp = shineP < 0.5
        ? lerp(0, TAB_CLOSE.shinePeakOpacity, easeInOutExpo(shineP / 0.5))
        : lerp(TAB_CLOSE.shinePeakOpacity, 0, easeInOutExpo((shineP - 0.5) / 0.5));

      const gElapsed = Math.max(0, elapsed - TAB_CLOSE.ghostDelayMs);
      const gExitP = clamp((gElapsed - TAB_CLOSE.antiMs) / (TAB_CLOSE.durationMs - TAB_CLOSE.antiMs), 0, 1);
      const gTx = lerp(0, travel * TAB_CLOSE.ghostTravelFactor, easeInOutExpo(gExitP));
      const gOp = lerp(TAB_CLOSE.ghostOpacityStart, 0, easeOutExpo(
        clamp((gElapsed / TAB_CLOSE.durationMs - TAB_CLOSE.ghostFadeOffset) / TAB_CLOSE.ghostFadeSpan, 0, 1)
      ));

      // ANIMATION: Replacing implicit left/top with transform:translate for GPU compositor where applicable
      clone.style.transform = `translateX(${tx.toFixed(2)}px)`;
      clone.style.opacity = opacity.toFixed(3);
      clone.style.filter = `blur(${blurPx.toFixed(2)}px)`;

      shine.style.transform = `translateX(${shineX.toFixed(1)}%) skewX(${TAB_CLOSE.shineSkewDeg}deg)`;
      shine.style.opacity = shineOp.toFixed(3);

      ghostClone.style.transform = `translateX(${gTx.toFixed(2)}px)`;
      ghostClone.style.opacity = gOp.toFixed(3);

      return rawP < 1;
    }).promise;

    mask.remove();
    ghostMask.remove();
    if (spacer.isConnected) {
      // Execute unawaited spacer collapse for staggered overlap
      collapseSpacer(spacer, H);
    }
  }

  // ── Search bar entrance ─────────────────────────────────────────
  async function animateSearchOpen(urlbar) {
    const state = getSearchState(urlbar);
    if (state.mode === "opening") return;

    stopSearchAnimation(urlbar, "opening");

    // ANIMATION: Ensure will-change is applied correctly
    urlbar.classList.add("og-search-animating");

    const ySpring = createSpring(SEARCH_OPEN_SPRINGS.y);
    const sxSpring = createSpring(SEARCH_OPEN_SPRINGS.sx);
    const sySpring = createSpring(SEARCH_OPEN_SPRINGS.sy);
    ySpring.pos = SEARCH_OPEN.startY; ySpring.target = 0;
    sxSpring.pos = SEARCH_OPEN.startScaleX; sxSpring.target = 1;
    sySpring.pos = SEARCH_OPEN.startScaleY; sySpring.target = 1;

    const task = runAnimationLoop(SEARCH_OPEN.safetyMs, ({ elapsed, dt }) => {
      if (!urlbar.isConnected) return false;
      ySpring.step(dt);
      sxSpring.step(dt);
      sySpring.step(dt);

      const opacity = easeOutExpo(clamp(elapsed / SEARCH_OPEN.fadeMs, 0, 1));

      urlbar.style.transform = formatTranslateScale(ySpring.pos, sxSpring.pos, sySpring.pos);
      urlbar.style.opacity = opacity.toFixed(3);

      const allSettled = ySpring.settled(SEARCH_OPEN.settleY)
        && sxSpring.settled(SEARCH_OPEN.settleScale)
        && sySpring.settled(SEARCH_OPEN.settleScale);

      return !allSettled;
    });

    state.cancel = task.cancel;

    await task.promise;

    if (state.mode === "opening") {
      stopSearchAnimation(urlbar, "idle");
    }
  }

  // ── Search bar exit ─────────────────────────────────────────────
  async function animateSearchClose(urlbar) {
    const state = getSearchState(urlbar);
    if (state.mode === "closing") return;

    stopSearchAnimation(urlbar, "closing");

    const rect = urlbar.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      state.mode = "idle";
      return;
    }

    const clone = urlbar.cloneNode(true);
    clone.removeAttribute("id");
    // ANIMATION: Ensure will-change is applied to the dynamically created fixed clone
    clone.style.cssText = `
      position: fixed !important;
      left: ${rect.left}px !important;
      top: ${rect.top}px !important;
      width: ${rect.width}px !important;
      height: ${rect.height}px !important;
      margin: 0 !important;
      pointer-events: none !important;
      z-index: 9999 !important;
      transform-origin: top center !important;
      will-change: transform, opacity !important;
      overflow: hidden !important;
      border-radius: 10px !important;
    `;

    const mount = document.body ?? document.documentElement;
    mount.appendChild(clone);

    const ySpring = createSpring(SEARCH_CLOSE_SPRINGS.y);
    const sySpring = createSpring(SEARCH_CLOSE_SPRINGS.sy);
    const sxSpring = createSpring(SEARCH_CLOSE_SPRINGS.sx);
    ySpring.pos = 0; ySpring.target = SEARCH_CLOSE.targetY;
    sySpring.pos = 1; sySpring.target = SEARCH_CLOSE.targetScaleY;
    sxSpring.pos = 1; sxSpring.target = SEARCH_CLOSE.targetScaleX;

    const task = runAnimationLoop(SEARCH_CLOSE.safetyMs, ({ elapsed, dt }) => {
      if (!clone.isConnected) return false;
      ySpring.step(dt);
      sySpring.step(dt);
      sxSpring.step(dt);

      const rawP = clamp(elapsed / SEARCH_CLOSE.durationMs, 0, 1);
      const opP = clamp((rawP - SEARCH_CLOSE.opacityHoldStart) / SEARCH_CLOSE.opacityFadeSpan, 0, 1);
      const opacity = lerp(1, 0, easeInOutExpo(opP));

      clone.style.transform = formatTranslateScale(ySpring.pos, sxSpring.pos, sySpring.pos);
      clone.style.opacity = opacity.toFixed(3);

      const allSettled = rawP >= 1
        || (ySpring.settled(SEARCH_CLOSE.settleY)
          && sySpring.settled(SEARCH_CLOSE.settleScale)
          && sxSpring.settled(SEARCH_CLOSE.settleScale)
          && opacity < 0.01);

      return !allSettled;
    });

    state.cancel = task.cancel;

    await task.promise;

    clone.remove();
    if (state.mode === "closing") {
      state.mode = "idle";
    }
  }

  // ── Watch for urlbar open/close ─────────────────────────────────
  function watchSearchBar() {
    if (searchObserver) {
      searchObserver.disconnect();
      searchObserver = null;
    }

    const urlbar = document.getElementById("urlbar");
    if (!urlbar) return;

    let wasOpen = urlbar.hasAttribute("open");

    searchObserver = new MutationObserver(() => {
      const isOpen = urlbar.hasAttribute("open");
      if (isOpen && !wasOpen) {
        animateSearchOpen(urlbar);
      } else if (!isOpen && wasOpen) {
        animateSearchClose(urlbar);
      }
      wasOpen = isOpen;
    });

    searchObserver.observe(urlbar, { attributes: true, attributeFilter: ["open"] });
  }

  function cleanup() {
    if (searchObserver) {
      searchObserver.disconnect();
      searchObserver = null;
    }

    disconnectStartupObserver();

    const urlbar = document.getElementById("urlbar");
    if (urlbar) {
      stopSearchAnimation(urlbar, "idle");
    }

    if (tabCloseHandler && typeof gBrowser !== "undefined" && gBrowser?.tabContainer) {
      gBrowser.tabContainer.removeEventListener("TabClose", tabCloseHandler);
      tabCloseHandler = null;
    }

    if (unloadHandler) {
      window.removeEventListener("unload", unloadHandler);
      unloadHandler = null;
    }

    window.__ogAnimInit = false;
  }

  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (window.__ogAnimInit) return;
    if (typeof gBrowser === "undefined" || !gBrowser?.tabContainer) return;

    window.__ogAnimInit = true;

    tabCloseHandler = e => animateTabClose(e.target);
    gBrowser.tabContainer.addEventListener("TabClose", tabCloseHandler);

    watchSearchBar();

    unloadHandler = () => cleanup();
    window.addEventListener("unload", unloadHandler, { once: true });
  }

  if (typeof gBrowserInit !== "undefined" && gBrowserInit?.delayedStartupFinished) {
    init();
  } else if (typeof Services !== "undefined" && Services?.obs) {
    startupObserver = (subject, topic) => {
      if (topic === "browser-delayed-startup-finished" && subject === window) {
        disconnectStartupObserver();
        init();
      }
    };
    Services.obs.addObserver(startupObserver, "browser-delayed-startup-finished");
  }
})();
