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
        0%   { opacity: 1;   transform: scaleY(1)    translateX(0);   }
        30%  { opacity: 0.8; transform: scaleY(1.05) translateX(4px); }
        100% { opacity: 0;   transform: scaleY(0)    translateX(12px);}
      }
      .og-tab-dying {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 99999 !important;
        transform-origin: center left !important;
        animation: og-tab-delete 240ms cubic-bezier(0.4, 0, 1, 1) forwards !important;
      }
    `;
    document.head.appendChild(style);
  }
 
  function onTabClose(event) {
    const tab = event.target;
    if (!tab?.isConnected) return;
 
    const rect = tab.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
 
    // Clone the tab and position it exactly over the original
    const clone = tab.cloneNode(true);
    clone.className = "";
    clone.classList.add("og-tab-dying");
    clone.style.left   = `${rect.left}px`;
    clone.style.top    = `${rect.top}px`;
    clone.style.width  = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
 
    document.documentElement.appendChild(clone);
 
    // Destroy the clone once the animation finishes
    clone.addEventListener("animationend", () => clone.remove(), { once: true });
 
    // Safety fallback in case animationend never fires
    setTimeout(() => clone.remove(), 400);
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