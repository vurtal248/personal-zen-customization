// ==UserScript==
// @name           Animations
// @version        1.6.1
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
    durationMs: 280,          // Snappier exit — 360ms read as deliberate; 280ms is crisp without feeling rushed
    safetyMs: 800,
    ghostDelayMs: 35,         // Tighter delay — ghost starts sooner, parallax is still readable as a distinct z-layer
    shineDurationMs: 280,
    opacityStart: 0.50,       // Stay fully opaque for first 50% — reads as a solid object exiting
    opacitySpan: 0.50,        // Fade over the remaining 50% with easeOutCubic (immediate onset)
    ghostTravelFactor: 0.40,  // Ghost lags further behind — deeper parallax separation from main clone
    travelFactor: 0.85,       // 85% of width — tab exits cleanly without wasted overshoot distance
    ghostOpacityStart: 0.28,
    shinePeakOpacity: 0.22,   // Subtler glint — reads as glass reflection, not a flashlight
    shineSkewDeg: -28,
    shineStartX: -120,        // Shorter sweep path relative to tab width
    shineEndX: 180,
    settledPx: 0.05,
    spacerSpring: { stiffness: 460, damping: 40 }, // Snappier spacer collapse, slight extra damping prevents overshoot
    ghostFadeOffset: 0.0,
    ghostFadeSpan: 1.0,
    spacerRemoveSafetyMs: 500,
    // Delay before collapsing the spacer — prevents concurrent layout reflow
    // from shifting surrounding tabs mid-slide (the upward "bounce" bug).
    spacerCollapseDelayMs: 50, // Tighter gap: clone is exiting faster so spacer can close sooner
  };

  const SEARCH_OPEN = {
    fadeMs: 90,   // Opacity reaches 1 early in the spring arc — bar feels solid before scale settles
    safetyMs: 600,
    startY: 6,    // Smaller initial drop — feels grounded, not falling in from above
    startScaleX: 0.97, // Start close to scale(1) per Emil: nothing appears from nothing
    startScaleY: 0.97, // 0.95 looked compressed; 0.97 is the Emil-recommended perceptual floor
    settleY: 0.01,
    settleScale: 0.0001,
  };

  const SEARCH_OPEN_SPRINGS = {
    // 480/36 vs 520/40: slightly looser stiffness with less damping → micro-overshoot on settle
    // that reads as alive/organic vs the rigid snap of 520 stiffness
    y: { stiffness: 480, damping: 36 },
    sx: { stiffness: 460, damping: 34 },
    sy: { stiffness: 460, damping: 34 },
  };

  const SEARCH_CLOSE = {
    durationMs: 120, // Exits are faster than entrances (asymmetric timing principle)
    safetyMs: 400,
    targetY: 5,    // Slightly less travel — close reads as a crisp dismiss, not a dropdown
    targetScaleX: 0.98,
    targetScaleY: 0.97,
    opacityHoldStart: 0.0,
    opacityFadeSpan: 1.0,
    settleY: 0.02,
    settleScale: 0.0001,
  };

  const SEARCH_CLOSE_SPRINGS = {
    // 600 felt rigid/mechanical; 560/38 settles organically with less ringing
    y: { stiffness: 560, damping: 38 },
    sy: { stiffness: 580, damping: 40 },
    sx: { stiffness: 580, damping: 40 },
  };

  const searchAnimationState = new WeakMap();
  let searchObserver = null;
  let startupObserver = null;
  let tabCloseHandler = null;
  let unloadHandler = null;

  // ── Styles ──────────────────────────────────────────────────────
  // Always overwrite — guards prevent CSS updates within the same session.
  {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head?.appendChild(style);
    }
    style.textContent = `
      /* ── Tab deletion masks ─────────────────────── */
      .og-mask, .og-ghost-mask {
        position:       fixed   !important;
        pointer-events: none    !important;
        /* overflow must NOT be hidden — it would clip the clone before the eye
           can track the slide. The clone exits the mask bounds intentionally. */
        overflow:       visible !important;
        border-radius:  6px     !important;
      }
      .og-mask       { z-index: 9999 !important; will-change: left, opacity !important; }
      .og-ghost-mask { z-index: 9998 !important; will-change: left, opacity !important; }
 
      .og-clone, .og-ghost {
        position: absolute  !important;
        inset:    0         !important;
        width:    100%      !important;
        height:   100%      !important;
        pointer-events: none !important;
      }
      .og-clone { will-change: opacity !important; }
      .og-ghost {
        /* filter is intentionally absent here — the RAF loop animates blur from
           0 to 2px via ghostClone.style.filter so it builds progressively.
           A static !important rule would override inline style assignments
           and apply full blur at frame 0, creating the instant white-glob artifact. */
        will-change: opacity, filter !important;
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
      // Slightly looser epsilon — ends springs earlier, fewer unnecessary RAF frames
      settled(eps = 0.003) {
        return Math.abs(this.pos - this.target) < eps
          && Math.abs(this.vel) < eps;
      },
    };
  }

  // ── Easings ─────────────────────────────────────────────────────
  const easeInCubic = t => t * t * t;
  // easeOutCubic: starts fast, decelerates — correct curve for exit animations per design principles
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutExpo = t => 1 - Math.pow(1 - t, 5);
  const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

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

    // Suppress the live tab's own CSS transitions and hide it immediately.
    // Root cause of the upward bounce: Firefox/Zen applies its own internal
    // tab-removal animation (height collapse, opacity fade, etc.) to the actual
    // tab element while our clone is sliding. That animation triggers a layout
    // reflow — adjacent tabs shift upward to fill the collapsing space — which
    // appears as a vertical "bounce" on the departing clone.
    // Setting visibility:hidden + transition:none freezes the live tab in place
    // (no layout changes, no paint) so only our clone is visually active.
    // We don't need to restore these styles — Firefox removes the element anyway.
    tab.style.transition = "none";
    tab.style.visibility = "hidden";

    const travel = -(W * TAB_CLOSE.travelFactor);

    await runAnimationLoop(TAB_CLOSE.safetyMs, ({ elapsed }) => {
      if (!mask.isConnected || !ghostMask.isConnected) return false;

      const rawP = clamp(elapsed / TAB_CLOSE.durationMs, 0, 1);

      // Slide: easeOutCubic — even distribution of motion across the full duration;
      // easeOutExpo front-loads ~63% of travel into the first 20% of time,
      // making the departure imperceptibly fast at any reasonable duration.
      const tx = lerp(0, travel, easeOutCubic(rawP));

      // Opacity: easeOutCubic — begins fading immediately once opacityStart is passed.
      // easeInOutCubic had a slow-start that caused the tab to "hang" visibly
      // opaque mid-slide before fading, breaking the sense of a unified exit.
      const opP = clamp((rawP - TAB_CLOSE.opacityStart) / TAB_CLOSE.opacitySpan, 0, 1);
      const opacity = lerp(1, 0, easeOutCubic(opP));

      // Shine sweeps across during exit (plain div — transform works fine here)
      const shineP = clamp(elapsed / TAB_CLOSE.shineDurationMs, 0, 1);
      const shineX = lerp(TAB_CLOSE.shineStartX, TAB_CLOSE.shineEndX, easeOutExpo(shineP));
      const shineOp = shineP < 0.5
        ? lerp(0, TAB_CLOSE.shinePeakOpacity, easeOutExpo(shineP / 0.5))
        : lerp(TAB_CLOSE.shinePeakOpacity, 0, easeOutExpo((shineP - 0.5) / 0.5));

      const gElapsed = Math.max(0, elapsed - TAB_CLOSE.ghostDelayMs);
      const gRawP = clamp(gElapsed / TAB_CLOSE.durationMs, 0, 1);
      const gTx = lerp(0, travel * TAB_CLOSE.ghostTravelFactor, easeInOutCubic(gRawP));
      const gOp = lerp(TAB_CLOSE.ghostOpacityStart, 0, easeInCubic(gRawP));
      // Blur builds from 0 → 2px as the ghost trails away.
      // Starting at 0 means the ghost is a legible tab copy on frame 1;
      // it progressively smears into a motion cue rather than opening as a glob.
      const gBlur = lerp(0, 2, easeInCubic(gRawP));

      // NOTE: In Firefox chrome context, `transform` is silently ignored on HTML elements.
      // Only direct `left` property animation produces visible movement.
      mask.style.left = `${(rect.left + tx).toFixed(2)}px`;
      mask.style.opacity = opacity.toFixed(3);

      shine.style.transform = `translateX(${shineX.toFixed(1)}%) skewX(${TAB_CLOSE.shineSkewDeg}deg)`;
      shine.style.opacity = shineOp.toFixed(3);

      ghostMask.style.left = `${(rect.left + gTx).toFixed(2)}px`;
      ghostMask.style.opacity = gOp.toFixed(3);
      ghostClone.style.filter = `blur(${gBlur.toFixed(2)}px)`;

      return rawP < 1;
    }).promise;

    mask.remove();
    ghostMask.remove();
    if (spacer.isConnected) {
      // Delay spacer collapse so the clone has already exited before the gap closes.
      // Without this delay, the concurrent layout reflow shifts surrounding tabs
      // mid-slide, which moves the stale rect.left reference and causes the
      // visible upward "bounce" on the departing clone.
      setTimeout(() => {
        if (spacer.isConnected) collapseSpacer(spacer, H);
      }, TAB_CLOSE.spacerCollapseDelayMs);
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
      transform-origin: bottom center !important;
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
      // easeOutCubic (was easeInCubic): begins fading immediately on frame 1 — close
      // feels instant and responsive. easeInCubic delayed the fade onset, making the
      // bar 'hang' at full opacity for the first third of the animation.
      const opacity = lerp(1, 0, easeOutCubic(opP));

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
