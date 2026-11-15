/* ==========================================================================
   DSH mobile adaptation runtime (injected by the Tailscale mobile gateway)
   - keeps the injected stylesheet last so it wins over dynamically loaded
     client-plugin styles at equal specificity
   - phone drawer scrim + tap-to-close behavior for the sidebar
   - closing the sidebar drawer after choosing a session / workspace
   - iOS visual-viewport (soft keyboard) handling
   ========================================================================== */
(() => {
  'use strict';
  if (window.__DSH_MOBILE_ADAPTED__) return;
  window.__DSH_MOBILE_ADAPTED__ = true;

  const PHONE_QUERY = '(max-width: 600px)';
  const phone = window.matchMedia(PHONE_QUERY);
  const isPhone = () => phone.matches;
  // Phones and touch tablets (iPad) use mobile return-key semantics; only a
  // desktop-class pointer keeps Enter = send.
  const isTouchLike = () =>
    isPhone() ||
    (window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches &&
      window.matchMedia('(max-width: 1200px)').matches);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- stylesheet ordering ---------- */

  const styleHref = '/__dsh_mobile/mobile.css';
  function keepStylesheetLast() {
    const link = $$('link[rel="stylesheet"]').find((el) => (el.getAttribute('href') || '').includes('/__dsh_mobile/mobile.css'));
    const head = document.head;
    if (!head) return;
    if (!link) {
      const fresh = document.createElement('link');
      fresh.rel = 'stylesheet';
      fresh.href = styleHref;
      fresh.dataset.dshMobile = 'true';
      head.appendChild(fresh);
      return;
    }
    if (head.lastElementChild !== link) head.appendChild(link);
  }

  /* ---------- drawer scrim ---------- */

  let scrim = null;
  function ensureScrim() {
    if (scrim && scrim.isConnected) return scrim;
    scrim = document.createElement('div');
    scrim.className = 'dsh-mobile-scrim';
    scrim.dataset.show = 'false';
    scrim.setAttribute('aria-hidden', 'true');
    scrim.addEventListener('click', () => closeOverlays());
    document.body.appendChild(scrim);
    return scrim;
  }

  const frame = () => $('.BynINW_frame');
  // DSH drops the collapsed attribute when a panel is expanded.
  const sidebarOpen = () => {
    const el = frame();
    return Boolean(el) && !el.hasAttribute('data-sidebar-collapsed');
  };
  const rightbarOpen = () => {
    const el = frame();
    return Boolean(el) && !el.hasAttribute('data-rightbar-collapsed');
  };

  function toggleButton() {
    return $('[aria-keyshortcuts="Alt+Meta+B"]') || $('.BynINW_sidebarCol [aria-label*="侧边栏"]');
  }

  function closeRightbar() {
    const button =
      $$('button').find((el) => /收起右侧边栏|关闭右侧边栏/.test(el.getAttribute('aria-label') || '') && el.offsetParent !== null) ||
      $$('button').find((el) => /右侧边栏/.test(el.getAttribute('aria-label') || '') && el.offsetParent !== null);
    button?.click();
  }

  function closeOverlays() {
    if (isPhone() && sidebarOpen()) toggleButton()?.click();
    if (isPhone() && rightbarOpen()) closeRightbar();
  }

  function syncScrim() {
    const el = ensureScrim();
    const show = isPhone() && (sidebarOpen() || rightbarOpen());
    el.dataset.show = show ? 'true' : 'false';
    document.documentElement.classList.toggle('dsh-m-overlay-open', show);
    ensureMenuButton();
  }

  /* ---------- floating sidebar button (the rail is hidden on phones) ---------- */

  function ensureMenuButton() {
    let button = $('.dsh-mobile-menu');
    if (!isPhone()) {
      button?.remove();
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'dsh-mobile-menu';
      button.setAttribute('aria-label', '打开侧边栏');
      button.innerHTML =
        '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
      button.addEventListener('click', () => {
        toggleButton()?.click();
      });
      document.body.appendChild(button);
    }
    button.style.display = sidebarOpen() || rightbarOpen() ? 'none' : '';
  }

  /* ---------- newline support for the Lexical composer ---------- */

  /** Ask Lexical for a soft line break through its beforeinput path. */
  function insertLineBreak(editor) {
    if (!editor) return false;
    if (document.activeElement !== editor) editor.focus();
    const event = new InputEvent('beforeinput', {
      inputType: 'insertLineBreak',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    editor.dispatchEvent(event);
    window.__DSH_MOBILE_NEWLINE__ = (window.__DSH_MOBILE_NEWLINE__ || 0) + 1;
    return true;
  }

  // On phones/tablets the IME return key sends the message in DSH's desktop
  // semantics. Intercept it at the earliest capture point and turn it into a
  // line break; sending stays available through the blue send button.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!isTouchLike() || event.key !== 'Enter') return;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const editor = target ? target.closest('[data-lexical-editor]') : null;
      if (!editor) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      insertLineBreak(editor);
    },
    true,
  );

  /* Keep short conversations anchored to the bottom (above the composer). */
  function ensureBottomSpacer() {
    const existing = $$('.dsh-mobile-spacer');
    for (const el of existing) el.remove();
  }

  /* ---------- session rows: one tap switches, double tap never renames ---------- */

  let suppressKeyboardUntil = 0;
  function suppressKeyboard(ms = 2400) {
    suppressKeyboardUntil = Date.now() + ms;
  }

  // iOS Safari may consume the first tap on the draggable session row (focus /
  // drag detection), so the trusted click never reaches the row. Open the row
  // from the touch sequence ourselves instead; the click handler below is kept
  // as a fallback for mouse / trackpad and is de-duplicated by this timestamp.
  let lastSessionOpenAt = 0;
  let primaryTouchStart = null;
  function openSessionRow(row) {
    const now = Date.now();
    if (now - lastSessionOpenAt < 500) return;
    lastSessionOpenAt = now;
    suppressKeyboard();
    window.setTimeout(() => row.click(), 0);
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      const target = event.target instanceof Element ? event.target : null;
      // Capture the row while the finger goes down: a HoverCard / overlay may
      // already cover the row by the time pointerup fires.
      const interactive = target && target.closest('.hIlkoa_rowActions, button, input, textarea, [contenteditable="true"]');
      const row = !interactive && target ? target.closest('[data-row-key^="session:"]') : null;
      primaryTouchStart = { x: event.clientX, y: event.clientY, row };
    },
    true,
  );

  document.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerType !== 'touch' || primaryTouchStart === null) return;
      const start = primaryTouchStart;
      primaryTouchStart = null;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
      if (!start.row) return;
      openSessionRow(start.row);
    },
    true,
  );

  // DSH's session title span only implements double-click rename, so a tap on
  // the title is swallowed. Re-dispatch the tap on the row container, which
  // owns the "open session" handler, so one tap switches immediately.
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const title = target.closest('.hIlkoa_title');
      if (!title) return;
      const row = title.closest('[data-row-key^="session:"]');
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      openSessionRow(row);
    },
    true,
  );

  // Never let a quick double tap open the rename editor; rename stays available
  // from the row's "more actions" menu.
  document.addEventListener(
    'dblclick',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('[data-row-key^="session:"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  // Opening a session auto-focuses the composer on DSH desktop; on touch that
  // pops the keyboard. Blur focus arriving shortly after a session switch;
  // tapping the composer clears the suppression immediately.
  document.addEventListener(
    'focusin',
    (event) => {
      if (Date.now() > suppressKeyboardUntil) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches?.('[data-lexical-editor]') ||
          target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA')
      ) {
        target.blur();
        window.setTimeout(() => {
          if (Date.now() < suppressKeyboardUntil) target.blur();
        }, 60);
      }
    },
    true,
  );

  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('[data-composer-seat]')) suppressKeyboardUntil = 0;
    },
    true,
  );

  // Any session row tap (title or background) suppresses the auto keyboard.
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('[data-row-key^="session:"]')) suppressKeyboard();
    },
    true,
  );

  // The app should start with the keyboard closed as well.
  suppressKeyboard(1200);

  document.addEventListener(
    'click',
    (event) => {
      if (!isPhone() || !sidebarOpen()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const sidebar = target.closest('.BynINW_sidebarCol');
      if (!sidebar) return;
      const actionable = target.closest('button, a, [role="button"], [role="menuitem"]');
      // Only a real session row closes the drawer; workspace rows expand a
      // folder inside the drawer and must keep it open.
      const sessionRow = target.closest('.hIlkoa_sessionRow, [data-row-key^="session:"]');
      if (!sessionRow) return;
      // Row action buttons (archive / pin / ...) should not close the drawer.
      if (target.closest('.hIlkoa_rowActions')) return;
      // Keep the rail / brand / footer interactions from auto-closing.
      if ((actionable || target).closest('._2H3hWW_logoRow, ._2H3hWW_footArea, ._2H3hWW_panelList, ._2H3hWW_toggle')) return;
      window.setTimeout(() => {
        if (isPhone() && sidebarOpen()) toggleButton()?.click();
      }, 220);
    },
    true,
  );

  /* ---------- iOS visual viewport / soft keyboard ---------- */

  const root = document.documentElement;
  const isEditableElement = (el) =>
    el instanceof HTMLElement &&
    (el.isContentEditable || el.matches?.('[data-lexical-editor]') || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  let editableFocused = false;

  function clearKeyboardLayout() {
    root.classList.remove('dsh-m-keyboard');
    root.style.removeProperty('--dsh-m-vv-height');
    root.style.removeProperty('--dsh-m-vv-offset');
  }

  function syncViewport() {
    const vv = window.visualViewport;
    if (!vv || !isPhone()) {
      clearKeyboardLayout();
      return;
    }
    // Only shrink the app while a text field really owns focus. iOS can keep a
    // stale, reduced visualViewport after dismissal; requiring focus (and
    // clearing on blur / outside tap) lets the layout recover reliably.
    if (!editableFocused) {
      clearKeyboardLayout();
      if ((window.scrollY || 0) !== 0) window.scrollTo(0, 0);
      return;
    }
    if (vv.height < window.innerHeight - 120) {
      root.classList.add('dsh-m-keyboard');
      root.style.setProperty('--dsh-m-vv-height', `${Math.round(vv.height)}px`);
      root.style.setProperty('--dsh-m-vv-offset', `${Math.round(vv.offsetTop || 0)}px`);
    } else {
      clearKeyboardLayout();
    }
  }

  function settleViewport() {
    if (!isEditableElement(document.activeElement)) editableFocused = false;
    syncViewport();
  }

  // iOS standalone web apps (home-screen icons) sometimes lay the web view out
  // below the status bar: window.innerHeight is already ~status-bar shorter than
  // the screen. In that case the safe-area top inset must not be added again.
  function syncStandaloneInsets() {
    const standalone =
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const belowStatusBar = standalone && window.innerHeight > 0 && window.innerHeight < window.screen.height - 40;
    root.classList.toggle('dsh-m-vp-below-statusbar', belowStatusBar);
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }
  window.addEventListener('resize', () => {
    syncStandaloneInsets();
    syncViewport();
  });
  window.addEventListener('pageshow', () => {
    editableFocused = false;
    syncStandaloneInsets();
    settleViewport();
  });
  window.addEventListener('orientationchange', () => {
    editableFocused = false;
    window.setTimeout(settleViewport, 250);
  });
  phone.addEventListener?.('change', syncViewport);

  document.addEventListener(
    'focusin',
    (event) => {
      if (!isEditableElement(event.target)) return;
      editableFocused = true;
      window.setTimeout(syncViewport, 100);
      window.setTimeout(syncViewport, 350);
    },
    true,
  );

  document.addEventListener(
    'focusout',
    (event) => {
      if (!isEditableElement(event.target)) return;
      // The visual viewport may still report the keyboard height while the
      // dismissal animation runs; settle a few times afterwards.
      window.setTimeout(settleViewport, 150);
      window.setTimeout(settleViewport, 500);
      window.setTimeout(settleViewport, 1200);
    },
    true,
  );

  // Any tap outside the composer gives up focus and restores the full height —
  // this is the escape hatch for a stale keyboard layout.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!isPhone()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('[data-composer-seat]')) return;
      const active = document.activeElement;
      if (isEditableElement(active)) active.blur?.();
      editableFocused = false;
      window.setTimeout(syncViewport, 30);
      window.setTimeout(syncViewport, 300);
    },
    true,
  );

  // Watchdog: never leave the shrunken keyboard layout behind once focus is gone.
  window.setInterval(() => {
    if (!isPhone()) return;
    if (!editableFocused) {
      if (root.classList.contains('dsh-m-keyboard')) clearKeyboardLayout();
      return;
    }
    syncViewport();
  }, 700);

  // Extra safety for older iOS: a touch anywhere outside the editor proves the
  // keyboard layout should no longer apply.
  document.addEventListener(
    'touchstart',
    () => {
      if (!isPhone()) return;
      if (!isEditableElement(document.activeElement)) {
        editableFocused = false;
        clearKeyboardLayout();
      }
    },
    { capture: true, passive: true },
  );


  /* ---------- iOS "add to home screen" hint ---------- */

  function installTip() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua);
    if (!ios) return;
    const standalone =
      window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (standalone) return;
    try {
      if (window.localStorage.getItem('dsh-mobile-install-tip-dismissed') === '1') return;
    } catch {
      // private mode may deny storage; show the tip anyway
    }
    if (document.querySelector('.dsh-install-tip')) return;

    const tip = document.createElement('div');
    tip.className = 'dsh-install-tip';
    tip.setAttribute('role', 'note');
    const label = document.createElement('span');
    label.innerHTML =
      '想把 DSH 放到主屏幕？点 Safari 底部的 <b>分享</b> 图标 → <b>添加到主屏幕</b>。<br /><span class="dsh-install-tip-sub">分享菜单里没有这一项时，请复制链接、用 Safari 打开本页。</span>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dsh-install-tip-close';
    close.setAttribute('aria-label', '关闭提示');
    close.textContent = '×';
    const dismiss = () => {
      tip.dataset.hide = 'true';
      try {
        window.localStorage.setItem('dsh-mobile-install-tip-dismissed', '1');
      } catch {
        // ignore
      }
      window.setTimeout(() => tip.remove(), 250);
    };
    close.addEventListener('click', dismiss);
    tip.append(label, close);
    document.body.appendChild(tip);
    window.setTimeout(() => {
      if (tip.isConnected) dismiss();
    }, 12000);
  }

  /* ---------- observers: frame state, stylesheet order ---------- */

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      keepStylesheetLast();
      syncScrim();
      syncStandaloneInsets();
      syncViewport();
      ensureBottomSpacer();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-sidebar-collapsed', 'data-rightbar-collapsed'],
  });
  observer.observe(document.head, { childList: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }

  window.setTimeout(installTip, 2500);
})();
