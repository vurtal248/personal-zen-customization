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
      .og-clone-wrap {
        position: absolute !important;
        pointer-events: none !important;
        /* z-index sits below sibling tabs so shifting tabs render on top */
        z-index: 0 !important;
        overflow: hidden !important;
        border-radius: 6px !important;
        will-change: transform, opacity, filter !important;
      }
      .og-clone-ghost {
        position: absolute !important;
        pointer-events: none !important;
        z-index: 0 !important;
        overflow: hidden !important;
        border-radius: 6px !important;
        will-change: transform, opacity !important;
        filter: blur(5px) !important;
      }
      .og-shine {
        position: absolute !important;
        inset: 0 !important;
        background: linear-gradient(
          108deg,
          transparent                0%,
          rgba(255,255,255,0.00)    35%,
          rgba(255,255,255,0.26)    50%,
          rgba(255,255,255,0.00)    65%,
          transparent               100%
        ) !important;
        pointer-events: none !important;
        will-change: transform, opacity !important;
      }
    `;
    document.head.appendChild(style);
  }
 
  // ── Spring integrator ───────────────────────────────────────────
  function createSpring({ stiffness = 140, damping = 22, mass = 1 } = {}) {
    return {
      pos: 0, vel: 0, target: 0,
      stiffness, damping, mass,
      step(dt) {
        const F = -this.stiffness * (this.pos - this.target) - this.damping * this.vel;
        this.vel += (F / this.mass) * dt;
        this.pos += this.vel * dt;
        return this.pos;
      },
    };
  }
 
  // ── Easings ─────────────────────────────────────────────────────
  function easeInExpo(t) { return t === 0 ? 0 : Math.pow(2, 10 * t - 10); }
  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
 
  // ── Core animation ──────────────────────────────────────────────
  function animateTabClose(tab) {
    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
 
    // Use the tab's own parent as the mount point so clones
    // sit in the same stacking context as the other tabs.
    // When those tabs shift up they naturally render on top.
    const parent     = tab.parentNode;
    const parentRect = parent.getBoundingClientRect();
 
    // Position relative to the parent container, not the viewport
    const offsetLeft = rect.left - parentRect.left;
    const offsetTop  = rect.top  - parentRect.top;
    const W = rect.width;
    const H = rect.height;
 
    // ── Ghost (blurred trailing layer) ──
    const ghost = tab.cloneNode(true);
    ghost.className = "";
    ghost.classList.add("og-clone-ghost");
    Object.assign(ghost.style, {
      left: `${offsetLeft}px`, top: `${offsetTop}px`,
      width: `${W}px`, height: `${H}px`, margin: "0",
    });
 
    // ── Main clone ──
    const wrap = tab.cloneNode(true);
    wrap.className = "";
    wrap.classList.add("og-clone-wrap");
    Object.assign(wrap.style, {
      left: `${offsetLeft}px`, top: `${offsetTop}px`,
      width: `${W}px`, height: `${H}px`, margin: "0",
    });
 
    // ── Shine ──
    const shine = document.createElement("div");
    shine.classList.add("og-shine");
    wrap.appendChild(shine);
 
    parent.appendChild(ghost);
    parent.appendChild(wrap);
 
    // ── Springs ──
    const xSpring = createSpring({ stiffness: 140, damping: 22 });
    const TRAVEL  = -(W * 1.1);
    const DURATION = 660;
    const ANTICIPATION_MS = 55;
    const ANTICIPATION_PX = 3;
 
    let startTime = null;
    let lastTime  = null;
 
    function frame(now) {
      if (!startTime) { startTime = lastTime = now; }
      const elapsed = now - startTime;
      const dt      = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
 
      const rawP = clamp(elapsed / DURATION, 0, 1);
 
      // Anticipation nudge (right then left snap)
      const antP = clamp(elapsed / ANTICIPATION_MS, 0, 1);
      const antX = Math.sin(antP * Math.PI) * ANTICIPATION_PX;
 
      // Exit drive
      const exitP = clamp((elapsed - ANTICIPATION_MS) / (DURATION - ANTICIPATION_MS), 0, 1);
      xSpring.target = easeInExpo(exitP);
      const springVal = xSpring.step(dt);
      const translateX = antX + springVal * TRAVEL;
 
      // Opacity — full until 58%, then snap out
      const opP    = clamp((rawP - 0.58) / 0.42, 0, 1);
      const opacity = lerp(1, 0, easeInExpo(opP));
 
      // Motion blur — proportional to exit speed, not scale
      const blurPx = lerp(0, 9, easeInExpo(exitP));
 
      // Shine sweep (0→300ms)
      const shineP  = clamp(elapsed / 300, 0, 1);
      const shineX  = lerp(-110, 200, easeOutQuart(shineP));
      const shineOp = shineP < 0.5
        ? lerp(0, 0.55, shineP / 0.5)
        : lerp(0.55, 0, (shineP - 0.5) / 0.5);
 
      // Ghost lags 75ms, fades earlier
      const ghostElapsed = Math.max(0, elapsed - 75);
      const ghostExitP   = clamp((ghostElapsed - ANTICIPATION_MS) / (DURATION - ANTICIPATION_MS), 0, 1);
      const ghostX       = lerp(0, TRAVEL * 0.82, easeInExpo(ghostExitP));
      const ghostOp      = lerp(0.30, 0, easeOutQuart(clamp((ghostElapsed / DURATION - 0.25) / 0.75, 0, 1)));
 
      // ── No scaleX / scaleY — text stays crisp ──
      wrap.style.transform      = `translateX(${translateX.toFixed(2)}px)`;
      wrap.style.opacity        = opacity;
      wrap.style.filter         = `blur(${blurPx.toFixed(2)}px)`;
      wrap.style.transformOrigin = "left center";
 
      shine.style.transform = `translateX(${shineX.toFixed(1)}%) skewX(-18deg)`;
      shine.style.opacity   = shineOp;
 
      ghost.style.transform      = `translateX(${ghostX.toFixed(2)}px)`;
      ghost.style.opacity        = ghostOp;
      ghost.style.transformOrigin = "left center";
 
      if (rawP < 1) {
        requestAnimationFrame(frame);
      } else {
        wrap.remove();
        ghost.remove();
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