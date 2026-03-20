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
        No background-color — it bleeds full sidebar width.
        Instead: a left accent border slides in, and the
        label nudges right via padding-inline-start.
        Both effects are visually contained to the tab row.
      */
      .og-tab-base {
        border-left: 2px solid transparent !important;
        transition:
          border-color      200ms ease,
          padding-inline-start 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
          opacity           150ms ease !important;
      }
      .og-tab-hover {
        border-color: rgba(124, 106, 245, 0.7) !important;
        padding-inline-start: 6px !important;
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
    el.classList.add("og-tab-base");
 
    el.addEventListener("mouseenter", () => el.classList.add("og-tab-hover"));
    el.addEventListener("mouseleave", () => el.classList.remove("og-tab-hover"));
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