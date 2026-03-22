// ==UserScript==
// @name           Animations
// @version        1.3.3
// @author         vur
// @description    JS
// @compatibility  Firefox 100+
// ==/UserScript==

(function InjectScript() {
  "use strict";

  const STYLE_ID = "obsidian-glass-anim";

  const TAB_CLOSE = {
    durationMs: 860,
    safetyMs: 1450,
    antiMs: 90,
    antiPx: 1.7,
    ghostDelayMs: 110,
    shineDurationMs: 430,
    opacityStart: 0.46,
    opacitySpan: 0.54,
    ghostTravelFactor: 0.9,
    blurMaxPx: 11,
    travelFactor: 0.99,
    ghostOpacityStart: 0.2,
    shinePeakOpacity: 0.42,
    shineSkewDeg: -14,
    spacerRemoveSafetyMs: 950,
    settledPx: 0.35,
  };

  const SEARCH_OPEN = {
    fadeMs: 150,
    safetyMs: 700,
    startY: 14,
    startScaleX: 0.92,
    startScaleY: 0.82,
    settleY: 0.06,
    settleScale: 0.0004,
  };

  const SEARCH_CLOSE = {
    durationMs: 380,
    safetyMs: 560,
    targetY: 18,
    targetScaleX: 0.91,
    targetScaleY: 0.74,
    opacityHoldStart: 0.1,
    opacityFadeSpan: 0.9,
    settleY: 0.08,
    settleScale: 0.0004,
  };

  const searchAnimationState = new WeakMap();
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
          rgba(255,255,255,0.00)  35%,
          rgba(255,255,255,0.26)  50%,
          rgba(255,255,255,0.00)  65%,
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
  const easeInExpo = t => t === 0 ? 0 : Math.pow(2, 10 * t - 10);
  const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
  const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function getSearchState(urlbar) {
    let state = searchAnimationState.get(urlbar);
    if (!state) {
      state = {
        mode: "idle",
        rafId: 0,
        safetyId: 0,
      };
      searchAnimationState.set(urlbar, state);
    }
    return state;
  }

  function resetUrlbarVisualState(urlbar) {
    urlbar.style.transform = "";
    urlbar.style.opacity = "";
    urlbar.classList.remove("og-search-animating");
  }

  function stopSearchAnimation(urlbar, nextMode = "idle") {
    const state = getSearchState(urlbar);
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    if (state.safetyId) {
      clearTimeout(state.safetyId);
      state.safetyId = 0;
    }
    state.mode = nextMode;
    resetUrlbarVisualState(urlbar);
  }

  // ── Spacer collapse ─────────────────────────────────────────────
  function collapseSpacer(spacer, fromH) {
    const spring = createSpring({ stiffness: 120, damping: 20 });
    spring.pos = fromH;
    spring.target = 0;

    const safetyId = setTimeout(() => spacer.remove(), TAB_CLOSE.spacerRemoveSafetyMs);
    let last = null;
    let rafId = 0;

    function cleanup() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      clearTimeout(safetyId);
      if (spacer.isConnected) {
        spacer.remove();
      }
    }

    function frame(now) {
      if (!spacer.isConnected) {
        cleanup();
        return;
      }

      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      spring.step(dt);

      const h = Math.max(0, spring.pos);
      spacer.style.height = `${h.toFixed(2)}px`;
      spacer.style.minHeight = `${h.toFixed(2)}px`;

      if (!spring.settled(TAB_CLOSE.settledPx)) {
        rafId = requestAnimationFrame(frame);
      } else {
        cleanup();
      }
    }

    rafId = requestAnimationFrame(frame);
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
  function animateTabClose(tab) {
    if (!tab?.isConnected || !tab.parentNode) return;

    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const W = rect.width;
    const H = rect.height;

    const spacer = document.createElement("div");
    Object.assign(spacer.style, {
      width: `${W}px`,
      height: `${H}px`,
      minHeight: `${H}px`,
      flexShrink: "0",
      pointerEvents: "none",
      visibility: "hidden",
    });
    tab.parentNode.insertBefore(spacer, tab.nextSibling);

    const ghostMask = document.createElement("div");
    ghostMask.classList.add("og-ghost-mask");
    Object.assign(ghostMask.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${W}px`,
      height: `${H}px`,
    });

    const ghostClone = createAnimationClone(tab, "og-ghost");
    ghostMask.appendChild(ghostClone);

    const mask = document.createElement("div");
    mask.classList.add("og-mask");
    Object.assign(mask.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${W}px`,
      height: `${H}px`,
    });

    const clone = createAnimationClone(tab, "og-clone");

    const shine = document.createElement("div");
    shine.classList.add("og-shine");
    clone.appendChild(shine);
    mask.appendChild(clone);

    const mount = document.body ?? document.documentElement;
    mount.appendChild(ghostMask);
    mount.appendChild(mask);

    let finished = false;

    const safetyId = setTimeout(() => {
      cleanup();
    }, TAB_CLOSE.safetyMs);

    const xSpring = createSpring({ stiffness: 104, damping: 18 });
    const travel = -(W * TAB_CLOSE.travelFactor);

    let start = null;
    let last = null;
    let rafId = 0;

    function cleanup() {
      if (finished) return;
      finished = true;

      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      clearTimeout(safetyId);
      mask.remove();
      ghostMask.remove();
      if (spacer.isConnected) {
        collapseSpacer(spacer, H);
      }
    }

    function frame(now) {
      if (!mask.isConnected || !ghostMask.isConnected) {
        cleanup();
        return;
      }

      if (!start) {
        start = last = now;
      }
      const elapsed = now - start;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const rawP = clamp(elapsed / TAB_CLOSE.durationMs, 0, 1);
      const antP = clamp(elapsed / TAB_CLOSE.antiMs, 0, 1);
      const antX = Math.sin(antP * Math.PI) * TAB_CLOSE.antiPx;
      const exitP = clamp((elapsed - TAB_CLOSE.antiMs) / (TAB_CLOSE.durationMs - TAB_CLOSE.antiMs), 0, 1);
      const exitEase = easeInOutSine(exitP);

      xSpring.target = easeOutCubic(exitEase);
      const tx = antX + xSpring.step(dt) * travel;

      const opP = clamp((rawP - TAB_CLOSE.opacityStart) / TAB_CLOSE.opacitySpan, 0, 1);
      const opacity = lerp(1, 0, easeInOutSine(opP));
      const blurPx = lerp(0, TAB_CLOSE.blurMaxPx, easeInOutSine(opP));

      const shineP = clamp(elapsed / TAB_CLOSE.shineDurationMs, 0, 1);
      const shineX = lerp(-102, 172, easeInOutSine(shineP));
      const shineOp = shineP < 0.5
        ? lerp(0, TAB_CLOSE.shinePeakOpacity, easeInOutSine(shineP / 0.5))
        : lerp(TAB_CLOSE.shinePeakOpacity, 0, easeInOutSine((shineP - 0.5) / 0.5));

      const gElapsed = Math.max(0, elapsed - TAB_CLOSE.ghostDelayMs);
      const gExitP = clamp((gElapsed - TAB_CLOSE.antiMs) / (TAB_CLOSE.durationMs - TAB_CLOSE.antiMs), 0, 1);
      const gEase = easeInOutSine(gExitP);
      const gTx = lerp(0, travel * TAB_CLOSE.ghostTravelFactor, gEase);
      const gOp = lerp(TAB_CLOSE.ghostOpacityStart, 0, easeInOutSine(
        clamp((gElapsed / TAB_CLOSE.durationMs - 0.14) / 0.86, 0, 1)
      ));

      clone.style.transform = `translateX(${tx.toFixed(2)}px)`;
      clone.style.opacity = opacity;
      clone.style.filter = `blur(${blurPx.toFixed(2)}px)`;
      shine.style.transform = `translateX(${shineX.toFixed(1)}%) skewX(${TAB_CLOSE.shineSkewDeg}deg)`;
      shine.style.opacity = shineOp;
      ghostClone.style.transform = `translateX(${gTx.toFixed(2)}px)`;
      ghostClone.style.opacity = gOp;

      if (rawP < 1) {
        rafId = requestAnimationFrame(frame);
      } else {
        cleanup();
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  // ── Search bar entrance ─────────────────────────────────────────
  // Three independent springs so each axis settles at its own pace —
  // Y position arrives first, width expands a beat behind,
  // height fills in last. Reads as organic, not mechanical.
  function animateSearchOpen(urlbar) {
    const state = getSearchState(urlbar);
    if (state.mode === "opening") return;

    stopSearchAnimation(urlbar, "opening");
    urlbar.classList.add("og-search-animating");

    const ySpring = createSpring({ stiffness: 250, damping: 24 });
    ySpring.pos = SEARCH_OPEN.startY;
    ySpring.target = 0;

    const sxSpring = createSpring({ stiffness: 210, damping: 23 });
    sxSpring.pos = SEARCH_OPEN.startScaleX;
    sxSpring.target = 1;

    const sySpring = createSpring({ stiffness: 178, damping: 21 });
    sySpring.pos = SEARCH_OPEN.startScaleY;
    sySpring.target = 1;

    let start = null;
    let last = null;

    state.safetyId = setTimeout(() => {
      resetUrlbarVisualState(urlbar);
      state.mode = "idle";
      state.safetyId = 0;
      state.rafId = 0;
    }, SEARCH_OPEN.safetyMs);

    function frame(now) {
      if (!urlbar.isConnected) {
        stopSearchAnimation(urlbar, "idle");
        return;
      }

      if (!start) {
        start = last = now;
      }
      const elapsed = now - start;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      ySpring.step(dt);
      sxSpring.step(dt);
      sySpring.step(dt);

      const opacity = easeOutQuart(clamp(elapsed / SEARCH_OPEN.fadeMs, 0, 1));

      urlbar.style.transform = `
        translateY(${ySpring.pos.toFixed(3)}px)
        scaleX(${sxSpring.pos.toFixed(4)})
        scaleY(${sySpring.pos.toFixed(4)})
      `;
      urlbar.style.opacity = opacity.toFixed(3);

      const allSettled = ySpring.settled(SEARCH_OPEN.settleY)
                      && sxSpring.settled(SEARCH_OPEN.settleScale)
                      && sySpring.settled(SEARCH_OPEN.settleScale);

      if (!allSettled && state.mode === "opening") {
        state.rafId = requestAnimationFrame(frame);
      } else if (state.mode === "opening") {
        stopSearchAnimation(urlbar, "idle");
      }
    }

    state.rafId = requestAnimationFrame(frame);
  }

  // ── Search bar exit ─────────────────────────────────────────────
  // Clone the urlbar visually, position it fixed over the original,
  // animate the clone out, then discard it. This way Zen can
  // immediately hide the real urlbar without us fighting it.
  function animateSearchClose(urlbar) {
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

    const ySpring = createSpring({ stiffness: 210, damping: 24 });
    ySpring.pos = 0;
    ySpring.target = SEARCH_CLOSE.targetY;

    const sySpring = createSpring({ stiffness: 190, damping: 23 });
    sySpring.pos = 1;
    sySpring.target = SEARCH_CLOSE.targetScaleY;

    const sxSpring = createSpring({ stiffness: 170, damping: 22 });
    sxSpring.pos = 1;
    sxSpring.target = SEARCH_CLOSE.targetScaleX;

    let start = null;
    let last = null;

    let finished = false;

    function cleanup() {
      if (finished) return;
      finished = true;

      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
      }
      if (state.safetyId) {
        clearTimeout(state.safetyId);
        state.safetyId = 0;
      }
      clone.remove();
      state.mode = "idle";
    }

    state.safetyId = setTimeout(() => {
      cleanup();
    }, SEARCH_CLOSE.safetyMs);

    function frame(now) {
      if (!clone.isConnected) {
        cleanup();
        return;
      }

      if (!start) {
        start = last = now;
      }
      const elapsed = now - start;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      ySpring.step(dt);
      sySpring.step(dt);
      sxSpring.step(dt);

      const rawP = clamp(elapsed / SEARCH_CLOSE.durationMs, 0, 1);
      const opP = clamp(
        (rawP - SEARCH_CLOSE.opacityHoldStart) / SEARCH_CLOSE.opacityFadeSpan,
        0,
        1
      );
      const opacity = lerp(1, 0, easeInOutSine(opP));

      clone.style.transform = `
        translateY(${ySpring.pos.toFixed(3)}px)
        scaleX(${sxSpring.pos.toFixed(4)})
        scaleY(${sySpring.pos.toFixed(4)})
      `;
      clone.style.opacity = opacity.toFixed(3);

      const allSettled = rawP >= 1
                      || (ySpring.settled(SEARCH_CLOSE.settleY)
                       && sySpring.settled(SEARCH_CLOSE.settleScale)
                       && sxSpring.settled(SEARCH_CLOSE.settleScale)
                       && opacity < 0.01);

      if (!allSettled && state.mode === "closing") {
        state.rafId = requestAnimationFrame(frame);
      } else if (state.mode === "closing") {
        cleanup();
      }
    }

    state.rafId = requestAnimationFrame(frame);
  }

  // ── Watch for urlbar open/close ─────────────────────────────────
  // Zen sets [open] on #urlbar when the search panel appears,
  // and removes it when it closes.
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
