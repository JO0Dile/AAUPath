// ==========================
// KEYBOARD SHORTCUTS — for students on a laptop.
//
//   /        search (goes to Home first if you are elsewhere)
//   E        Edit Mode on My Plan, and out again
//   arrows   move between course cards (the focused card, or the first one)
//   Space    tick the focused card        } both already live in
//   Enter    open the focused card        } js/57-card-input.js
//   ?        list these
//
// Nothing fires while you are typing in a box, or with Ctrl/Cmd/Alt held, so
// browser shortcuts and the search field keep working as before. Arrow keys
// follow the screen, not the reading order: in Arabic, right is still right.
// ==========================
(function(){
  'use strict';

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }

  function typing(t){
    if(!t || !t.tagName) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }
  function anyOverlayOpen(){
    return !!document.querySelector('.modal-overlay.open:not(#impCourseModalOverlay), #kbHelp.open');
  }
  function visible(el){ return !!(el && el.getClientRects().length); }

  function planPage(){
    var host = document.getElementById('importedPlanView');
    if(!host || host.style.display === 'none') return null;
    return host.querySelector('.sheet-plan[id^="page-"]');
  }

  // ------------------------------------------------------------------ search
  function focusSearch(){
    var box = document.getElementById('hmSearch');
    if(visible(box)){ box.focus(); box.select(); return; }
    if(window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.show){
      window.AAUP_TASK_HOME.show();
      setTimeout(function(){
        var b = document.getElementById('hmSearch');
        if(b){ b.focus(); }
      }, 60);
    }
  }

  // --------------------------------------------------------------- edit mode
  function toggleEdit(){
    var page = planPage();
    if(!page || !window.AAUP_IMPORTED) return false;
    window.AAUP_IMPORTED.toggleEdit(page.id.replace(/^page-/, ''));
    return true;
  }

  // ------------------------------------------------------------------ arrows
  function cards(){
    var page = planPage();
    if(!page) return [];
    return Array.prototype.filter.call(page.querySelectorAll('.course[id]'), visible);
  }

  // Picks the nearest card in the pressed direction by where the cards are on
  // screen, so it works the same for the grid, the list view and Arabic.
  function nextCard(from, key){
    var all = cards();
    if(!all.length) return null;
    if(!from || all.indexOf(from) < 0) return all[0];
    var a = from.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    all.forEach(function(c){
      if(c === from) return;
      var r = c.getBoundingClientRect();
      var dx = r.left + r.width / 2 - ax, dy = r.top + r.height / 2 - ay;
      var main, side;
      if(key === 'ArrowRight'){ main = dx; side = dy; }
      else if(key === 'ArrowLeft'){ main = -dx; side = dy; }
      else if(key === 'ArrowDown'){ main = dy; side = dx; }
      else { main = -dy; side = dx; }
      if(main <= 4) return;
      // Staying in the same row or column matters more than raw distance.
      var score = main + Math.abs(side) * 3;
      if(score < bestScore){ bestScore = score; best = c; }
    });
    return best;
  }

  function move(key){
    var cur = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.course[id]') : null;
    var n = nextCard(cur, key);
    if(!n) return false;
    n.focus({ preventScroll: true });
    var r = n.getBoundingClientRect();
    if(r.top < 140 || r.bottom > window.innerHeight - 20){
      n.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    return true;
  }

  // -------------------------------------------------------------------- help
  var MOD = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl';
  var ROWS = [
    [MOD + ' K', 'Search and do anything', 'ابحث ونفّذ أي إشي'],
    ['/', 'Search', 'بحث'],
    ['E', 'Edit Mode on My Plan', 'وضع التعديل في خطتي'],
    ['← ↑ → ↓', 'Move between courses', 'تنقّل بين المواد'],
    ['Space', 'Tick the course', 'علّم المادة'],
    ['Enter', 'Open the course', 'افتح المادة'],
    ['Esc', 'Close', 'إغلاق'],
    // Edit Mode only (js/107-edit-power.js).
    [MOD + ' Z', 'Undo, in Edit Mode', 'تراجع، بوضع التعديل'],
    [MOD + ' C ' + MOD + ' V', 'Copy and paste a course, in Edit Mode', 'انسخ والصق مساق، بوضع التعديل'],
    [MOD + '-click', 'Select several courses, in Edit Mode', 'اختار كذا مساق، بوضع التعديل'],
    ['?', 'Show this list', 'اعرض هاي القائمة']
  ];

  var help = null;
  function openHelp(){
    if(!help){
      help = document.createElement('div');
      help.id = 'kbHelp';
      help.className = 'kb-help';
      help.setAttribute('role', 'dialog');
      help.setAttribute('aria-modal', 'true');
      help.addEventListener('click', function(e){ if(e.target === help || e.target.closest('[data-kb-close]')) closeHelp(); });
      document.body.appendChild(help);
    }
    help.setAttribute('aria-label', L('Keyboard shortcuts', 'اختصارات لوحة المفاتيح'));
    help.innerHTML = '<div class="kb-card">' +
      '<div class="kb-head"><h2>' + esc(L('Keyboard shortcuts', 'اختصارات لوحة المفاتيح')) + '</h2>' +
      '<button type="button" class="btn-quiet btn-sm" data-kb-close>' + esc(L('Close', 'إغلاق')) + '</button></div>' +
      '<dl class="kb-list">' + ROWS.map(function(r){
        return '<div><dt><kbd>' + r[0].split(' ').map(esc).join('</kbd> <kbd>') + '</kbd></dt><dd>' + esc(L(r[1], r[2])) + '</dd></div>';
      }).join('') + '</dl></div>';
    help.classList.add('open');
    var c = help.querySelector('[data-kb-close]');
    if(c) c.focus();
  }
  function closeHelp(){ if(help) help.classList.remove('open'); }

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && help && help.classList.contains('open')){ closeHelp(); return; }
    if(e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    var k = e.key;
    if(k === '?'){ e.preventDefault(); openHelp(); return; }
    if(anyOverlayOpen()) return;
    if(k === '/'){ e.preventDefault(); focusSearch(); return; }
    if(k === 'e' || k === 'E'){ if(toggleEdit()) e.preventDefault(); return; }
    if(k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowUp' || k === 'ArrowDown'){
      var onCard = document.activeElement && document.activeElement.closest && document.activeElement.closest('.course[id]');
      // Up/down still scroll the page until you've started moving by card.
      if(!onCard && (k === 'ArrowUp' || k === 'ArrowDown')) return;
      if(move(k)) e.preventDefault();
    }
  });

  window.AAUP_SHORTCUTS = { openHelp: openHelp };
})();
