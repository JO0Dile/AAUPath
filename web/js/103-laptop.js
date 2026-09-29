// ==========================
// LAPTOP: HOVER PREVIEW + RIGHT-CLICK MENU on course cards (ideas 27, 28).
//
// Hover preview: resting the mouse on a card for a moment shows a small box
// with what the course needs (ticked when passed), what it opens, its hours
// and its status, without opening it. Only where there is a real mouse
// (hover + fine pointer); a finger never sees it.
//
// On a phone, holding a card for half a second opens the same menu as a
// sheet along the bottom (round 7).
//
// Right-click: the common actions without opening the course: passed /
// in progress / planned / not started, open, pin to Home, move to another
// semester. Status changes go through the same calls the course window's
// status buttons make (window.__toggleCourse for passed, the status map for
// the rest), so there is one way to change a course, not two.
// ==========================
(function(){
  'use strict';

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }
  function hasMouse(){ return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches); }

  // The card under the pointer, if it is a course on a plan page that is not
  // in Edit Mode. Returns { el, planId, slug }.
  function cardAt(target){
    var el = target && target.closest && target.closest('.course[id]');
    if(!el) return null;
    var page = el.closest('.sheet-plan[id^="page-"]');
    if(!page || page.classList.contains('editing')) return null;
    var planId = page.id.slice(5);
    var head = planId + '-c-';
    if(el.id.indexOf(head) !== 0) return null;
    return { el: el, planId: planId, slug: el.id.slice(head.length) };
  }
  function plan(planId){
    var all = window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans ? window.AAUP_IMPORTED.loadImportedPlans() : {};
    return all[planId] || null;
  }
  function courseOf(planId, slug){
    var p = plan(planId);
    return p ? (p.courses || []).filter(function(c){ return c.id === slug; })[0] || null : null;
  }
  function nameOf(planId, slug){
    var c = courseOf(planId, slug);
    return c ? (ar() && c.ar ? c.ar : c.name) : slug;
  }
  function pidOf(planId, slug){
    return window.AAUP_GPA && window.AAUP_GPA.primaryId ? window.AAUP_GPA.primaryId(planId, slug) : planId + '-c-' + slug;
  }
  function isDone(planId, slug){
    var prog = window.__getProgress ? window.__getProgress() : {};
    return !!prog[pidOf(planId, slug)];
  }
  function statusOf(planId, slug){
    if(isDone(planId, slug)) return 'done';
    var st = window.AAUP_GPA && window.AAUP_GPA.loadStatuses ? window.AAUP_GPA.loadStatuses() : {};
    return st[pidOf(planId, slug)] || '';
  }
  var STATUS_TX = {
    done: ['Passed', 'منجز'], in_progress: ['In progress', 'قيد الإنجاز'],
    planned: ['Planned', 'مخطط'], '': ['Not started', 'لم يبدأ']
  };

  // ---- hover preview ---------------------------------------------------------
  var tip = null, tipTimer = null, tipFor = null;
  function tipEl(){
    if(tip) return tip;
    tip = document.createElement('div');
    tip.className = 'crs-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }
  function hideTip(){ clearTimeout(tipTimer); tipFor = null; if(tip) tip.hidden = true; }
  function showTip(hit){
    var data = (window.__PLAN_DATA || {})[hit.planId] || {};
    var needs = (data.needsMap && data.needsMap[hit.slug]) || [];
    var opens = (data.unlocksMap && data.unlocksMap[hit.slug]) || [];
    var c = courseOf(hit.planId, hit.slug);
    var list = function(slugs, tickDone){
      if(!slugs.length) return esc(L('nothing', 'ولا إشي'));
      return slugs.slice(0, 4).map(function(s){
        return esc(nameOf(hit.planId, s)) + (tickDone ? (isDone(hit.planId, s) ? ' ✓' : ' ✗') : '');
      }).join(', ') + (slugs.length > 4 ? esc(L(' and ' + (slugs.length - 4) + ' more', ' و' + (slugs.length - 4) + ' كمان')) : '');
    };
    var st = STATUS_TX[statusOf(hit.planId, hit.slug)] || STATUS_TX[''];
    var t = tipEl();
    t.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    t.innerHTML = '<b>' + esc(nameOf(hit.planId, hit.slug)) + '</b>' +
      '<span>' + esc(L('Needs: ', 'بيحتاج: ')) + list(needs, true) + '</span>' +
      '<span>' + esc(L('Opens: ', 'بيفتح: ')) + list(opens, false) + '</span>' +
      '<span class="crs-tip-meta">' + esc((c ? (parseFloat(c.creditHours) || 0) : 0) + 'H · ' + st[ar() ? 1 : 0]) + '</span>';
    t.hidden = false;
    var r = hit.el.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
    var top = r.bottom + 8;
    if(top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8);
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  document.addEventListener('mouseover', function(e){
    if(!hasMouse() || menu && !menu.hidden) return;
    var hit = cardAt(e.target);
    if(!hit){ return; }
    if(tipFor === hit.el.id) return;
    hideTip();
    tipFor = hit.el.id;
    tipTimer = setTimeout(function(){ if(tipFor === hit.el.id) showTip(hit); }, 450);
  });
  document.addEventListener('mouseout', function(e){
    if(!tipFor) return;
    var from = e.target.closest && e.target.closest('.course[id]');
    var to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.course[id]') : null;
    if(from && from !== to) hideTip();
  });
  ['scroll', 'mousedown', 'keydown', 'wheel'].forEach(function(ev){ window.addEventListener(ev, hideTip, true); });

  // ---- right-click menu -------------------------------------------------------
  var menu = null, menuFor = null;
  function menuEl(){
    if(menu) return menu;
    menu = document.createElement('div');
    menu.className = 'crs-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    document.body.appendChild(menu);
    menu.addEventListener('click', onMenuClick);
    return menu;
  }
  function closeMenu(){ if(menu) menu.hidden = true; menuFor = null; }
  function item(attr, label, on){
    return '<button type="button" role="menuitem" ' + attr + (on ? ' class="is-on" aria-checked="true"' : '') + '>' +
      (on ? '<span class="crs-dot" aria-hidden="true"></span>' : '<span class="crs-dot-off" aria-hidden="true"></span>') + esc(label) + '</button>';
  }
  function semesters(planId){
    var p = plan(planId), out = [];
    ((p && p.structure && p.structure.years) || []).forEach(function(y, i){
      ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).forEach(function(s){
        var semTx = { s1: L('first semester', 'الفصل الأول'), s2: L('second semester', 'الفصل الثاني'), s3: L('summer', 'الصيفي') }[s];
        out.push({ y: y.id, s: s, label: L('Year ', 'السنة ') + (i + 1) + ' · ' + semTx,
                   container: planId + '-y' + String(y.id).replace(/^y/, '') + '-s' + s.replace(/^s/, '') });
      });
    });
    return out;
  }
  function renderMenu(moveOpen){
    var h = menuFor, st = statusOf(h.planId, h.slug), c = courseOf(h.planId, h.slug);
    var pinned = window.AAUP_PINS && window.AAUP_PINS.has(h.planId, h.slug);
    var html = '<div class="crs-menu-h">' + esc(nameOf(h.planId, h.slug)) + '</div>' +
      item('data-cm-status="done"', L('Passed', 'منجز'), st === 'done') +
      item('data-cm-status="in_progress"', L('In progress', 'قيد الإنجاز'), st === 'in_progress') +
      item('data-cm-status="planned"', L('Planned', 'مخطط'), st === 'planned') +
      item('data-cm-status=""', L('Not started', 'لم يبدأ'), st === '') +
      '<div class="crs-menu-sep"></div>' +
      '<button type="button" role="menuitem" data-cm-open>' + esc(L('Open course', 'افتح المساق')) + '</button>' +
      (window.AAUP_PINS ? '<button type="button" role="menuitem" data-cm-pin>' + esc(pinned ? L('Unpin from Home', 'شيله من الرئيسية') : L('Pin to Home', 'ثبّته بالرئيسية')) + '</button>' : '') +
      (c && c.yearId ? '<button type="button" role="menuitem" data-cm-move aria-expanded="' + !!moveOpen + '">' + esc(L('Move to…', 'انقله لـ…')) + '</button>' : '');
    if(moveOpen && c){
      html += '<div class="crs-menu-sub">' + semesters(h.planId).map(function(sm){
        var here = sm.y === c.yearId && sm.s === c.semester;
        return '<button type="button" role="menuitem" data-cm-to="' + esc(sm.container) + '"' + (here ? ' disabled' : '') + '>' + esc(sm.label) + '</button>';
      }).join('') + '</div>';
    }
    menu.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    menu.innerHTML = html;
  }
  function placeMenu(x, y){
    menu.hidden = false;
    // On a phone the menu is a sheet along the bottom (round 7, long-press),
    // where the thumb already is; CSS places it.
    if(menu.classList.contains('is-sheet')){ menu.style.left = menu.style.top = ''; return; }
    var w = menu.offsetWidth, hgt = menu.offsetHeight;
    menu.style.left = Math.min(Math.max(8, x), window.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(Math.max(8, y), window.innerHeight - hgt - 8) + 'px';
  }
  function setStatus(h, val){
    var pid = pidOf(h.planId, h.slug), done = isDone(h.planId, h.slug);
    var el = document.getElementById(pid) || h.el;
    if(val === 'done'){
      if(!done && window.__toggleCourse) window.__toggleCourse(el);
      return;
    }
    var st = window.AAUP_GPA.loadStatuses();
    if(val) st[pid] = val; else delete st[pid];
    window.AAUP_GPA.saveStatuses(st);
    if(done && window.__toggleCourse) window.__toggleCourse(el);
    else if(window.AAUP_IMPORTED && window.AAUP_IMPORTED.refresh) window.AAUP_IMPORTED.refresh(h.planId);
  }
  function onMenuClick(e){
    var b = e.target.closest('button');
    if(!b || !menuFor) return;
    var h = menuFor;
    if(b.hasAttribute('data-cm-status')){ closeMenu(); setStatus(h, b.getAttribute('data-cm-status')); return; }
    if(b.hasAttribute('data-cm-open')){ closeMenu(); window.AAUP_IMPORTED.openCourseModal(h.planId, h.slug); return; }
    if(b.hasAttribute('data-cm-pin')){
      var on = !window.AAUP_PINS.has(h.planId, h.slug);
      window.AAUP_PINS.set(h.planId, h.slug, on);
      closeMenu();
      if(window.__showToast) window.__showToast(on ? L('Pinned to Home', 'انثبّت بالرئيسية') : L('Unpinned', 'انشال من الرئيسية'));
      return;
    }
    if(b.hasAttribute('data-cm-move')){
      var r = menu.getBoundingClientRect();
      renderMenu(b.getAttribute('aria-expanded') !== 'true');
      placeMenu(r.left, r.top);
      return;
    }
    if(b.hasAttribute('data-cm-to')){
      closeMenu();
      window.AAUP_IMPORTED.persistCourseMove(h.planId, h.slug, b.getAttribute('data-cm-to'));
      if(window.__showToast) window.__showToast(L('Moved', 'انتقل'));
    }
  }
  function openMenu(hit, x, y, asSheet){
    hideTip();
    menuEl();
    menuFor = hit;
    menu.classList.toggle('is-sheet', !!asSheet);
    renderMenu(false);
    placeMenu(x, y);
    var first = menu.querySelector('button');
    if(first && !asSheet) first.focus({ preventScroll: true });
  }
  document.addEventListener('contextmenu', function(e){
    if(!hasMouse()) return;
    var hit = cardAt(e.target);
    if(!hit) return;
    e.preventDefault();
    openMenu(hit, e.clientX, e.clientY, false);
  });

  // ---- long-press on a phone (round 7, ideas 12 and 13) ------------------------
  // Holding a course for half a second opens the same menu, as a sheet:
  // status, open, pin, and Move to… for the semester list. Moving the finger
  // (a scroll, or the swipe that ticks a card) cancels it, and the tap that
  // ends a long-press doesn't also open the course.
  var press = null, swallowClick = false, lastTouch = 0;
  document.addEventListener('touchstart', function(e){
    lastTouch = Date.now();
    // A new touch means the click that may follow a long-press never came.
    if(!(menu && !menu.hidden)) swallowClick = false;
    if(e.touches.length !== 1) { press = null; return; }
    var hit = cardAt(e.target);
    if(!hit) return;
    var t = e.touches[0];
    press = { hit: hit, x: t.clientX, y: t.clientY, timer: setTimeout(function(){
      if(!press) return;
      swallowClick = true;
      if(navigator.vibrate){ try{ navigator.vibrate(12); }catch(err){} }
      openMenu(press.hit, 0, 0, true);
      press = null;
    }, 480) };
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', function(e){
    if(!press) return;
    var t = e.touches[0];
    if(Math.abs(t.clientX - press.x) > 10 || Math.abs(t.clientY - press.y) > 10){ clearTimeout(press.timer); press = null; }
  }, { passive: true, capture: true });
  ['touchend', 'touchcancel'].forEach(function(ev){
    document.addEventListener(ev, function(){ lastTouch = Date.now(); if(press){ clearTimeout(press.timer); press = null; } }, { passive: true, capture: true });
  });
  document.addEventListener('click', function(e){
    if(!swallowClick) return;
    swallowClick = false;
    if(menu && menu.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('touchstart', function(e){ if(menu && !menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  // The pretend mouse events a phone fires after a touch don't close it; a
  // real outside tap does, through touchstart above.
  document.addEventListener('mousedown', function(e){
    if(Date.now() - lastTouch < 800) return;
    if(menu && !menu.hidden && !menu.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', function(e){
    if(!menu || menu.hidden) return;
    if(e.key === 'Escape'){ closeMenu(); return; }
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      var items = Array.prototype.filter.call(menu.querySelectorAll('button'), function(x){ return !x.disabled; });
      var i = items.indexOf(document.activeElement);
      var n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      if(items[n]) items[n].focus();
      e.preventDefault();
    }
  });
  // Scrolling the page closes the menu; scrolling inside it (the semester
  // list in the sheet) doesn't.
  window.addEventListener('scroll', function(e){ if(!(menu && e.target && e.target.nodeType === 1 && menu.contains(e.target))) closeMenu(); }, true);
})();
