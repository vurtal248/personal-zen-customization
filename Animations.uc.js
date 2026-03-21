// ==UserScript==
// @name           Animations
// @version        1.1.14
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
      pos: 0, vel: 0, target: 0, stiffness, damping,
      step(dt) {
        const F = -this.stiffness * (this.pos - this.target)
                  - this.damping  * this.vel;
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
  const easeInExpo   = t => t === 0 ? 0 : Math.pow(2, 10 * t - 10);
  const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
  const lerp         = (a, b, t) => a + (b - a) * t;
  const clamp        = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
 
  // ── Spacer collapse ─────────────────────────────────────────────
  function collapseSpacer(spacer, fromH) {
    const spring  = createSpring({ stiffness: 120, damping: 20 });
    spring.pos    = fromH;
    spring.target = 0;
 
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
 
  // ── Tab deletion ────────────────────────────────────────────────
  function animateTabClose(tab) {
    if (!tab?.isConnected) return;
 
    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
 
    const W = rect.width;
    const H = rect.height;
 
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
 
    const ghostMask = document.createElement("div");
    ghostMask.classList.add("og-ghost-mask");
    Object.assign(ghostMask.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${W}px`,        height: `${H}px`,
    });
    const ghostClone = tab.cloneNode(true);
    ghostClone.className = "";
    ghostClone.classList.add("og-ghost");
    ghostMask.appendChild(ghostClone);
 
    const mask = document.createElement("div");
    mask.classList.add("og-mask");
    Object.assign(mask.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${W}px`,        height: `${H}px`,
    });
    const clone = tab.cloneNode(true);
    clone.className = "";
    clone.classList.add("og-clone");
 
    const shine = document.createElement("div");
    shine.classList.add("og-shine");
    clone.appendChild(shine);
    mask.appendChild(clone);
 
    const mount = document.body ?? document.documentElement;
    mount.appendChild(ghostMask);
    mount.appendChild(mask);
 
    const safetyId = setTimeout(() => {
      mask.remove();
      ghostMask.remove();
      if (spacer.isConnected) collapseSpacer(spacer, H);
    }, 1200);
 
    const xSpring  = createSpring({ stiffness: 140, damping: 22 });
    const TRAVEL   = -(W * 1.05);
    const DURATION = 660;
    const ANT_MS   = 55;
    const ANT_PX   = 3;
 
    let start = null, last = null;
 
    function frame(now) {
      if (!start) { start = last = now; }
      const elapsed = now - start;
      const dt      = Math.min((now - last) / 1000, 0.05);
      last = now;
 
      const rawP  = clamp(elapsed / DURATION, 0, 1);
      const antP  = clamp(elapsed / ANT_MS, 0, 1);
      const antX  = Math.sin(antP * Math.PI) * ANT_PX;
      const exitP = clamp((elapsed - ANT_MS) / (DURATION - ANT_MS), 0, 1);
 
      xSpring.target = easeInExpo(exitP);
      const tx = antX + xSpring.step(dt) * TRAVEL;
 
      const opP     = clamp((rawP - 0.58) / 0.42, 0, 1);
      const opacity = lerp(1, 0, easeInExpo(opP));
      const blurPx  = lerp(0, 8, easeInExpo(exitP));
 
      const shineP  = clamp(elapsed / 300, 0, 1);
      const shineX  = lerp(-110, 200, easeOutQuart(shineP));
      const shineOp = shineP < 0.5
        ? lerp(0, 0.55,  shineP / 0.5)
        : lerp(0.55, 0, (shineP - 0.5) / 0.5);
 
      const gElapsed = Math.max(0, elapsed - 75);
      const gExitP   = clamp((gElapsed - ANT_MS) / (DURATION - ANT_MS), 0, 1);
      const gTx      = lerp(0, TRAVEL * 0.82, easeInExpo(gExitP));
      const gOp      = lerp(0.28, 0, easeOutQuart(
        clamp((gElapsed / DURATION - 0.25) / 0.75, 0, 1)
      ));
 
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
        collapseSpacer(spacer, H);
      }
    }
 
    requestAnimationFrame(frame);
  }
 
  // ── Search bar entrance ─────────────────────────────────────────
  // Three independent springs so each axis settles at its own pace —
  // Y position arrives first, width expands a beat behind,
  // height fills in last. Reads as organic, not mechanical.
  function animateSearchOpen(urlbar) {
    // Guard: don't double-animate if already running
    if (urlbar._ogSearchAnimating) return;
    urlbar._ogSearchAnimating = true;
    urlbar.classList.add("og-search-animating");
 
    // Springs
    // Y: slides up from 18px below — snappy spring
    const ySpring = createSpring({ stiffness: 320, damping: 28 });
    ySpring.pos    = 18;
    ySpring.target = 0;
 
    // ScaleX: expands from 0.88 — slightly softer
    const sxSpring = createSpring({ stiffness: 260, damping: 26 });
    sxSpring.pos    = 0.88;
    sxSpring.target = 1;
 
    // ScaleY: expands from 0.72 — softest, arrives last
    // gives the "growing taller as it rises" read
    const sySpring = createSpring({ stiffness: 200, damping: 24 });
    sySpring.pos    = 0.72;
    sySpring.target = 1;
 
    // Opacity: simple lerp over 120ms, not spring-driven
    const FADE_MS  = 120;
    let start = null, last = null;
 
    // Safety: hard-reset after 600ms
    const safetyId = setTimeout(() => {
      urlbar.style.transform = "";
      urlbar.style.opacity   = "";
      urlbar.classList.remove("og-search-animating");
      urlbar._ogSearchAnimating = false;
    }, 600);
 
    function frame(now) {
      if (!start) { start = last = now; }
      const elapsed = now - start;
      const dt      = Math.min((now - last) / 1000, 0.05);
      last = now;
 
      ySpring.step(dt);
      sxSpring.step(dt);
      sySpring.step(dt);
 
      const opacity = Math.min(1, elapsed / FADE_MS);
 
      urlbar.style.transform = `
        translateY(${ySpring.pos.toFixed(3)}px)
        scaleX(${sxSpring.pos.toFixed(4)})
        scaleY(${sySpring.pos.toFixed(4)})
      `;
      urlbar.style.opacity = opacity.toFixed(3);
 
      const allSettled = ySpring.settled(0.08)
                      && sxSpring.settled(0.0005)
                      && sySpring.settled(0.0005);
 
      if (!allSettled) {
        requestAnimationFrame(frame);
      } else {
        clearTimeout(safetyId);
        // Clean up: remove inline styles so CSS takes over normally
        urlbar.style.transform = "";
        urlbar.style.opacity   = "";
        urlbar.classList.remove("og-search-animating");
        urlbar._ogSearchAnimating = false;
      }
    }
 
    requestAnimationFrame(frame);
  }
 
  // ── Watch for urlbar open state ─────────────────────────────────
  // Zen sets [open] on #urlbar when the search panel appears.
  // MutationObserver on the attribute fires synchronously before
  // the first paint, so the spring starts from frame 0.
  function watchSearchBar() {
    const urlbar = document.getElementById("urlbar");
    if (!urlbar) return;
 
    let wasOpen = urlbar.hasAttribute("open");
 
    const obs = new MutationObserver(() => {
      const isOpen = urlbar.hasAttribute("open");
      if (isOpen && !wasOpen) {
        // Just opened — run entrance animation
        animateSearchOpen(urlbar);
      }
      wasOpen = isOpen;
    });
 
    obs.observe(urlbar, { attributes: true, attributeFilter: ["open"] });
  }
 
  // ── Init ────────────────────────────────────────────────────────
  function init() {
    if (window.__ogAnimInit) return;
    window.__ogAnimInit = true;
    gBrowser.tabContainer.addEventListener("TabClose", e => animateTabClose(e.target));
    watchSearchBar();
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
