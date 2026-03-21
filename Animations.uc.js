// ==UserScript==
// @name           Animations
// @version        1.0
// @author         vur
// @description    JS
// @compatibility  Firefox 100+
// ==/UserScript==

(function InjectScript() {
 
  const STYLE_ID = "obsidian-glass-anim";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /*
        Mask container: fixed to exact tab position, overflow hidden.
        The clone slides left INSIDE this box — naturally clipped to
        the tab's own footprint. No bleed onto neighboring tabs.
      */
      .og-mask {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 99 !important;
        overflow: hidden !important;
        border-radius: 6px !important;
      }
      /* Clone fills the mask and slides within it */
      .og-clone {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        will-change: transform, opacity, filter !important;
        pointer-events: none !important;
      }
      .og-ghost-mask {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 98 !important;
        overflow: hidden !important;
        border-radius: 6px !important;
      }
      .og-ghost {
        position: absolute !important;
        top: 0 !important; left: 0 !important;
        width: 100% !important; height: 100% !important;
        filter: blur(5px) !important;
        pointer-events: none !important;
        will-change: transform, opacity !important;
      }
      .og-shine {
        position: absolute !important;
        inset: 0 !important;
        pointer-events: none !important;
        background: linear-gradient(
          108deg,
          transparent              0%,
          rgba(255,255,255,0.00)  35%,
          rgba(255,255,255,0.26)  50%,
          rgba(255,255,255,0.00)  65%,
          transparent             100%
        ) !important;
        will-change: transform, opacity !important;
      }
    `;
    document.head.appendChild(style);
  }
 
  // ── Spring ──────────────────────────────────────────────────────
  function createSpring({ stiffness = 140, damping = 22 } = {}) {
    return {
      pos: 0, vel: 0, target: 0, stiffness, damping,
      step(dt) {
        const F = -this.stiffness * (this.pos - this.target) - this.damping * this.vel;
        this.vel += F * dt;
        this.pos += this.vel * dt;
        return this.pos;
      },
    };
  }
 
  function easeInExpo(t)   { return t === 0 ? 0 : Math.pow(2, 10 * t - 10); }
  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
  function lerp(a, b, t)   { return a + (b - a) * t; }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
 
  // ── Spacer collapse ─────────────────────────────────────────────
  // After the tab exit finishes, springs the spacer height 
  // from H → 0 so sibling tabs glide smoothly into the gap.
  function collapseSpacer(spacer, fromH) {
    // Soft spring: low stiffness so the slide feels unhurried,
    // damping high enough that there's no bounce.
    const spring = createSpring({ stiffness: 120, damping: 20 });
    spring.pos    = fromH;
    spring.target = 0;
 
    let last = null;
 
    function frame(now) {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
 
      // Manually step: spring is pos→target (0), so invert direction
      const F   = -spring.stiffness * (spring.pos - spring.target) - spring.damping * spring.vel;
      spring.vel += F * dt;
      spring.pos += spring.vel * dt;
 
      const h = Math.max(0, spring.pos);
      spacer.style.height    = `${h.toFixed(2)}px`;
      spacer.style.minHeight = `${h.toFixed(2)}px`;
 
      const settled = Math.abs(spring.pos) < 0.5 && Math.abs(spring.vel) < 0.5;
      if (!settled) {
        requestAnimationFrame(frame);
      } else {
        spacer.remove();
      }
    }
 
    requestAnimationFrame(frame);
  }
 
  // ── Core ────────────────────────────────────────────────────────
  function animateTabClose(tab) {
    // Snapshot rect BEFORE tab is removed from DOM
    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
 
    const W = rect.width;
    const H = rect.height;
 
    // Hold the gap: insert a spacer where the tab was so sibling
    // tabs cannot shift up until the animation finishes.
    const spacer = document.createElement("div");
    Object.assign(spacer.style, {
      width:         `${W}px`,
      height:        `${H}px`,
      minHeight:     `${H}px`,
      flexShrink:    "0",
      pointerEvents: "none",
      visibility:    "hidden",
      display:       "block",
    });
    tab.parentNode?.insertBefore(spacer, tab.nextSibling);
 
    // Ghost mask + clone
    const ghostMask = document.createElement("div");
    ghostMask.classList.add("og-ghost-mask");
    Object.assign(ghostMask.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${W}px`, height: `${H}px`,
    });
    const ghostClone = tab.cloneNode(true);
    ghostClone.className = "";
    ghostClone.classList.add("og-ghost");
    ghostMask.appendChild(ghostClone);
 
    // Main mask + clone
    const mask = document.createElement("div");
    mask.classList.add("og-mask");
    Object.assign(mask.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${W}px`, height: `${H}px`,
    });
    const clone = tab.cloneNode(true);
    clone.className = "";
    clone.classList.add("og-clone");
 
    const shine = document.createElement("div");
    shine.classList.add("og-shine");
    clone.appendChild(shine);
    mask.appendChild(clone);
 
    // Mount both into document body — fixed coords are viewport-accurate
    document.documentElement.appendChild(ghostMask);
    document.documentElement.appendChild(mask);
 
    const xSpring   = createSpring({ stiffness: 140, damping: 22 });
    const TRAVEL    = -(W * 1.05); // slides left by ~its own width
    const DURATION  = 660;
    const ANT_MS    = 55;
    const ANT_PX    = 3;
 
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
 
      // Opacity holds until 58% then drops
      const opP     = clamp((rawP - 0.58) / 0.42, 0, 1);
      const opacity = lerp(1, 0, easeInExpo(opP));
 
      // Blur grows with exit speed
      const blurPx = lerp(0, 8, easeInExpo(exitP));
 
      // Shine sweep 0→300ms
      const shineP  = clamp(elapsed / 300, 0, 1);
      const shineX  = lerp(-110, 200, easeOutQuart(shineP));
      const shineOp = shineP < 0.5
        ? lerp(0, 0.55, shineP / 0.5)
        : lerp(0.55, 0, (shineP - 0.5) / 0.5);
 
      // Ghost lags 75ms
      const gElapsed = Math.max(0, elapsed - 75);
      const gExitP   = clamp((gElapsed - ANT_MS) / (DURATION - ANT_MS), 0, 1);
      const gTx      = lerp(0, TRAVEL * 0.82, easeInExpo(gExitP));
      const gOp      = lerp(0.28, 0, easeOutQuart(
        clamp((gElapsed / DURATION - 0.25) / 0.75, 0, 1)
      ));
 
      // Apply — clone moves inside the mask, mask stays put
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
        mask.remove();
        ghostMask.remove();
        // Animate the spacer height from H → 0 with a spring so
        // sibling tabs glide into the gap rather than jumping.
        collapseSpacer(spacer, H);
      }
    }
 
    requestAnimationFrame(frame);
  }
 
  // ── Hook ────────────────────────────────────────────────────────
  function onTabClose(event) {
    const tab = event.target;
    if (!tab?.isConnected) return;
    animateTabClose(tab);
  }
 
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
