// ==UserScript==
// @name           Animations
// @version        1.0
// @author         vur
// @description    JS
// @compatibility  Firefox 100+
// ==/UserScript==

(function ObsidianGlass() {
 
  const STYLE_ID = "obsidian-glass-anim";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* ── Button animations ─────────────────────── */
      .og-animated {
        -moz-appearance: none !important;
        border: none !important;
        border-radius: 6px !important;
        background-color: transparent !important;
        transition: background-color 150ms ease !important;
      }
      .og-animated .toolbarbutton-icon {
        opacity: 0.5;
        transition: opacity 150ms ease !important;
      }
      .og-btn-hover {
        background-color: rgba(255, 255, 255, 0.08) !important;
      }
      .og-btn-hover .toolbarbutton-icon {
        opacity: 1 !important;
      }
      .og-btn-active {
        background-color: rgba(255, 255, 255, 0.14) !important;
      }
 
      /* ── Tab expand animation ───────────────────── */
      /*
        We animate .tab-content — the actual visible pill
        inside the tab — not the outer wrapper which has
        invisible extra DOM space around it.
      */
      .og-tab-content-base {
        transition:
          padding-top    220ms cubic-bezier(0.34, 1.56, 0.64, 1),
          padding-bottom 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
          background-color 180ms ease !important;
      }
      .og-tab-content-hover {
        padding-top:    8px !important;
        padding-bottom: 8px !important;
        background-color: rgba(255, 255, 255, 0.06) !important;
      }
    `;
    document.head.appendChild(style);
  }
 
  /* ── Button helpers ──────────────────────────────── */
  function animateButton(el) {
    if (el._ogBound) return;
    el._ogBound = true;
    el.classList.add("og-animated");
 
    el.addEventListener("mouseenter", () => el.classList.add("og-btn-hover"));
    el.addEventListener("mouseleave", () => el.classList.remove("og-btn-hover", "og-btn-active"));
    el.addEventListener("mousedown",  () => el.classList.add("og-btn-active"));
    el.addEventListener("mouseup",    () => el.classList.remove("og-btn-active"));
  }
 
  /* ── Tab helpers ─────────────────────────────────── */
  function animateTab(el) {
    if (el._ogTabBound) return;
    el._ogTabBound = true;
 
    // Target the inner visual pill, not the outer wrapper
    const inner = el.querySelector(".tab-content") || el;
    inner.classList.add("og-tab-content-base");
 
    el.addEventListener("mouseenter", () => inner.classList.add("og-tab-content-hover"));
    el.addEventListener("mouseleave", () => inner.classList.remove("og-tab-content-hover"));
  }
 
  /* ── Selectors ───────────────────────────────────── */
  const BUTTON_SELECTORS = [
    "#reload-button",
    "#stop-button",
    "#home-button",
    "#downloads-button",
    "#unified-extensions-button",
    "#pageActionButton",
    "#identity-box",
    ".webextension-browser-action",
    ".zen-sidebar-panel-button",
    "#zen-sidebar-icons-wrapper toolbarbutton",
    "#zen-sidebar-top-buttons toolbarbutton",
    "toolbarbutton.bookmark-item",
  ].join(", ");
 
  const TAB_SELECTORS = [
    ".zen-browser-tab",
    ".tabbrowser-tab",
  ].join(", ");
 
  /* ── Bind all current elements ───────────────────── */
  function bindAll() {
    document.querySelectorAll(BUTTON_SELECTORS).forEach(animateButton);
    document.querySelectorAll(TAB_SELECTORS).forEach(animateTab);
  }
 
  /* ── MutationObserver for dynamically added elements */
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.(BUTTON_SELECTORS)) animateButton(node);
        if (node.matches?.(TAB_SELECTORS))    animateTab(node);
        node.querySelectorAll?.(BUTTON_SELECTORS).forEach(animateButton);
        node.querySelectorAll?.(TAB_SELECTORS).forEach(animateTab);
      }
    }
  });
 
  /* ── Init ────────────────────────────────────────── */
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