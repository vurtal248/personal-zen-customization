// ==UserScript==
// @name           Animations
// @version        1.0
// @author         vur
// @description    JS
// @compatibility  Firefox 100+
// ==/UserScript==

(function InjectScript() {
 
  // ─── Inject base styles ────────────────────────────────────────
  const STYLE_ID = "obsidian-glass-anim";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .og-clone-wrap {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 99999 !important;
        overflow: hidden !important;
        border-radius: 6px !important;
        will-change: transform, opacity !important;
      }
      .og-clone-ghost {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 99998 !important;
        overflow: hidden !important;
        border-radius: 6px !important;
        will-change: transform, opacity !important;
        filter: blur(4px) !important;
      }
      .og-shine {
        position: absolute !important;
        inset: 0 !important;
        background: linear-gradient(
          108deg,
          transparent   0%,
          rgba(255,255,255,0.0)  35%,
          rgba(255,255,255,0.28) 50%,
          rgba(255,255,255,0.0)  65%,
          transparent   100%
        ) !important;
        pointer-events: none !important;
        will-change: transform, opacity !important;
      }
    `;
    document.head.appendChild(style);
  }
 
  // ─── Spring integrator ─────────────────────────────────────────
  // Solves a damped harmonic oscillator per frame.
  // stiffness / damping tune the feel — lower stiffness = floatier.
  function createSpring({ stiffness = 180, damping = 26, mass = 1 } = {}) {
    return {
      pos: 0,      // current value (0 = start, 1 = target)
      vel: 0,      // current velocity
      target: 1,
      stiffness,
      damping,
      mass,
      // Step the spring by `dt` seconds. Returns current pos.
      step(dt) {
        const F = -this.stiffness * (this.pos - this.target)
                  - this.damping * this.vel;
        const acc = F / this.mass;
        this.vel += acc * dt;
        this.pos += this.vel * dt;
        return this.pos;
      },
      // True when motion has effectively stopped
      isSettled() {
        return Math.abs(this.pos - this.target) < 0.001
            && Math.abs(this.vel) < 0.001;
      },
    };
  }
 
  // ─── Easing helpers ───────────────────────────────────────────
  // Used for non-spring channels (opacity, blur, shine)
  function easeInExpo(t) {
    return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
  }
  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
 
  // ─── Core animation ───────────────────────────────────────────
  function animateTabClose(tab) {
    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
 
    const W = rect.width;
    const H = rect.height;
 
    // ── Main clone ──
    const wrap = tab.cloneNode(true);
    wrap.className = "";
    wrap.classList.add("og-clone-wrap");
    Object.assign(wrap.style, {
      left:   `${rect.left}px`,
      top:    `${rect.top}px`,
      width:  `${W}px`,
      height: `${H}px`,
      margin: "0",
    });
 
    // ── Shine overlay ──
    const shine = document.createElement("div");
    shine.classList.add("og-shine");
    wrap.appendChild(shine);
 
    // ── Ghost clone (lags behind main, blurred) ──
    const ghost = tab.cloneNode(true);
    ghost.className = "";
    ghost.classList.add("og-clone-ghost");
    Object.assign(ghost.style, {
      left:   `${rect.left}px`,
      top:    `${rect.top}px`,
      width:  `${W}px`,
      height: `${H}px`,
      margin: "0",
      opacity: "0.35",
    });
 
    document.documentElement.appendChild(ghost);
    document.documentElement.appendChild(wrap);
 
    // ── Spring — drives horizontal travel (0 → −(W * 1.15)) ──
    // High damping = no bounce, just a smooth deceleration curve
    const xSpring = createSpring({ stiffness: 140, damping: 22, mass: 1 });
    xSpring.pos    = 0;
    xSpring.target = 0; // we'll drive it manually below
 
    const TOTAL_TRAVEL = -(W * 1.15); // px, exits just past its own width
    const DURATION_MS  = 680;         // wall-clock budget
 
    let startTime = null;
    let lastTime  = null;
 
    // Anticipation: tab breathes in for first 60ms before exiting
    const ANTICIPATION_MS = 60;
    const ANTICIPATION_PX = 4; // nudge right before sweeping left
 
    function frame(now) {
      if (!startTime) startTime = lastTime = now;
      const elapsed = now - startTime;
      const dt = Math.min((now - lastTime) / 1000, 0.05); // seconds, capped at 50ms
      lastTime = now;
 
      // ── Progress (0 → 1 over DURATION_MS) ──
      const rawP = clamp(elapsed / DURATION_MS, 0, 1);
 
      // ── Anticipation phase ──
      const anticipationP = clamp(elapsed / ANTICIPATION_MS, 0, 1);
      const anticipationX = Math.sin(anticipationP * Math.PI) * ANTICIPATION_PX;
 
      // ── Exit phase (starts after anticipation) ──
      const exitP = clamp((elapsed - ANTICIPATION_MS) / (DURATION_MS - ANTICIPATION_MS), 0, 1);
 
      // Spring drives translateX — spring target ramps with easeInExpo
      // so it starts slow and builds, matching spring's natural feel
      const springTarget = easeInExpo(exitP); // 0 → 1
      xSpring.target = springTarget;
      const springVal = xSpring.step(dt);
      const translateX = anticipationX + springVal * TOTAL_TRAVEL;
 
      // ── ScaleX: compresses gently, held back vs translateX ──
      const scaleXP = clamp((elapsed - ANTICIPATION_MS - 40) / (DURATION_MS - ANTICIPATION_MS - 40), 0, 1);
      const scaleX  = lerp(1, 0.78, easeOutQuart(scaleXP));
 
      // ── ScaleY: subtle vertical compression, lags even more ──
      const scaleYP = clamp((elapsed - ANTICIPATION_MS - 80) / (DURATION_MS - ANTICIPATION_MS - 80), 0, 1);
      const scaleY  = lerp(1, 0.92, easeOutQuart(scaleYP));
 
      // ── Opacity: stays full until 60%, then rapid fade ──
      const opacityP = clamp((rawP - 0.60) / 0.40, 0, 1);
      const opacity  = lerp(1, 0, easeInExpo(opacityP));
 
      // ── Motion blur: builds as speed increases ──
      const blurPx = lerp(0, 8, easeInExpo(exitP));
 
      // ── Shine: sweeps left→right in first 300ms ──
      const shineP   = clamp(elapsed / 300, 0, 1);
      const shineX   = lerp(-110, 200, easeOutQuart(shineP));
      const shineOp  = shineP < 0.5
        ? lerp(0, 0.6, shineP / 0.5)
        : lerp(0.6, 0, (shineP - 0.5) / 0.5);
 
      // ── Ghost lags 80ms behind main ──
      const ghostElapsed = Math.max(0, elapsed - 80);
      const ghostExitP   = clamp((ghostElapsed - ANTICIPATION_MS) / (DURATION_MS - ANTICIPATION_MS), 0, 1);
      const ghostX       = lerp(0, TOTAL_TRAVEL * 0.85, easeInExpo(ghostExitP));
      const ghostOpacity = lerp(0.35, 0, easeOutQuart(clamp((ghostElapsed / DURATION_MS - 0.3) / 0.7, 0, 1)));
 
      // ── Apply to main clone ──
      wrap.style.transform = `translateX(${translateX}px) scaleX(${scaleX}) scaleY(${scaleY})`;
      wrap.style.opacity   = opacity;
      wrap.style.filter    = `blur(${blurPx.toFixed(2)}px)`;
      wrap.style.transformOrigin = "left center";
 
      // ── Apply to shine ──
      shine.style.transform = `translateX(${shineX.toFixed(1)}%) skewX(-18deg)`;
      shine.style.opacity   = shineOp;
 
      // ── Apply to ghost ──
      ghost.style.transform = `translateX(${ghostX.toFixed(1)}px)`;
      ghost.style.opacity   = ghostOpacity;
      ghost.style.transformOrigin = "left center";
 
      // ── Continue or clean up ──
      if (rawP < 1) {
        requestAnimationFrame(frame);
      } else {
        wrap.remove();
        ghost.remove();
      }
    }
 
    requestAnimationFrame(frame);
  }
 
  // ─── Hook into TabClose ────────────────────────────────────────
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