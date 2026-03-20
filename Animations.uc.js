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
      @keyframes og-tab-delete {
        /*
          0–8%:   Tiny anticipation — tab breathes in slightly,
                  like it's winding up before the exit.
          8–100%: Swift slide left. translateX drives the exit,
                  scaleX compresses it as it gains speed (squash),
                  scaleY breathes out (stretch), blur builds as it
                  accelerates (motion blur illusion), opacity lags
                  behind the transform so the shape is still readable
                  for the first half, then snaps out.
        */
        0%   {
          opacity: 1;
          transform: translateX(0)      scaleX(1)    scaleY(1);
          filter: blur(0px);
        }
        8%   {
          opacity: 1;
          transform: translateX(3px)    scaleX(1.04) scaleY(0.97);
          filter: blur(0px);
        }
        100% {
          opacity: 0;
          transform: translateX(-110%)  scaleX(0.5)  scaleY(0.85);
          filter: blur(6px);
        }
      }
 
      .og-tab-dying {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 99999 !important;
        transform-origin: left center !important;
        /* Custom cubic-bezier: slow anticipation, explosive mid, graceful tail */
        animation: og-tab-delete 380ms cubic-bezier(0.36, 0, 0.1, 1) forwards !important;
      }
    `;
    document.head.appendChild(style);
  }
 
  function onTabClose(event) {
    const tab = event.target;
    if (!tab?.isConnected) return;
 
    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
 
    const clone = tab.cloneNode(true);
    clone.className = "";
    clone.classList.add("og-tab-dying");
    clone.style.left   = `${rect.left}px`;
    clone.style.top    = `${rect.top}px`;
    clone.style.width  = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.margin = "0";
 
    document.documentElement.appendChild(clone);
 
    clone.addEventListener("animationend", () => clone.remove(), { once: true });
    setTimeout(() => clone.remove(), 600);
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