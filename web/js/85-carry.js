// ==========================
// PICK UP, THEN PUT DOWN
//
// Moving a course from Year 3 to Year 1 meant dragging it there, and a drag
// needs the start and the finish on screen at the same time. The edit page
// is 3,421px tall on a 390px phone — four screens — so they never are. What
// that turns into is: drag to the edge, wait for the auto-scroll, lose the
// card, close a year to shorten the page, try again. Five drags for one
// move.
//
// So a tap now LIFTS a course instead. It stays where it is, dimmed, while
// a bar at the bottom says what you are holding. Every semester you scroll
// past shows a slot with the hours it would end up at. Tap one and the
// course lands there.
//
// The drag is untouched and still the right gesture for moving a card two
// slots down, or for anything at all on a wide screen — this is the same
// move by a different route, not a replacement. Both go through the same
// validateMove/applyMove in js/33-plan-editor.js, so neither can put a
// course somewhere the other would refuse.
// ==========================
(function(){
  'use strict';

  var carry = null;   // { prefix, slug, name }
  var barEl = null;

  var TX = {
    en: {
      holding: 'Holding', put: 'Put it here', cancel: 'Cancel',
      here: 'it is here now', blocked: 'blocked',
      moved: 'Moved — saved.', undo: 'Undo'
    },
    ar: {
      holding: 'بيدك', put: 'حطها هون', cancel: 'إلغاء',
      here: 'هي هون حاليًا', blocked: 'ممنوع',
      moved: 'تم النقل — انحفظ.', undo: 'تراجع'
    }
  };
  function t(){ return (window.AAUP_LANG && window.AAUP_LANG.isAr()) ? TX.ar : TX.en; }

  function ed(){ return window.AAUP_PLAN_EDITOR; }
  function page(prefix){ return document.getElementById('page-' + prefix); }

  function courseName(prefix, slug){
    var info = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[slug];
    if(!info) return slug;
    var ar = (window.AAUP_LANG && window.AAUP_LANG.isAr());
    return (ar && info.ar) || info.name || slug;
  }

  // The semester's own total, read off the number already printed in its
  // header (js/28-imported.js) rather than recomputed here — two figures for
  // one thing is two figures that can disagree.
  function rowHours(row){
    var block = row.closest('.imp-semester-block');
    var el = block && block.querySelector('.imp-sem-hours');
    if(!el) return null;
    var n = parseFloat(el.textContent);
    return isFinite(n) ? n : null;
  }
  function courseHours(prefix, slug){
    var info = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[slug];
    var n = info ? parseFloat(info.cr) : NaN;
    return isFinite(n) ? n : null;
  }

  // ---------- the slots ----------

  function clearSlots(prefix){
    var p = page(prefix);
    if(!p) return;
    p.querySelectorAll('.carry-slot').forEach(function(el){ el.remove(); });
    p.querySelectorAll('.carry-source').forEach(function(el){ el.classList.remove('carry-source'); });
    p.classList.remove('carrying');
  }

  function paintSlots(){
    if(!carry) return;
    var prefix = carry.prefix, slug = carry.slug;
    var p = page(prefix);
    if(!p) return;
    clearSlots(prefix);
    p.classList.add('carrying');

    var src = document.getElementById(prefix + '-c-' + slug);
    if(src) src.classList.add('carry-source');
    var fromRow = src && src.closest('.course-row[id]');

    var T = t();
    var moving = courseHours(prefix, slug);

    p.querySelectorAll('.course-row[id]').forEach(function(row){
      var slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'carry-slot';

      if(fromRow && row === fromRow){
        slot.className += ' carry-slot-here';
        slot.disabled = true;
        slot.textContent = T.here;
        row.appendChild(slot);
        return;
      }

      var check = ed().validateMove(prefix, slug, row.id);
      if(check && check.ok === false && check.hard){
        slot.className += ' carry-slot-no';
        slot.disabled = true;
        // The reason is a whole sentence naming a course. On a slot that is
        // one line wide it is the first clause that matters.
        var why = (window.AAUP_LANG && window.AAUP_LANG.isAr()) ? check.reason.ar : check.reason.en;
        slot.textContent = why;
        slot.title = why;
        row.appendChild(slot);
        return;
      }

      var now = rowHours(row);
      var label = T.put;
      if(now != null && moving != null){
        label += ' · ' + window.__hrs(now) + ' → ' + window.__hrs(now + moving);
      } else if(now != null){
        label += ' · ' + window.__hrs(now);
      }
      if(check && check.ok === false){ slot.className += ' carry-slot-ask'; }
      slot.textContent = label;
      slot.setAttribute('data-carry-to', row.id);
      row.appendChild(slot);
    });
  }

  // ---------- the bar ----------

  function ensureBar(){
    if(barEl && document.body.contains(barEl)) return barEl;
    barEl = document.createElement('div');
    barEl.className = 'carry-bar';
    barEl.setAttribute('role', 'status');
    document.body.appendChild(barEl);
    return barEl;
  }

  function paintBar(){
    var T = t();
    var el = ensureBar();
    el.innerHTML =
      '<span class="cb-lbl">' + window.__escapeHtml(T.holding) + '</span>' +
      '<span class="cb-name"></span>' +
      '<button type="button" class="cb-x" data-carry-cancel>' +
        window.AAUP_ICONS.preview('close', 14) + window.__escapeHtml(T.cancel) + '</button>';
    el.querySelector('.cb-name').textContent = carry.name;
    el.setAttribute('dir', (window.AAUP_LANG && window.AAUP_LANG.isAr()) ? 'rtl' : 'ltr');
    // force a reflow so the entry transition runs on a freshly-added node
    void el.offsetWidth;
    el.classList.add('open');
  }

  function removeBar(){
    if(!barEl) return;
    barEl.classList.remove('open');
    var el = barEl;
    setTimeout(function(){ if(el && !el.classList.contains('open')) el.remove(); }, 220);
    barEl = null;
  }

  // ---------- lift / drop / cancel ----------

  function lift(prefix, slug){
    if(carry && carry.prefix === prefix && carry.slug === slug){ cancel(); return; }
    if(carry) cancel();
    carry = { prefix: prefix, slug: slug, name: courseName(prefix, slug) };
    paintBar();
    paintSlots();
  }

  function cancel(){
    if(!carry) return;
    var prefix = carry.prefix;
    carry = null;
    clearSlots(prefix);
    removeBar();
  }

  function drop(containerId){
    if(!carry) return;
    var prefix = carry.prefix, slug = carry.slug;
    // Re-validate at the moment of the drop, not at the moment the slot was
    // painted: the plan can have been edited in between (a checkbox, another
    // move) and a stale "ok" would write a placement this app would refuse.
    var check = ed().validateMove(prefix, slug, containerId);
    if(check && check.ok === false && check.hard){
      if(window.__showToast){
        window.__showToast((window.AAUP_LANG && window.AAUP_LANG.isAr()) ? check.reason.ar : check.reason.en);
      }
      return;
    }
    cancel();
    ed().applyMove(prefix, slug, containerId);
  }

  // ---------- wiring ----------

  // Called by js/33-plan-editor.js when a press ended without ever crossing
  // the drag threshold — i.e. a tap, which edit mode had no use for before.
  function tapped(prefix, slug){
    if(carry) return;                 // holding something: slots do the work
    lift(prefix, slug);
  }

  document.addEventListener('click', function(e){
    var slot = e.target.closest('[data-carry-to]');
    if(slot){ e.preventDefault(); drop(slot.getAttribute('data-carry-to')); return; }
    if(e.target.closest('[data-carry-cancel]')){ e.preventDefault(); cancel(); }
  });

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && carry){ cancel(); }
  });

  // An imported plan rebuilds its whole DOM on almost every interaction, so
  // the slots and the dimmed source card are wiped by anything that
  // re-renders. render() calls this straight after bindDraggable.
  function repaint(prefix){
    if(!carry || carry.prefix !== prefix) return;
    if(!document.getElementById(prefix + '-c-' + carry.slug)){ cancel(); return; }
    var p = page(prefix);
    if(!p || !p.classList.contains('editing')){ cancel(); return; }
    paintSlots();
  }

  window.AAUP_CARRY = {
    tapped: tapped, lift: lift, cancel: cancel, repaint: repaint,
    isCarrying: function(){ return !!carry; }
  };
})();
