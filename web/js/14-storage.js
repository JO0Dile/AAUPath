// ==========================
// SHARED UI UTILITIES & STORAGE
// ==========================
// getJSON/setJSON replace what used to be ~9 separate, near-identical
// try{JSON.parse(localStorage.getItem(key)||'{}')||{}}catch(e){...} copies
// scattered across the Achievements/Imported-Plans/Community-Data/Plan-
// Editor/etc. modules below — same behavior (see the equivalence check run
// before this consolidation), one definition.
(function(){
  // The old body was `JSON.parse(raw) || fallback`, which only rejected values
  // that happened to be falsy. Anything else parsed was handed straight back —
  // so a key holding `[true,null,0]`, `"text"`, `12345` or `true` was returned
  // where every single caller expects an object map. Downstream that became
  // `Object.keys(arr)` -> ["0","1","2"] and then `plans["1"].university` on a
  // null, an uncaught TypeError that took the home screen's plan list with it.
  // localStorage is user-writable, an import writes it, and a half-finished
  // write can truncate it, so the shape has to be checked here rather than at
  // each of the ~9 call sites.
  function getJSON(key, fallback){
    try{
      var raw = localStorage.getItem(key);
      if(raw == null) return fallback;
      var parsed = JSON.parse(raw);
      if(parsed === null || parsed === undefined) return fallback;
      if(Array.isArray(parsed) !== Array.isArray(fallback)) return fallback;
      if(typeof parsed !== typeof fallback) return fallback;
      return parsed;
    }
    catch(e){ return fallback; }
  }
  function setJSON(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }
    catch(e){ return false; }
    // Every create/edit of a user-built plan (a new college, a new plan, an
    // added course, a moved course) writes aaup_importedPlans through here —
    // one chokepoint — so this is the one place auto-collection needs to
    // notice a change. Guarded + debounced inside AAUP_COLLECT; a no-op when
    // APP_COLLECT_URL isn't configured, so it costs nothing until turned on.
    if(key === 'aaup_importedPlans' && typeof window.__collectOnPlansChanged === 'function'){
      try{ window.__collectOnPlansChanged(value); }catch(e){}
    }
    return true;
  }
  window.AAUP_STORAGE = { getJSON: getJSON, setJSON: setJSON };

  // ONE MESSAGE AT A TIME.
  //
  // There used to be three toasts — a plain one, one with a button, and the
  // "now open to you" card — each on its own timer in its own element. Tick
  // one course and up to three landed at once, stacked over the plan and the
  // tab bar. Now there is one box and one queue:
  //   - a message that arrives while another has only just appeared (the
  //     achievement a tick unlocked, say) joins it as an extra line, so the
  //     whole moment is one message;
  //   - anything later waits until the current one has gone;
  //   - the box has at most one button; a merged message that has its own
  //     action becomes a tappable line instead.
  var MERGE_MS = 1500;
  var queue = [], current = null, hideTimer = null;

  function noticeEls(){
    return {
      box: document.getElementById('globalNotice'),
      icon: document.getElementById('globalNoticeIcon'),
      title: document.getElementById('globalNoticeTitle'),
      sub: document.getElementById('globalNoticeSub'),
      extras: document.getElementById('globalNoticeExtras'),
      btn: document.getElementById('globalNoticeBtn')
    };
  }
  function iconFor(kind){
    var key = kind === 'ok' ? 'tick' : kind === 'award' ? 'trophy' : 'help';
    return window.AAUP_ICONS ? window.AAUP_ICONS.preview(key, 14) : '';
  }
  function paint(){
    var e = noticeEls();
    if(!e.box || !current) return;
    e.box.className = 'notice notice-' + (current.kind || 'plain') + ' show';
    if(e.icon) e.icon.innerHTML = iconFor(current.kind);
    e.title.textContent = current.title;
    e.sub.textContent = current.sub || '';
    e.sub.hidden = !current.sub;
    e.extras.innerHTML = '';
    current.extras.forEach(function(x){
      var el = document.createElement(x.action ? 'button' : 'span');
      el.className = 'notice-extra notice-extra-' + (x.kind || 'plain');
      if(x.action){ el.type = 'button'; }
      el.innerHTML = iconFor(x.kind);
      // The action's label is said once: on the box's own button when that
      // button already says it ("See the rest" twice read as a stutter).
      var sameAsButton = x.action && current.action && x.action.label === current.action.label;
      el.appendChild(document.createTextNode(x.text + (x.action && !sameAsButton ? ' · ' + x.action.label : '')));
      if(x.action){ el.addEventListener('click', function(){ hide(); try{ x.action.fn(); }catch(err){} }); }
      e.extras.appendChild(el);
    });
    e.extras.hidden = !current.extras.length;
    if(current.action){
      e.btn.hidden = false;
      e.btn.textContent = current.action.label;
    } else {
      e.btn.hidden = true;
    }
  }
  function arm(){
    if(hideTimer) clearTimeout(hideTimer);
    var ms = current.ms || (current.action ? 6000 : 3200);
    hideTimer = setTimeout(hide, ms + current.extras.length * 1500);
  }
  function hide(){
    var e = noticeEls();
    if(hideTimer){ clearTimeout(hideTimer); hideTimer = null; }
    current = null;
    if(e.box) e.box.classList.remove('show');
    if(queue.length){ setTimeout(function(){ if(!current && queue.length) show(queue.shift()); }, 280); }
  }
  function show(n){
    current = n;
    n.extras = n.extras || [];
    n.shownAt = Date.now();
    paint();
    arm();
  }
  function notify(n){
    if(!n || !n.title) return;
    // The same words twice in a row (a double tap) are one message.
    if(current && current.title === n.title && current.sub === n.sub){ arm(); return; }
    if(current && Date.now() - current.shownAt < MERGE_MS){
      current.extras.push({ text: n.sub ? n.title + ' — ' + n.sub : n.title, kind: n.kind, action: n.action });
      paint();
      arm();
      return;
    }
    if(current){ queue.push(n); return; }
    show(n);
  }
  function bindNotice(){
    var e = noticeEls();
    if(!e.btn || e.btn.__bound) return;
    e.btn.__bound = true;
    e.btn.addEventListener('click', function(){
      var a = current && current.action;
      hide();
      if(a){ try{ a.fn(); }catch(err){} }
    });
  }
  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', bindNotice); }
  else { bindNotice(); }

  function showToast(msg){ notify({ title: String(msg || ''), kind: 'plain' }); }
  // "Say it out loud" — the visible half of what the screen-reader announcer
  // already speaks when a tick opens other courses (announceToggle in
  // js/28-imported.js). opts.undo puts an Undo button on it.
  function showUnlockToast(title, subtitle, opts){
    notify({ title: title, sub: subtitle || '', kind: 'ok',
             action: opts && opts.undo ? { label: opts.undoLabel || 'Undo', fn: opts.undo } : null,
             ms: opts && opts.undo ? 5000 : 0 });
  }
  // A message with one tappable action ("Moved — Undo", "Achievement — See
  // the rest"). onAction runs at most once. opts.kind picks the icon.
  function showActionToast(msg, actionLabel, onAction, opts){
    notify({ title: String(msg || ''), kind: (opts && opts.kind) || 'plain',
             action: { label: actionLabel, fn: onAction } });
  }
  window.__showActionToast = showActionToast;
  window.__notify = notify;
  // Ten modules ask this question — the assistant, the Fix panel, the export
  // dialog, achievements, the back bar, the developer panel — and it used to
  // answer it by looking for a visible `.plan-page` carrying rtl-mode. That
  // was wrong twice over. An imported plan renders as `.sheet.sheet-plan`,
  // not `.plan-page`, so it was never seen at all; and with no plan on screen
  // at all — the picker, Settings, the assistant opened from the tab bar —
  // there was nothing to look at and the answer was always English, however
  // the language switch was set.
  //
  // The switch is the answer. The DOM is checked first only so that a plan
  // page still mid-render reports what it is actually showing.
  function anyVisiblePageIsRtl(){
    var pages = document.querySelectorAll('.plan-page, .sheet-plan');
    for(var i = 0; i < pages.length; i++){
      if(pages[i].style.display !== 'none' && pages[i].classList.contains('rtl-mode')) return true;
    }
    return !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
  }
  window.__showToast = showToast;

  // One empty screen, everywhere: what is missing, why, and one button that
  // fixes it. btnAttr is the data-attribute the owning module listens for.
  window.__emptyState = function(o){
    var esc = window.__escapeHtml || function(x){ return String(x); };
    var icon = o.icon && window.AAUP_ICONS ? window.AAUP_ICONS.preview(o.icon, 22) : '';
    return '<div class="empty-state">' +
      (icon ? '<div class="es-icon">' + icon + '</div>' : '') +
      '<b class="es-title">' + esc(o.title) + '</b>' +
      (o.text ? '<p class="es-text">' + esc(o.text) + '</p>' : '') +
      (o.btn ? '<button type="button" class="es-btn" ' + (o.btnAttr || '') + '>' + esc(o.btn) + '</button>' : '') +
      '</div>';
  };
  window.__showUnlockToast = showUnlockToast;
  window.__anyVisiblePageIsRtl = anyVisiblePageIsRtl;

  // A stable per-device id, with no account behind it — first used by
  // Student Thoughts (so a student can delete their own post) and now
  // shared with Contributions (so a student can check back for a reply).
  // Same key, same device, one identity across every feature that needs
  // "this browser" without needing "this person".
  function deviceId(){
    var k = 'aaup_deviceId';
    try{
      var v = localStorage.getItem(k);
      if(!v){
        v = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem(k, v);
      }
      return v;
    }catch(e){ return 'd-anon'; }
  }
  window.__deviceId = deviceId;

  // ---------------------------------------------------------------------
  // On a phone a dialog is presented as a page (see the max-width:720px block
  // in css/app.css), so the phone's own Back gesture has to close it. Without
  // this, Back leaves the app entirely from what looks like a normal screen —
  // the single most jarring thing a "page" can do.
  //
  // Done here, once, by watching the shared .open class rather than by editing
  // each dialog's open()/close(): there are a dozen of them across as many
  // modules, and any new one should get this for free.
  var pushedForModal = 0;      // history entries this owns, so it never eats
                               // a Back press that belongs to the app itself.
  function openModalCount(){
    return document.querySelectorAll('.modal-overlay.open').length;
  }
  function isPhone(){
    return window.matchMedia && window.matchMedia('(max-width:720px)').matches;
  }

  var lastCount = 0;
  function syncHistory(){
    var now = openModalCount();
    if(now > lastCount && isPhone()){
      // A dialog just opened as a page: give Back something to land on.
      try{ history.pushState({ __aaupModal: true }, ''); pushedForModal++; }catch(e){}
    } else if(now < lastCount && pushedForModal > 0){
      // Closed by its own back arrow / Escape / backdrop rather than by Back.
      // Drop the entry we added so the next Back press is not swallowed.
      pushedForModal--;
      try{ history.back(); }catch(e){}
    }
    lastCount = now;
  }

  window.addEventListener('popstate', function(){
    if(pushedForModal <= 0) return;   // not ours — let the app navigate
    var open = document.querySelectorAll('.modal-overlay.open');
    if(!open.length){ pushedForModal = 0; lastCount = 0; return; }
    pushedForModal--;
    // Close the topmost one via its own control so each module's own cleanup
    // runs, falling back to the class when a dialog has no close button.
    var top = open[open.length - 1];
    var btn = top.querySelector('.modal-close, [id$="Close"]');
    if(btn){ btn.click(); } else { top.classList.remove('open'); }
    lastCount = openModalCount();
  });

  function watchModals(){
    lastCount = openModalCount();
    var obs = new MutationObserver(syncHistory);
    document.querySelectorAll('.modal-overlay').forEach(function(el){
      obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    // Dialogs created after load (the Plan Overview builds its overlay on
    // demand) are picked up by watching the body for new overlays.
    new MutationObserver(function(muts){
      muts.forEach(function(m){
        Array.prototype.forEach.call(m.addedNodes, function(n){
          if(n.nodeType === 1 && n.classList && n.classList.contains('modal-overlay')){
            obs.observe(n, { attributes: true, attributeFilter: ['class'] });
          }
        });
      });
    }).observe(document.body, { childList: true });
  }
  if(document.readyState === 'complete'){ watchModals(); }
  else { window.addEventListener('load', watchModals); }
})();
