(function Custom() {
  const STYLE_ID = "obsidian-glass-anim";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* Applied by JS on mouseenter */
      .og-btn-hover {
        background-color: rgba(255, 255, 255, 0.08) !important;
      }
      .og-btn-active {
        background-color: rgba(255, 255, 255, 0.14) !important;
      }

      /* Base state for all animated buttons */
      .og-animated {
        -moz-appearance: none !important;
        border: none !important;
        border-radius: 6px !important;
        background-color: transparent !important;
        transition:
          background-color 150ms ease,
          opacity 150ms ease !important;
      }

      /* Icon dim at rest, full opacity on hover */
      .og-animated .toolbarbutton-icon {
        opacity: 0.5;
        transition: opacity 150ms ease !important;
      }
      .og-btn-hover .toolbarbutton-icon {
        opacity: 1 !important;
      }

      /* Sidebar active state */
      .og-sidebar-active {
        background-color: rgba(124, 106, 245, 0.15) !important;
      }
    `;
    document.head.appendChild(style);
  }

  /* ----------------------------------------------------------
     Helper: bind enter/leave/mousedown to an element
  ---------------------------------------------------------- */
  function animateButton(el) {
    if (el._ogBound) return;
    el._ogBound = true;

    el.classList.add("og-animated");

    el.addEventListener("mouseenter", () => {
      el.classList.add("og-btn-hover");
    });
    el.addEventListener("mouseleave", () => {
      el.classList.remove("og-btn-hover", "og-btn-active");
    });
    el.addEventListener("mousedown", () => {
      el.classList.add("og-btn-active");
    });
    el.addEventListener("mouseup", () => {
      el.classList.remove("og-btn-active");
    });
  }

  /* ----------------------------------------------------------
     Target selectors — back/forward intentionally excluded
  ---------------------------------------------------------- */
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

  /* ----------------------------------------------------------
     Bind to all current matching elements
  ---------------------------------------------------------- */
  function bindAll() {
    document.querySelectorAll(BUTTON_SELECTORS).forEach(animateButton);
  }

  /* ----------------------------------------------------------
     MutationObserver — catches buttons added after load
     (e.g. extension buttons, sidebar panels opening)
  ---------------------------------------------------------- */
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue; // elements only
        if (node.matches?.(BUTTON_SELECTORS)) animateButton(node);
        node.querySelectorAll?.(BUTTON_SELECTORS).forEach(animateButton);
      }
    }
  });

  /* ----------------------------------------------------------
     Init — wait for the document to be ready
  ---------------------------------------------------------- */
  function init() {
    bindAll();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }

})();