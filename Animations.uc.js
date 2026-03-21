// ==UserScript==
// @name           Animations
// @version        1.0
// @author         vur
// @description    JS
// @compatibility  Firefox 100+
// ==/UserScript==

(function InjectScript() {
 
  // ── Styles ──────────────────────────────────────────────────────
  const STYLE_ID = "obsidian-glass-anim";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /*
        Mask: fixed to the exact tab rect, overflow:hidden.
        Clone slides left INSIDE — clipped to the tab's footprint.
      */
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
        filter:     blur(5px) !important;
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
    `;
    document.head.appendChild(style);
  }
 
  // ── Spring integrator ───────────────────────────────────────────
  // Damped harmonic oscillator. step(dt) advances by dt seconds.
  function createSpring({ stiffness = 140, damping = 22 } = {}) {
    return {
      pos: 0, vel: 0, target: 0, stiffness, damping,
      step(dt) {
        const F = -this.stiffness * (this.pos - this.target)
                  - this.damping  * this.vel;
        this.vel += F * dt;
        this.pos += this.vel * dt;
        return this.pos;
      },
      settled(eps = 0.5) {
        return Math.abs(this.pos - this.target) < eps
            && Math.abs(this.vel) < eps;
      },
    };
  }
 
  // ── Easings ─────────────────────────────────────────────────────
  const easeInExpo   = t => t === 0 ? 0 : Math.pow(2, 10 * t - 10);
  const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
  const lerp         = (a, b, t) => a + (b - a) * t;
  const clamp        = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
 
  // ── Spacer collapse ─────────────────────────────────────────────
  // Springs the spacer height from fromH → 0 so sibling tabs
  // glide into the gap rather than snapping. Uses createSpring
  // properly — no duplicated integrator math.
  function collapseSpacer(spacer, fromH) {
    const spring  = createSpring({ stiffness: 120, damping: 20 });
    spring.pos    = fromH;
    spring.target = 0;
 
    // Safety net: hard-remove after 800ms in case rAF stalls
    const safetyId = setTimeout(() => spacer.remove(), 800);
 
    let last = null;
    function frame(now) {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
 
      spring.step(dt);
 
      const h = Math.max(0, spring.pos);
      spacer.style.height    = `${h.toFixed(2)}px`;
      spacer.style.minHeight = `${h.toFixed(2)}px`;
 
      if (!spring.settled(0.5)) {
        requestAnimationFrame(frame);
      } else {
        clearTimeout(safetyId);
        spacer.remove();
      }
    }
 
    requestAnimationFrame(frame);
  }
 
  // ── Core animation ──────────────────────────────────────────────
  function animateTabClose(tab) {
    if (!tab?.isConnected) return;
 
    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
 
    const W = rect.width;
    const H = rect.height;
 
    // ── Spacer: holds the gap open while the animation plays ──
    const spacer = document.createElement("div");
    Object.assign(spacer.style, {
      width:         `${W}px`,
      height:        `${H}px`,
      minHeight:     `${H}px`,
      flexShrink:    "0",
      pointerEvents: "none",
      visibility:    "hidden",
    });
    tab.parentNode?.insertBefore(spacer, tab.nextSibling);
 
    // ── Ghost mask (blurred trailing layer) ──
    const ghostMask  = document.createElement("div");
    ghostMask.classList.add("og-ghost-mask");
    Object.assign(ghostMask.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${W}px`,        height: `${H}px`,
    });
    const ghostClone = tab.cloneNode(true);
    ghostClone.className = "";
    ghostClone.classList.add("og-ghost");
    ghostMask.appendChild(ghostClone);
 
    // ── Main mask + clone ──
    const mask  = document.createElement("div");
    mask.classList.add("og-mask");
    Object.assign(mask.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${W}px`,        height: `${H}px`,
    });
    const clone = tab.cloneNode(true);
    clone.className = "";
    clone.classList.add("og-clone");
 
    // ── Shine overlay ──
    const shine = document.createElement("div");
    shine.classList.add("og-shine");
    clone.appendChild(shine);
    mask.appendChild(clone);
 
    const mount = document.body ?? document.documentElement;
    mount.appendChild(ghostMask);
    mount.appendChild(mask);
 
    // Safety net: remove all artifacts after 1.2s regardless
    const safetyId = setTimeout(() => {
      mask.remove();
      ghostMask.remove();
      if (spacer.isConnected) collapseSpacer(spacer, H);
    }, 1200);
 
    // ── Spring + timing constants ──
    const xSpring  = createSpring({ stiffness: 140, damping: 22 });
    const TRAVEL   = -(W * 1.05); // exit just past own width
    const DURATION = 660;         // ms
    const ANT_MS   = 55;          // anticipation window
    const ANT_PX   = 3;           // anticipation nudge px
 
    let start = null, last = null;
 
    function frame(now) {
      if (!start) { start = last = now; }
 
      const elapsed = now - start;
      const dt      = Math.min((now - last) / 1000, 0.05);
      last = now;
 
      const rawP  = clamp(elapsed / DURATION, 0, 1);
 
      // Anticipation: tiny rightward nudge before the exit fires
      const antP = clamp(elapsed / ANT_MS, 0, 1);
      const antX = Math.sin(antP * Math.PI) * ANT_PX;
 
      // Exit progress drives spring target
      const exitP = clamp((elapsed - ANT_MS) / (DURATION - ANT_MS), 0, 1);
      xSpring.target = easeInExpo(exitP);
      const tx = antX + xSpring.step(dt) * TRAVEL;
 
      // Opacity: full until 58%, then snaps out
      const opP     = clamp((rawP - 0.58) / 0.42, 0, 1);
      const opacity = lerp(1, 0, easeInExpo(opP));
 
      // Motion blur: grows with exit speed, no distortion
      const blurPx = lerp(0, 8, easeInExpo(exitP));
 
      // Shine sweeps left→right over first 300ms
      const shineP  = clamp(elapsed / 300, 0, 1);
      const shineX  = lerp(-110, 200, easeOutQuart(shineP));
      const shineOp = shineP < 0.5
        ? lerp(0, 0.55,  shineP / 0.5)
        : lerp(0.55, 0, (shineP - 0.5) / 0.5);
 
      // Ghost lags 75ms behind main
      const gElapsed = Math.max(0, elapsed - 75);
      const gExitP   = clamp((gElapsed - ANT_MS) / (DURATION - ANT_MS), 0, 1);
      const gTx      = lerp(0, TRAVEL * 0.82, easeInExpo(gExitP));
      const gOp      = lerp(0.28, 0, easeOutQuart(
        clamp((gElapsed / DURATION - 0.25) / 0.75, 0, 1)
      ));
 
      // Apply transforms — clone moves inside mask, mask is static
      clone.style.transform = `translateX(${tx.toFixed(2)}px)`;
      clone.style.opacity   = opacity;
      clone.style.filter    = `blur(${blurPx.toFixed(2)}px)`;
 
      shine.style.transform = `translateX(${shineX.toFixed(1)}%) skewX(-18deg)`;
      shine.style.opacity   = shineOp;
 
      ghostClone.style.transform = `translateX(${gTx.toFixed(2)}px)`;
      ghostClone.style.opacity   = gOp;
 
      if (rawP < 1) {
        requestAnimationFrame(frame);
      } else {
        clearTimeout(safetyId);
        mask.remove();
        ghostMask.remove();
        // Spring-collapse the spacer — siblings glide in smoothly
        collapseSpacer(spacer, H);
      }
    }
 
    requestAnimationFrame(frame);
  }
 
  // ── Event hook ──────────────────────────────────────────────────
  function onTabClose(event) {
    animateTabClose(event.target);
  }
 
  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (window.__ogAnimInit) return;
    window.__ogAnimInit = true;
    gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
  }
 
  if (gBrowserInit?.delayedStartupFinished) {
    init();
  } else {
    const obs = (subject, topic) => {
      if (topic === "browser-delayed-startup-finished" && subject === window) {
        Services.obs.removeObserver(obs, topic);
        init();
      }
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  }
 
})();
