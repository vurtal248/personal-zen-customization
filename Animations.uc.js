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
      .og-tab-base {
        transition: padding-top 200ms ease, padding-bottom 200ms ease !important;
      }
      .og-tab-hover {
        padding-top:    8px !important;
        padding-bottom: 8px !important;
      }
    `;
    document.head.appendChild(style);
  }
 
  function animateTab(el) {
    if (el._ogTabBound) return;
    el._ogTabBound = true;
    el.classList.add("og-tab-base");
    el.addEventListener("mouseenter", () => el.classList.add("og-tab-hover"));
    el.addEventListener("mouseleave", () => el.classList.remove("og-tab-hover"));
  }
 
  const TAB_SELECTORS = ".zen-browser-tab, .tabbrowser-tab";
 
  function bindAll() {
    document.querySelectorAll(TAB_SELECTORS).forEach(animateTab);
  }
 
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.(TAB_SELECTORS)) animateTab(node);
        node.querySelectorAll?.(TAB_SELECTORS).forEach(animateTab);
      }
    }
  });
 
  function init() {
    bindAll();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
 
  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
 
})();