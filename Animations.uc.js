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
 
      /* ─── Main tab exit ─────────────────────────────
         Three-beat choreography:
           0–8%   Inhale — tiny scale up, tab "notices" it's closing
           8–22%  Hold — light sweep fires during this window
           22–100% Exit — accelerating slide left, blur builds,
                          opacity holds until 65% then snaps out
      ──────────────────────────────────────────────── */
      @keyframes og-tab-exit {
        0% {
          opacity: 1;
          transform: translateX(0) scaleX(1) scaleY(1);
          filter: blur(0px);
        }
        8% {
          opacity: 1;
          transform: translateX(2px) scaleX(1.02) scaleY(1.015);
          filter: blur(0px);
        }
        22% {
          opacity: 1;
          transform: translateX(-4px) scaleX(0.99) scaleY(1);
          filter: blur(0px);
        }
        65% {
          opacity: 0.85;
          transform: translateX(-72%) scaleX(0.88) scaleY(0.96);
          filter: blur(3px);
        }
        100% {
          opacity: 0;
          transform: translateX(-118%) scaleX(0.72) scaleY(0.91);
          filter: blur(7px);
        }
      }
 
      /* ─── Shine streak ───────────────────────────────
         A narrow white gradient sweeps left → right across
         the tab surface in the first 320ms, simulating
         light catching a glass panel as it starts moving.
      ──────────────────────────────────────────────── */
      @keyframes og-shine-sweep {
        0%   { transform: translateX(-120%) skewX(-18deg); opacity: 0;   }
        15%  { opacity: 0.55; }
        55%  { opacity: 0.35; }
        100% { transform: translateX(220%)  skewX(-18deg); opacity: 0;   }
      }
 
      .og-tab-dying {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 99999 !important;
        transform-origin: left center !important;
        overflow: hidden !important;
        border-radius: 6px !important;
        animation: og-tab-exit 620ms cubic-bezier(0.22, 0, 0.12, 1) forwards !important;
      }
 
      .og-tab-shine {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 40% !important;
        height: 100% !important;
        background: linear-gradient(
          105deg,
          transparent 0%,
          rgba(255,255,255,0.18) 40%,
          rgba(255,255,255,0.32) 50%,
          rgba(255,255,255,0.18) 60%,
          transparent 100%
        ) !important;
        pointer-events: none !important;
        animation: og-shine-sweep 320ms cubic-bezier(0.4, 0, 0.6, 1) forwards !important;
        animation-delay: 30ms !important;
      }
    `;
    document.head.appendChild(style);
  }
 
  function onTabClose(event) {
    const tab = event.target;
    if (!tab?.isConnected) return;
 
    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
 
    // Clone the tab
    const clone = tab.cloneNode(true);
    clone.className = "";
    clone.classList.add("og-tab-dying");
    clone.style.left   = `${rect.left}px`;
    clone.style.top    = `${rect.top}px`;
    clone.style.width  = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.margin = "0";
 
    // Inject shine streak as a child of the clone
    const shine = document.createElement("div");
    shine.classList.add("og-tab-shine");
    clone.appendChild(shine);
 
    document.documentElement.appendChild(clone);
 
    clone.addEventListener("animationend", () => clone.remove(), { once: true });
    setTimeout(() => clone.remove(), 900);
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