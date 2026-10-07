/* Trekiva popup storefront script. Vanilla JS, no dependencies, no secrets.
 * DOM is built with textContent only (never innerHTML) so campaign copy cannot inject markup. */
(function () {
  "use strict";
  if (window.TrekivaPopup) return;

  var root = document.getElementById("trekiva-popup-root");
  if (!root) return;

  var base = root.getAttribute("data-proxy-base") || "/apps/trekiva";
  var pageType = root.getAttribute("data-page-type") || "";
  var campaign = null;
  var openState = null; // { overlay, previousFocus }
  var opened = false;
  var pendingOpen = false; // manual open() called before the config arrived

  /* ---------- storage (may throw in private mode) ---------- */
  function store(kind) {
    try { return kind === "session" ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  function read(kind, key) { var s = store(kind); try { return s ? s.getItem(key) : null; } catch (e) { return null; } }
  function write(kind, key, v) { var s = store(kind); try { if (s) s.setItem(key, v); } catch (e) { /* ignore */ } }

  /* ---------- display rules (UX only; the server enforces one claim per email) ---------- */
  function isMobile() { return window.matchMedia("(max-width: 768px)").matches; }

  function deviceAllowed(rules) {
    return rules.devices === "all" || (rules.devices === "mobile" ? isMobile() : !isMobile());
  }

  function pageAllowed(rules) {
    switch (rules.pages) {
      case "all": return true;
      case "home": return pageType === "index";
      case "product": return pageType === "product";
      case "collection": return pageType === "collection" || pageType === "list-collections";
      case "specific":
        var path = window.location.pathname.replace(/\/+$/, "") || "/";
        return (rules.specificUrls || []).some(function (u) {
          var p = u.split("?")[0].replace(/\/+$/, "") || "/";
          if (p.slice(-1) === "*") return path.indexOf(p.slice(0, -1)) === 0;
          return path === p;
        });
      default: return false;
    }
  }

  function frequencyAllowed(c) {
    var key = "trekiva:shown:" + c.id;
    var f = c.rules.frequency;
    if (f === "session") return !read("session", key);
    var last = Number(read("local", key));
    if (!last) return true;
    if (f === "visitor") return false;
    return Date.now() - last >= c.rules.frequencyDays * 86400000;
  }

  function markShown(c) {
    var key = "trekiva:shown:" + c.id;
    write(c.rules.frequency === "session" ? "session" : "local", key, String(Date.now()));
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function isHttps(u) { return typeof u === "string" && /^https:\/\//i.test(u); }

  function focusables(container) {
    return Array.prototype.slice.call(
      container.querySelectorAll('button, input, a[href], [tabindex]:not([tabindex="-1"])')
    ).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
  }

  /* ---------- views ---------- */
  function formView(c, onResult) {
    var wrap = el("div", "tkv-state");
    wrap.appendChild(el("h2", "tkv-title", c.content.title)).id = "tkv-title";
    if (c.content.description) wrap.appendChild(el("p", "tkv-desc", c.content.description));

    var form = el("form", "tkv-form");
    form.noValidate = true;
    var input = el("input", "tkv-input");
    input.type = "email";
    input.name = "email";
    input.autocomplete = "email";
    input.required = true;
    input.placeholder = c.content.emailPlaceholder;
    input.setAttribute("aria-label", c.content.emailPlaceholder);
    var error = el("p", "tkv-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    var btn = el("button", "tkv-btn", c.content.buttonText);
    btn.type = "submit";
    form.appendChild(input);
    form.appendChild(error);
    form.appendChild(btn);
    wrap.appendChild(form);
    if (c.content.privacyText) wrap.appendChild(el("p", "tkv-privacy", c.content.privacyText));

    function fail(msg) { error.textContent = msg; error.hidden = false; input.setAttribute("aria-invalid", "true"); input.focus(); }
    input.addEventListener("input", function () { input.removeAttribute("aria-invalid"); error.hidden = true; });

    var busy = false;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      var email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Please enter a valid email address.");
      error.hidden = true;
      input.removeAttribute("aria-invalid");
      busy = true;
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = "Please wait\u2026";

      fetch(base + "/campaigns/" + encodeURIComponent(c.id) + "/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email }),
        credentials: "same-origin"
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
        })
        .then(function (r) {
          if (r.ok && (r.body.status === "claimed" || r.body.status === "already_claimed" || r.body.status === "not_eligible")) {
            onResult(r.body.status, r.body.message);
          } else {
            throw new Error(r.body && r.body.message ? r.body.message : "error");
          }
        })
        .catch(function (err) {
          busy = false;
          btn.disabled = false;
          btn.textContent = label;
          fail(err && err.message && err.message !== "error" && err.message !== "Failed to fetch"
            ? err.message : "Something went wrong. Please try again.");
        });
    });
    return { node: wrap, focus: function () { input.focus(); } };
  }

  function resultView(c, status, message) {
    var wrap = el("div", "tkv-state");
    // Campaigns saved before these fields existed fall back to the already-claimed copy.
    var titles = {
      claimed: c.content.successTitle,
      already_claimed: c.content.alreadyClaimedTitle,
      not_eligible: c.content.notEligibleTitle || c.content.alreadyClaimedTitle
    };
    var messages = {
      claimed: c.content.successMessage,
      already_claimed: c.content.alreadyClaimedMessage,
      not_eligible: c.content.notEligibleMessage || c.content.alreadyClaimedMessage
    };
    wrap.appendChild(el("span", "tkv-badge")).setAttribute("aria-hidden", "true");
    var h = el("h2", "tkv-title", titles[status] || titles.already_claimed);
    h.id = "tkv-title";
    h.tabIndex = -1;
    wrap.appendChild(h);
    wrap.appendChild(el("p", "tkv-desc", message || messages[status] || messages.already_claimed));
    var close = el("button", "tkv-btn", "Continue shopping");
    close.type = "button";
    close.addEventListener("click", closePopup);
    wrap.appendChild(close);
    return { node: wrap, focus: function () { h.focus(); } };
  }

  /* ---------- other apps' screens (COD checkouts, cart drawers, other popups) ---------- */
  function visible(n) { return n.getClientRects().length > 0 && window.getComputedStyle(n).visibility !== "hidden"; }

  // True while another app or the theme shows something modal. Opening on top of it would cover a
  // checkout the customer is filling in and take their typing focus, so automatic opens wait.
  function otherUiOpen() {
    var modals = document.querySelectorAll('[aria-modal="true"], dialog[open]');
    for (var i = 0; i < modals.length; i++) {
      if (!modals[i].closest(".tkv-overlay") && visible(modals[i])) return true;
    }
    // Many checkout apps use a full-screen fixed layer (often an iframe) without aria-modal.
    var n = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    for (; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.classList && n.classList.contains("tkv-overlay")) return false;
      var cs = window.getComputedStyle(n);
      // A fixed layer stacked above the page; themes' fixed backgrounds sit at z-index auto/0 or below.
      if (cs.position === "fixed" && Number(cs.zIndex) > 0) return true;
    }
    return false;
  }

  // Automatic opens only: waits until nothing else is on screen, re-checking every 1.5 s.
  function openWhenClear() {
    if (openState || opened) return;
    if (!otherUiOpen()) return openPopup();
    var timer = setInterval(function () {
      if (openState || opened) return clearInterval(timer);
      if (!otherUiOpen()) { clearInterval(timer); openPopup(); }
    }, 1500);
  }

  /* ---------- popup shell ---------- */
  function openPopup() {
    if (!campaign || openState) return;
    var c = campaign;
    var d = c.design;
    var hasImage = isHttps(d.imageUrl);

    var overlay = el("div", "tkv-overlay");
    overlay.style.setProperty("--tkv-overlay", String(d.overlayOpacity / 100));

    var dialog = el("div", "tkv-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "tkv-title");
    var s = dialog.style;
    s.setProperty("--tkv-bg", d.backgroundColor);
    s.setProperty("--tkv-text", d.textColor);
    s.setProperty("--tkv-btn-bg", d.buttonBackground);
    s.setProperty("--tkv-btn-text", d.buttonTextColor);
    s.setProperty("--tkv-radius", d.borderRadius + "px");
    s.setProperty("--tkv-width", d.popupWidth + "px");
    s.setProperty("--tkv-align", d.alignment);

    var tpl = c.template;
    if (d.alignment === "center") dialog.classList.add("tkv-align-center");
    dialog.classList.add(tpl === "CENTERED_MINIMAL" ? "tkv-centered" : tpl === "IMAGE_BANNER" ? "tkv-banner" : "tkv-split");

    var body = el("div", "tkv-body");
    if (tpl === "CENTERED_MINIMAL") {
      dialog.classList.add("tkv-column");
      if (hasImage) {
        var logo = el("img", "tkv-logo");
        logo.src = d.imageUrl;
        logo.alt = "";
        body.appendChild(logo);
      }
    } else if (hasImage) {
      dialog.classList.add(d.imagePosition === "top" ? "tkv-column" : d.imagePosition === "right" ? "tkv-row-reverse" : "tkv-row");
      var media = el("div", "tkv-media");
      media.style.backgroundImage = 'url("' + d.imageUrl.replace(/["\\()\s]/g, encodeURIComponent) + '")';
      media.setAttribute("role", "presentation");
      dialog.appendChild(media);
    } else {
      dialog.classList.add("tkv-column");
    }
    dialog.appendChild(body);

    var current;
    function show(view) {
      if (current) body.removeChild(current.node);
      current = view;
      body.appendChild(view.node);
    }
    show(formView(c, function (status, message) {
      show(resultView(c, status, message));
      current.focus();
    }));

    if (d.showCloseIcon) {
      var x = el("button", "tkv-close"); // the cross is drawn in CSS
      x.type = "button";
      x.setAttribute("aria-label", "Close");
      x.addEventListener("click", closePopup);
      dialog.appendChild(x);
    }

    overlay.appendChild(dialog);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) closePopup(); });
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") return closePopup();
      if (e.key !== "Tab") return;
      var f = focusables(dialog);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // Scroll is locked with our own class, never by editing body.style: COD and cart apps edit that
    // too, and saving/restoring it across their open/close left the store unable to scroll.
    openState = { overlay: overlay, previousFocus: document.activeElement };
    document.documentElement.classList.add("tkv-lock");
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add("tkv-visible"); });
    current.focus();
    if (!opened) { opened = true; markShown(c); }
  }

  function closePopup() {
    if (!openState) return;
    var st = openState;
    openState = null;
    document.documentElement.classList.remove("tkv-lock");
    if (st.overlay.parentNode) st.overlay.parentNode.removeChild(st.overlay);
    var prev = st.previousFocus;
    // Only hand focus back to something still on the page (not e.g. a checkout that has since closed).
    if (prev && prev !== document.body && prev.focus && document.contains(prev)) {
      try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- triggers ---------- */
  function schedule(c) {
    var t = c.rules.trigger;
    if (t === "manual") return;
    if (t === "load") return openWhenClear();
    if (t === "delay") return void setTimeout(openWhenClear, Math.max(0, c.rules.delaySeconds) * 1000);
    if (t === "exit_intent") {
      if (isMobile()) return; // exit intent is desktop only
      var onOut = function (e) {
        // Leaving the window while a checkout is open is not exit intent; keep listening instead.
        if (e.clientY <= 0 && !e.relatedTarget && !otherUiOpen()) {
          document.removeEventListener("mouseout", onOut);
          openPopup();
        }
      };
      document.addEventListener("mouseout", onOut);
    }
  }

  /* ---------- boot ---------- */
  window.TrekivaPopup = {
    open: function () { if (campaign) openPopup(); else pendingOpen = true; },
    close: closePopup
  };

  fetch(base + "/campaigns/active", { headers: { Accept: "application/json" }, credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || !data.campaign) return;
      campaign = data.campaign;
      if (pendingOpen) openPopup();
      var preview = root.getAttribute("data-design-mode") === "true";
      var r = campaign.rules;
      if (r.trigger === "manual") return; // opened by window.TrekivaPopup.open()
      if (!preview && !(deviceAllowed(r) && pageAllowed(r) && frequencyAllowed(campaign))) return;
      schedule(campaign);
    })
    .catch(function () { /* never break the storefront */ });
})();
