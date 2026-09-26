// ==========================
// BACK BAR — an obvious way out of every dialog, on every screen size.
//
// Phones already got this: a dialog opens as a full page with a back bar across
// the top (see the max-width:720px block in css/app.css). On a desktop the
// only way out was a small ✕ in the corner, Escape, or clicking the backdrop
// — three things you have to already know. Students said it plainly: they
// want a button that says "back", because that is what every app they use
// has, and hunting for the exit is not a puzzle worth setting.
//
// Rather than edit a dozen modules that each build their own dialog, this
// watches for any .modal-overlay gaining .open and puts one back bar at the
// top of its card if it has not got one. The bar reuses the dialog's own
// .modal-close button, so every module's existing cleanup still runs on the
// way out — nothing here knows what any particular dialog does.
//
// Dialogs that build their body from scratch can call __backBarHTML() and
// get the same bar inline instead; the auto-injector then leaves them alone.
// ==========================
(function(){
  'use strict';

  var LABEL = { en: 'Back', ar: 'رجوع' };

  // Some dialogs are deliberately chromeless — the onboarding wizard runs the
  // whole screen and has its own step navigation (js/55-onboarding.js's own
  // "← Back" steps BACK one screen; it is not a close button), and the story
  // stack (semester recap + the "why is this locked?" walkthrough,
  // js/56-story-stack.js) has its own progress dots and its own ✕. A second
  // "← Back" pasted on top of either would not just be visual clutter: on
  // the onboarding wizard it silently CLOSED THE WHOLE FIRST-RUN SETUP,
  // because that overlay has no .modal-close for the click handler to defer
  // to, so it fell through to `overlay.classList.remove('open')` — verified
  // by opening a brand-new profile and pressing the injected bar once.
  //
  // This list previously read 'onboardingOverlay' / 'storyOverlay' /
  // 'recapOverlay' / 'shareCardOverlay' — none of which are real element
  // ids (the actual ones are onboardingWizardOverlay and storyStackOverlay;
  // the other two never existed), so neither dialog was actually being
  // skipped despite the comment saying they would be.
  //
  // englishLevelOverlay joins them for a different reason: it is the one
  // dialog in the app that deliberately has no way out but an answer, and a
  // "Back" bar injected into it would be exactly the escape hatch it exists
  // without.
  var SKIP = ['onboardingWizardOverlay', 'storyStackOverlay', 'englishLevelOverlay'];

  function isRtlNow(card){
    if(card && card.getAttribute('dir') === 'rtl') return true;
    if(document.documentElement.getAttribute('dir') === 'rtl') return true;
    return !!(window.__anyVisiblePageIsRtl && window.__anyVisiblePageIsRtl());
  }

  // The markup, for dialogs that render their own body and want the bar in a
  // known place rather than injected on top.
  window.__backBarHTML = function(title, overlayId, rtl){
    var label = rtl ? LABEL.ar : LABEL.en;
    return '<div class="back-bar' + (rtl ? ' back-bar-rtl' : '') + '">' +
      '<button type="button" class="back-bar-btn" data-back-for="' +
        window.__escapeHtml(overlayId || '') + '">' +
        '<span class="back-bar-arrow" aria-hidden="true">' + window.AAUP_ICONS.preview('back', 16) + '</span>' +
        '<span>' + window.__escapeHtml(label) + '</span>' +
      '</button>' +
      (title ? '<span class="back-bar-title">' + window.__escapeHtml(title) + '</span>' : '') +
      '</div>';
  };

  // One delegated listener for every bar, however it got onto the page.
  //
  // On the CAPTURE phase, because several dialogs stop click propagation on
  // their own card (so a click inside does not reach the backdrop handler
  // that closes them). A bubbling listener on document never sees those
  // clicks at all, and the back button silently does nothing — which is
  // exactly the problem this whole file exists to fix.
  document.addEventListener('click', function(e){
    var btn = e.target.closest('[data-back-for]');
    if(!btn) return;
    e.preventDefault();
    var overlay = document.getElementById(btn.getAttribute('data-back-for')) ||
                  btn.closest('.modal-overlay');
    if(!overlay) return;
    // Close through the dialog's own control when it has one, so whatever
    // that module does on close still happens.
    var own = overlay.querySelector('.modal-close, [id$="Close"]');
    if(own && own !== btn){ own.click(); }
    else { overlay.classList.remove('open'); }
  }, true);

  // Every dialog card gets dir set from the app-wide language, so logical
  // properties (inset-inline-start and friends) resolve to the right edge
  // and the [dir="rtl"] rules in css/app.css finally match.
  function markDirection(card){
    var rtl = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    if(card.getAttribute('dir') !== (rtl ? 'rtl' : 'ltr')){
      card.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    }
  }

  function inject(overlay){
    if(!overlay || SKIP.indexOf(overlay.id) !== -1) return;
    var card = overlay.querySelector('.modal-card');
    if(!card) return;
    // Mark the card's own direction. The stylesheet is full of
    // `.modal-card[dir="rtl"]` rules that were written expecting this and
    // never matched, because nothing set it — which is why the phone's back
    // arrow pointed the wrong way in Arabic and every control that should
    // mirror to the other side stayed put. Set on the card and not on
    // <html>: a global flip would turn on a large amount of RTL CSS that has
    // never run, all at once, and this is a dialog problem.
    markDirection(card);
    if(card.querySelector(':scope > .back-bar')){ watchTitle(card); return; }
    // A dialog that already rendered its own bar inside its body is left
    // alone — two bars would be worse than none.
    if(card.querySelector('.back-bar')){ watchTitle(card); return; }
    var rtl = isRtlNow(card);
    var bar = document.createElement('div');
    bar.className = 'back-bar back-bar-auto' + (rtl ? ' back-bar-rtl' : '');
    bar.innerHTML =
      '<button type="button" class="back-bar-btn" data-back-for="' + overlay.id + '">' +
        '<span class="back-bar-arrow" aria-hidden="true">' + window.AAUP_ICONS.preview('back', 16) + '</span>' +
        '<span>' + (rtl ? LABEL.ar : LABEL.en) + '</span>' +
      '</button>';
    card.insertBefore(bar, card.firstChild);
    watchTitle(card);
  }

  // ============================================================
  // THE BAR SAYS WHERE YOU ARE
  //
  // On a phone the way back used to be a tab stuck to the left edge, half
  // way down, sitting on top of whatever the screen showed. It is a top bar
  // now: the arrow and the screen's own name. The name is read from the
  // dialog's heading, and that heading is tagged so the phone stylesheet can
  // hide it — the bar is saying it already. Re-run whenever the dialog
  // redraws itself (Settings rebuilds on every tab, for instance), because a
  // rebuilt heading is a new element without the tag.
  var TITLE_SEL = 'h2, .ct-title, .lib-title, .cal-title, .abt-title, .share-title';
  var HEAD_WRAPS = ['ct-head', 'lib-head', 'cal-head', 'abt-head', 'share-head'];
  function retitle(card){
    var bar = card.querySelector('.back-bar');
    if(!bar) return;
    var heads = [].slice.call(card.querySelectorAll(TITLE_SEL)).filter(function(h){
      if(h.closest('.back-bar')) return false;
      // Visible, or already the one this bar took its name from (which the
      // phone stylesheet has since hidden).
      return h.offsetParent !== null || !!h.closest('.bb-title-src');
    });
    var h = heads[0];
    var text = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
    var span = bar.querySelector('.back-bar-title');
    if(!span){
      span = document.createElement('span');
      span.className = 'back-bar-title bb-auto-title';
      bar.appendChild(span);
    }
    if(span.classList.contains('bb-auto-title') && span.textContent !== text){ span.textContent = text; }
    bar.classList.toggle('bb-has-title', !!text);
    if(h){
      var wrap = h.parentElement && HEAD_WRAPS.some(function(c){ return h.parentElement.classList.contains(c); }) ? h.parentElement : h;
      if(!wrap.classList.contains('bb-title-src')) wrap.classList.add('bb-title-src');
    }
  }
  var titleObservers = new WeakMap();
  function watchTitle(card){
    retitle(card);
    if(titleObservers.has(card)) return;
    var pending = false;
    var mo = new MutationObserver(function(){
      if(pending) return;
      pending = true;
      requestAnimationFrame(function(){ pending = false; retitle(card); });
    });
    mo.observe(card, { childList: true, subtree: true });
    titleObservers.set(card, mo);
  }

  // ============================================================
  // 46 · THE SYSTEM BACK GESTURE CLOSES THE DIALOG
  //
  // Every dialog in this app is a `.open` class on an overlay, not a history
  // entry. So on Android — where back is the first thing anyone reaches for,
  // and on most phones it is a swipe from the edge rather than a button you
  // have to aim at — pressing back inside the Degree Audit left AAUPath
  // entirely and lost where the student was. On iOS the same gesture went
  // back a page in the browser.
  //
  // One history entry per open dialog fixes it. The entry is tagged so a
  // popstate that is NOT ours (the student really did want to go back a page)
  // falls through untouched, and closing a dialog by its own control pops the
  // entry back off so the history does not silently grow one step for every
  // screen ever opened.
  var pushed = [];          // overlay ids we have pushed an entry for
  var popping = false;      // true while we are the ones closing it

  function openIds(){
    return [].slice.call(document.querySelectorAll('.modal-overlay.open'))
      .map(function(o){ return o.id; }).filter(Boolean);
  }

  function pushEntry(id){
    if(!id || pushed.indexOf(id) !== -1) return;
    pushed.push(id);
    try{
      history.pushState({ aaupDialog: id }, '');
    }catch(e){ pushed.pop(); }
  }

  function closeOverlay(id){
    var ov = document.getElementById(id);
    if(!ov) return;
    // Go through the dialog's own control wherever there is one, so whatever
    // it does on close — saving a draft, redrawing the plan — still happens.
    var own = ov.querySelector('.modal-close');
    if(own){ own.click(); } else { ov.classList.remove('open'); }
  }

  window.addEventListener('popstate', function(e){
    var st = e.state;
    // Not one of ours: let the browser do what it was going to do.
    if(!pushed.length) return;
    var id = pushed.pop();
    popping = true;
    closeOverlay(id);
    setTimeout(function(){ popping = false; }, 0);
    void st;
  });

  // When a dialog closes by its own button, drop the entry we pushed for it —
  // otherwise the student has to press back once per dialog they ever opened
  // before the browser will actually leave the page.
  function syncHistory(){
    var open = openIds();
    // Opened something new.
    open.forEach(function(id){
      if(SKIP.indexOf(id) === -1) pushEntry(id);
    });
    // Closed something without going through popstate.
    if(!popping){
      for(var i = pushed.length - 1; i >= 0; i--){
        if(open.indexOf(pushed[i]) === -1){
          pushed.splice(i, 1);
          try{ history.back(); }catch(e){}
          break;   // one per tick; the next mutation will catch the rest
        }
      }
    }
  }

  function watch(){
    document.querySelectorAll('.modal-overlay').forEach(function(ov){
      if(ov.classList.contains('open')) inject(ov);
    });
    var obs = new MutationObserver(function(muts){
      muts.forEach(function(m){
        var el = m.target;
        if(el.classList && el.classList.contains('modal-overlay')){
          if(el.classList.contains('open')){ inject(el); }
          syncHistory();
        }
      });
    });
    document.querySelectorAll('.modal-overlay').forEach(function(el){
      obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    // Dialogs built after load (the Plan Overview builds its overlay on
    // demand) are picked up here.
    new MutationObserver(function(muts){
      muts.forEach(function(m){
        Array.prototype.forEach.call(m.addedNodes, function(n){
          if(n.nodeType === 1 && n.classList && n.classList.contains('modal-overlay')){
            obs.observe(n, { attributes: true, attributeFilter: ['class'] });
            if(n.classList.contains('open')) inject(n);
          }
        });
      });
    }).observe(document.body, { childList: true });
  }

  if(document.readyState === 'complete'){ watch(); }
  else { window.addEventListener('load', watch); }
})();
