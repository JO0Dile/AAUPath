// ==========================
// EDIT MODE ON A LAPTOP (round 8, batch B).
//
//   7  Ctrl-click (⌘-click) courses to select several, Shift-click for a run
//      of them. A bar offers Move to…, Mark passed, Copy and Remove, once.
//   8  Browse Courses opens as a panel beside the plan; drag a course from it
//      onto any semester and it lands there.
//   9  Double-click a course's name (or its hours) to change it in place.
//      Ctrl+C copies the selected course(s), or the one under the mouse;
//      Ctrl+V pastes them into the semester under the mouse, and a single
//      pasted course opens straight into renaming.
//  10  Ctrl+Z undoes the last change to the plan, again and again;
//      Ctrl+Shift+Z (or Ctrl+Y) puts it back.
//  12  Right-click a semester's title: add a course here, paste here, select
//      all, mark all passed, reset to the official plan.
//  13  Drop a saved backup file anywhere on the window to restore it.
//
// Undo works on the plan itself (aaup_importedPlans): every write made while
// a plan is in Edit Mode keeps the plan as it was before, one step per user
// action (writes in the same moment are one step). Ticks and grades live
// elsewhere and have their own Undo toasts.
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_importedPlans';
  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }
  // Course names are stored already made safe for HTML ("&amp;"), so they
  // are turned back into plain text before being shown or edited, and made
  // safe again (window.__cleanText) before being stored.
  var decoder = document.createElement('textarea');
  function plain(s){ decoder.innerHTML = String(s == null ? '' : s); return decoder.value; }
  function clean(s){ return window.__cleanText ? window.__cleanText(s) : esc(s); }
  function toast(m){ if(window.__showToast) window.__showToast(m); }
  function imp(){ return window.AAUP_IMPORTED; }
  function plans(){ return imp() ? imp().loadImportedPlans() : {}; }
  function refresh(id){ if(imp() && imp().refresh) imp().refresh(id); }
  function typing(t){
    if(!t || !t.tagName) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  }
  function editingPage(){ return document.querySelector('.sheet-plan.editing[id^="page-"]'); }
  function editingId(){ var p = editingPage(); return p ? p.id.slice(5) : null; }
  function slugOf(el, planId){
    var head = planId + '-c-';
    return el && el.id && el.id.indexOf(head) === 0 ? el.id.slice(head.length) : null;
  }
  function courseOf(p, slug){ return p ? (p.courses || []).filter(function(c){ return c.id === slug; })[0] || null : null; }
  function parseContainer(id){
    var m = /^(.*)-y(\d+)-s(\d)$/.exec(id || '');
    return m ? { planId: m[1], yearId: 'y' + m[2], semester: 's' + m[3] } : null;
  }
  function pid(planId, slug){ return window.AAUP_GPA && window.AAUP_GPA.primaryId ? window.AAUP_GPA.primaryId(planId, slug) : planId + '-c-' + slug; }
  function uniqueId(p, base){
    var have = {};
    (p.courses || []).forEach(function(c){ have[c.id] = 1; });
    var id = base, n = 2;
    while(have[id]){ id = base + '-' + n; n++; }
    return id;
  }
  function semesters(planId){
    var p = plans()[planId], out = [];
    ((p && p.structure && p.structure.years) || []).forEach(function(y, i){
      ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).forEach(function(s){
        var semTx = { s1: L('First semester', 'الفصل الأول'), s2: L('Second semester', 'الفصل الثاني'), s3: L('Summer', 'الصيفي') }[s];
        out.push({ yearId: y.id, semester: s, label: L('Year ', 'السنة ') + (i + 1) + ' · ' + semTx });
      });
    });
    return out;
  }

  // ---- 10 · undo / redo ---------------------------------------------------------
  var undoStack = [], redoStack = [], grouped = false, restoring = false;
  function raw(){ try{ return localStorage.getItem(KEY); }catch(e){ return null; } }
  function hookStorage(){
    var st = window.AAUP_STORAGE;
    if(!st || st.__epHooked) return;
    var orig = st.setJSON;
    st.setJSON = function(key){
      if(key === KEY && !restoring && !grouped){
        var id = editingId();
        if(id){
          undoStack.push({ raw: raw(), planId: id });
          if(undoStack.length > 80) undoStack.shift();
          redoStack.length = 0;
          grouped = true;
          setTimeout(function(){ grouped = false; }, 0);
        }
      }
      return orig.apply(this, arguments);
    };
    st.__epHooked = true;
  }
  hookStorage();
  function writeRaw(r){
    restoring = true;
    try{ window.AAUP_STORAGE.setJSON(KEY, r ? JSON.parse(r) : {}); }catch(e){}
    restoring = false;
    if(imp() && imp().plansChanged) imp().plansChanged();
  }
  function step(from, to, emptyMsg, doneMsg){
    if(!from.length){ toast(emptyMsg); return; }
    var e = from.pop();
    to.push({ raw: raw(), planId: e.planId });
    writeRaw(e.raw);
    clearPicked();
    refresh(e.planId);
    toast(doneMsg);
  }
  function undo(){ step(undoStack, redoStack, L('Nothing to undo', 'ما في إشي تتراجع عنه'), L('Undone · Ctrl+Shift+Z to redo', 'رجعت خطوة · Ctrl+Shift+Z لترجّعها')); }
  function redo(){ step(redoStack, undoStack, L('Nothing to redo', 'ما في إشي ترجّعه'), L('Redone', 'رجّعتها')); }

  // ---- one save per action ------------------------------------------------------
  function change(planId, fn){
    var all = plans(), p = all[planId];
    if(!p) return false;
    if(fn(p) === false) return false;
    p.wasEdited = true;
    imp().saveImportedPlans(all);
    refresh(planId);
    return true;
  }

  // ---- 7 · select several -------------------------------------------------------
  var picked = [], pickedPlan = null, lastPicked = null;
  function paintPicked(){
    var page = editingPage();
    document.querySelectorAll('.course.ep-picked').forEach(function(el){ el.classList.remove('ep-picked'); });
    if(!page || editingId() !== pickedPlan){ if(picked.length){ picked = []; } paintBar(); return; }
    picked = picked.filter(function(s){ return document.getElementById(pickedPlan + '-c-' + s); });
    picked.forEach(function(s){ var el = document.getElementById(pickedPlan + '-c-' + s); if(el) el.classList.add('ep-picked'); });
    paintBar();
  }
  function clearPicked(){ picked = []; lastPicked = null; paintPicked(); }
  function togglePick(planId, slug){
    if(pickedPlan !== planId){ picked = []; pickedPlan = planId; }
    var i = picked.indexOf(slug);
    if(i === -1) picked.push(slug); else picked.splice(i, 1);
    lastPicked = slug;
    paintPicked();
  }
  function pickRange(planId, slug){
    var page = editingPage();
    if(!page || !lastPicked || pickedPlan !== planId){ togglePick(planId, slug); return; }
    var cards = [].slice.call(page.querySelectorAll('.course[id]')).map(function(el){ return slugOf(el, planId); }).filter(Boolean);
    var a = cards.indexOf(lastPicked), b = cards.indexOf(slug);
    if(a === -1 || b === -1){ togglePick(planId, slug); return; }
    cards.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function(s){ if(picked.indexOf(s) === -1) picked.push(s); });
    paintPicked();
  }

  var bar = null, barMove = false;
  function paintBar(){
    if(!picked.length){ if(bar){ bar.remove(); bar = null; } barMove = false; return; }
    if(!bar){
      bar = document.createElement('div');
      bar.className = 'ep-bar';
      bar.setAttribute('role', 'toolbar');
      document.body.appendChild(bar);
      bar.addEventListener('click', onBarClick);
    }
    bar.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    bar.setAttribute('aria-label', L('Selected courses', 'المساقات المختارة'));
    var n = picked.length;
    bar.innerHTML =
      '<b class="ep-bar-n">' + esc(L(n + ' selected', n + ' مختارة')) + '</b>' +
      '<button type="button" class="ep-btn ep-pri" data-ep="move" aria-expanded="' + barMove + '">' + esc(L('Move to…', 'انقلها لـ…')) + '</button>' +
      '<button type="button" class="ep-btn" data-ep="pass">' + esc(L('Mark passed', 'نجحت فيها')) + '</button>' +
      '<button type="button" class="ep-btn" data-ep="copy" title="Ctrl+C">' + esc(L('Copy', 'انسخ')) + '</button>' +
      '<button type="button" class="ep-btn ep-bad" data-ep="remove">' + esc(L('Remove', 'شيلها')) + '</button>' +
      '<button type="button" class="ep-x" data-ep="clear" aria-label="' + esc(L('Clear selection', 'ألغِ الاختيار')) + '" title="Esc">×</button>' +
      (barMove ? '<div class="ep-bar-sub">' + semesters(pickedPlan).map(function(s){
        return '<button type="button" class="ep-btn" data-ep-to="' + esc(s.yearId + '|' + s.semester) + '">' + esc(s.label) + '</button>';
      }).join('') + '</div>' : '');
  }
  function onBarClick(e){
    var b = e.target.closest('button');
    if(!b) return;
    var act = b.getAttribute('data-ep'), to = b.getAttribute('data-ep-to');
    var planId = pickedPlan, list = picked.slice();
    if(act === 'clear'){ clearPicked(); return; }
    if(act === 'move'){ barMove = !barMove; paintBar(); return; }
    if(to){
      var t = to.split('|');
      change(planId, function(p){
        list.forEach(function(s){
          var c = courseOf(p, s);
          if(!c) return;
          c.yearId = t[0]; c.semester = t[1];
          if(c.category === 'dept') c.placedByStudent = true;
        });
      });
      barMove = false;
      clearPicked();
      toast(L('Moved ' + list.length + (list.length === 1 ? ' course' : ' courses') + ' · Ctrl+Z to undo', 'انتقلوا ' + list.length + ' · Ctrl+Z للتراجع'));
      return;
    }
    if(act === 'pass'){ markPassed(planId, list); clearPicked(); return; }
    if(act === 'copy'){ copy(planId, list); return; }
    if(act === 'remove'){ removeMany(planId, list); clearPicked(); }
  }
  function markPassed(planId, list){
    var prog = window.__getProgress ? window.__getProgress() : null;
    if(!prog) return;
    var before = {};
    list.forEach(function(s){ var k = pid(planId, s); before[k] = prog[k]; prog[k] = true; });
    if(window.__saveProgress) window.__saveProgress();
    refresh(planId);
    var undoIt = function(){
      var pr = window.__getProgress();
      Object.keys(before).forEach(function(k){ if(before[k]) pr[k] = before[k]; else delete pr[k]; });
      if(window.__saveProgress) window.__saveProgress();
      refresh(planId);
    };
    var msg = L(list.length + ' marked passed', list.length + ' صاروا ناجحين');
    if(window.__showActionToast) window.__showActionToast(msg, L('Undo', 'تراجع'), undoIt); else toast(msg);
  }
  function removeMany(planId, list){
    var before = raw();
    var gone = {};
    list.forEach(function(s){ gone[s] = 1; });
    change(planId, function(p){
      p.courses = (p.courses || []).filter(function(c){ return !gone[c.id]; });
      p.prerequisites = (p.prerequisites || []).filter(function(pr){ return !gone[pr[0]] && !gone[pr[1]]; });
    });
    var undoIt = function(){ writeRaw(before); refresh(planId); };
    var msg = L('Removed ' + list.length + (list.length === 1 ? ' course' : ' courses'), 'انشالوا ' + list.length);
    if(window.__showActionToast) window.__showActionToast(msg, L('Undo', 'تراجع'), undoIt); else toast(msg);
  }

  // ---- 9 · copy and paste -------------------------------------------------------
  var clip = null, hoverCourse = null, hoverRow = null;
  document.addEventListener('mouseover', function(e){
    if(!editingPage()) return;
    var c = e.target.closest && e.target.closest('.course[id]');
    hoverCourse = c || null;
    var block = e.target.closest && e.target.closest('.imp-semester-block');
    var row = block ? block.querySelector('.course-row[id]') : null;
    if(row) hoverRow = row.id;
  });
  function copy(planId, list){
    var p = plans()[planId];
    var cs = list.map(function(s){ return courseOf(p, s); }).filter(Boolean);
    if(!cs.length) return;
    clip = { planId: planId, courses: JSON.parse(JSON.stringify(cs)) };
    // Also as text, for pasting into a note or a sheet; a browser that says
    // no to the clipboard doesn't stop the in-app copy.
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(cs.map(function(c){ return plain(c.name) + '\t' + (c.creditHours || 0); }).join('\n')).catch(function(){});
      }
    }catch(e){}
    toast(L((cs.length === 1 ? 'Copied "' + plain(cs[0].name) + '"' : 'Copied ' + cs.length + ' courses') + ' · Ctrl+V to paste',
            (cs.length === 1 ? 'انتسخ «' + plain(cs[0].ar || cs[0].name) + '»' : 'انتسخوا ' + cs.length) + ' · Ctrl+V للصق'));
  }
  function paste(planId, yearId, semester){
    if(!clip || !clip.courses.length) return;
    var newIds = [];
    change(planId, function(p){
      clip.courses.forEach(function(src){
        var c = JSON.parse(JSON.stringify(src));
        c.id = uniqueId(p, String(src.id).replace(/-copy(-\d+)?$/, '') + '-copy');
        c.name = src.name + ' (copy)';
        if(src.ar) c.ar = src.ar + ' (نسخة)';
        c.yearId = yearId; c.semester = semester;
        delete c.official; delete c.courseNumber; delete c.num;
        if(c.category === 'dept') c.placedByStudent = true;
        p.courses.push(c);
        newIds.push(c.id);
      });
    });
    if(newIds.length === 1){ setTimeout(function(){ startRename(planId, newIds[0]); }, 60); }
    else toast(L('Pasted ' + newIds.length + ' courses', 'انلصقوا ' + newIds.length));
  }
  function pasteTarget(planId){
    var t = hoverRow && parseContainer(hoverRow);
    if(t && t.planId === planId) return t;
    var c = clip && clip.courses[0];
    return c && c.yearId ? { planId: planId, yearId: c.yearId, semester: c.semester } : null;
  }

  // ---- 9 · rename and hours in place -------------------------------------------
  function startRename(planId, slug){
    var el = document.getElementById(planId + '-c-' + slug);
    var nameEl = el && el.querySelector('.name');
    if(!nameEl) return;
    if(window.AAUP_CARRY && window.AAUP_CARRY.cancel) window.AAUP_CARRY.cancel();
    var p = plans()[planId], c = courseOf(p, slug);
    if(!c) return;
    var useAr = ar() && !!c.ar;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'ep-inline';
    input.value = plain(useAr ? c.ar : c.name);
    input.setAttribute('aria-label', L('Course name', 'اسم المساق'));
    nameEl.textContent = '';
    nameEl.appendChild(input);
    inlineEdit(input, function(v){
      v = v.trim().slice(0, 120);
      if(!v || v === plain(useAr ? c.ar : c.name)) return false;
      v = clean(v);
      return change(planId, function(pp){ var cc = courseOf(pp, slug); if(!cc) return false; if(useAr) cc.ar = v; else cc.name = v; });
    }, planId);
  }
  function startHours(planId, slug){
    var el = document.getElementById(planId + '-c-' + slug);
    var meta = el && el.querySelector('.course-meta');
    var c = courseOf(plans()[planId], slug);
    if(!meta || !c) return;
    if(window.AAUP_CARRY && window.AAUP_CARRY.cancel) window.AAUP_CARRY.cancel();
    var input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '12'; input.step = '1';
    input.className = 'ep-inline ep-inline-num';
    input.value = String(parseFloat(c.creditHours) || 0);
    input.setAttribute('aria-label', L('Credit hours', 'الساعات'));
    meta.textContent = '';
    meta.appendChild(input);
    meta.appendChild(document.createTextNode(L(' hours', ' ساعات')));
    inlineEdit(input, function(v){
      var n = Math.max(0, Math.min(12, parseFloat(v)));
      if(isNaN(n) || n === (parseFloat(c.creditHours) || 0)) return false;
      return change(planId, function(pp){ var cc = courseOf(pp, slug); if(!cc) return false; cc.creditHours = n; });
    }, planId);
  }
  function inlineEdit(input, save, planId){
    var done = false;
    var finish = function(ok){
      if(done) return;
      done = true;
      if(!(ok && save(input.value))) refresh(planId);
    };
    // Keep the drag/carry gestures off the box while it is being typed in.
    ['pointerdown', 'mousedown', 'click', 'dblclick'].forEach(function(ev){ input.addEventListener(ev, function(e){ e.stopPropagation(); }); });
    input.addEventListener('keydown', function(e){
      e.stopPropagation();
      if(e.key === 'Enter'){ e.preventDefault(); finish(true); }
      else if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function(){ finish(true); });
    input.focus();
    input.select();
  }
  // A double press is caught here rather than with dblclick: the first press
  // lifts the course (js/85-carry.js) and the bar that shows up for it can
  // sit over the card, so the second press is matched to the card and the
  // spot the FIRST one hit, not to whatever is under it now.
  var lastPress = null;
  document.addEventListener('pointerdown', function(e){
    if(e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.pointerType === 'touch') return;
    var planId = editingId();
    if(!planId){ lastPress = null; return; }
    var now = Date.now();
    if(lastPress && lastPress.planId === planId && now - lastPress.t < 450 &&
       Math.abs(e.clientX - lastPress.x) < 8 && Math.abs(e.clientY - lastPress.y) < 8){
      var lp = lastPress;
      lastPress = null;
      e.preventDefault(); e.stopPropagation();
      if(window.AAUP_CARRY && window.AAUP_CARRY.cancel) window.AAUP_CARRY.cancel();
      setTimeout(function(){ if(lp.meta) startHours(planId, lp.slug); else startRename(planId, lp.slug); }, 0);
      return;
    }
    var card = e.target.closest && e.target.closest('.course[id]');
    var slug = slugOf(card, planId);
    lastPress = slug && !e.target.closest('.imp-card-btn-row, input')
      ? { planId: planId, slug: slug, meta: !!e.target.closest('.course-meta'), t: now, x: e.clientX, y: e.clientY }
      : null;
  }, true);

  // Ctrl/⌘/Shift-click picks instead of starting a drag or a carry. Capture,
  // so js/33-plan-editor.js's pointerdown never sees it.
  document.addEventListener('pointerdown', function(e){
    if(!(e.ctrlKey || e.metaKey || e.shiftKey) || e.button !== 0) return;
    var planId = editingId();
    if(!planId) return;
    var card = e.target.closest && e.target.closest('.course[id]');
    var slug = slugOf(card, planId);
    if(!slug || e.target.closest('.imp-card-btn-row')) return;
    e.preventDefault(); e.stopPropagation();
    if(e.shiftKey) pickRange(planId, slug); else togglePick(planId, slug);
  }, true);

  // ---- keys: undo, redo, copy, paste, select all, Escape ------------------------
  document.addEventListener('keydown', function(e){
    var planId = editingId();
    if(!planId || typing(e.target)) return;
    var mod = e.ctrlKey || e.metaKey;
    var k = (e.key || '').toLowerCase();
    if(e.key === 'Escape' && picked.length){ clearPicked(); return; }
    if(!mod || e.altKey) return;
    if(k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); return; }
    if((k === 'z' && e.shiftKey) || k === 'y'){ e.preventDefault(); redo(); return; }
    if(k === 'c'){
      if(String(window.getSelection ? window.getSelection() : '').trim()) return;
      var list = picked.length && pickedPlan === planId ? picked.slice() : [];
      if(!list.length){ var s = slugOf(hoverCourse, planId); if(s) list = [s]; }
      if(list.length){ e.preventDefault(); copy(planId, list); }
      return;
    }
    if(k === 'v' && clip){
      var t = pasteTarget(planId);
      if(t){ e.preventDefault(); paste(planId, t.yearId, t.semester); }
    }
  });

  // ---- 12 · right-click a semester title ---------------------------------------
  var semMenu = null;
  function closeSemMenu(){ if(semMenu){ semMenu.remove(); semMenu = null; } }
  document.addEventListener('contextmenu', function(e){
    var planId = editingId();
    if(!planId) return;
    var title = e.target.closest && e.target.closest('.imp-semester-title');
    if(!title) return;
    var block = title.closest('.imp-semester-block');
    var row = block && block.querySelector('.course-row[id]');
    var where = row && parseContainer(row.id);
    if(!where) return;
    e.preventDefault();
    closeSemMenu();
    var p = plans()[planId];
    semMenu = document.createElement('div');
    semMenu.className = 'crs-menu ep-sem-menu';
    semMenu.setAttribute('role', 'menu');
    semMenu.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    var b = function(act, label, off){ return '<button type="button" role="menuitem" data-sm="' + act + '"' + (off ? ' disabled' : '') + '>' + esc(label) + '</button>'; };
    semMenu.innerHTML = '<div class="crs-menu-h">' + esc(title.firstChild ? title.firstChild.textContent : '') + '</div>' +
      b('add', L('Add a course here', 'زيد مساق هون')) +
      b('paste', clip ? L('Paste ' + (clip.courses.length === 1 ? '"' + plain(clip.courses[0].name) + '"' : clip.courses.length + ' courses') + ' here', 'الصق هون') : L('Paste here', 'الصق هون'), !clip) +
      b('all', L('Select all in this semester', 'اختار كل مواد الفصل')) +
      b('pass', L('Mark all passed', 'كلها ناجح')) +
      (p && p.official ? '<div class="crs-menu-sep"></div>' + b('reset', L('Reset to the official plan', 'رجّعه للخطة الرسمية')) : '');
    document.body.appendChild(semMenu);
    var w = semMenu.offsetWidth, h = semMenu.offsetHeight;
    semMenu.style.left = Math.min(Math.max(8, e.clientX), window.innerWidth - w - 8) + 'px';
    semMenu.style.top = Math.min(Math.max(8, e.clientY), window.innerHeight - h - 8) + 'px';
    var first = semMenu.querySelector('button:not([disabled])');
    if(first) first.focus({ preventScroll: true });
    semMenu.addEventListener('click', function(ev){
      var btn = ev.target.closest('button[data-sm]');
      if(!btn) return;
      var act = btn.getAttribute('data-sm');
      closeSemMenu();
      var slugs = [].slice.call(row.querySelectorAll('.course[id]')).map(function(el){ return slugOf(el, planId); }).filter(Boolean);
      if(act === 'add') imp().addCoursePrompt(planId, where.yearId, where.semester);
      else if(act === 'paste') paste(planId, where.yearId, where.semester);
      else if(act === 'all'){ picked = slugs; pickedPlan = planId; lastPicked = slugs[slugs.length - 1] || null; paintPicked(); }
      else if(act === 'pass' && slugs.length) markPassed(planId, slugs);
      else if(act === 'reset' && window.AAUP_SEMESTER) window.AAUP_SEMESTER.resetSemester(planId, where.yearId, where.semester);
    });
  });
  document.addEventListener('mousedown', function(e){ if(semMenu && !semMenu.contains(e.target)) closeSemMenu(); }, true);
  document.addEventListener('keydown', function(e){ if(semMenu && e.key === 'Escape') closeSemMenu(); });
  window.addEventListener('scroll', closeSemMenu, true);

  // ---- 8 · Browse Courses beside the plan --------------------------------------
  var panel = null;
  function allCourses(planId){
    var here = {};
    var all = plans();
    ((all[planId] && all[planId].courses) || []).forEach(function(c){ here[c.id] = 1; });
    var seen = {}, out = [];
    Object.keys(all).forEach(function(id){
      if(id === planId) return;
      (all[id].courses || []).forEach(function(c){
        if(!c || here[c.id] || seen[c.id] || !c.name) return;
        seen[c.id] = 1;
        out.push({ id: c.id, name: plain(c.name), ar: plain(c.ar || ''), hours: parseFloat(c.creditHours) || 0, category: c.category || 'core', from: id });
      });
    });
    return out.sort(function(a, b){ return a.name.localeCompare(b.name); });
  }
  function openPanel(){
    var planId = editingId();
    if(!planId) return;
    if(panel){ closePanel(); return; }
    panel = document.createElement('aside');
    panel.className = 'ep-browse';
    panel.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    panel.setAttribute('aria-label', L('Browse Courses', 'تصفّح المساقات'));
    panel.innerHTML = '<div class="ep-browse-h"><b>' + esc(L('Browse Courses', 'تصفّح المساقات')) + '</b>' +
      '<button type="button" class="ep-x" data-ep-close aria-label="' + esc(L('Close', 'إغلاق')) + '">×</button></div>' +
      '<input type="search" class="ep-browse-q" placeholder="' + esc(L('Search other majors’ courses', 'دوّر بمواد التخصصات التانية')) + '" aria-label="' + esc(L('Search courses', 'دوّر على مساق')) + '">' +
      '<p class="ep-browse-tip">' + esc(L('Drag a course onto a semester.', 'اسحب المساق على أي فصل.')) + '</p>' +
      '<div class="ep-browse-list"></div>';
    document.body.appendChild(panel);
    document.body.classList.add('ep-browse-open');
    var list = panel.querySelector('.ep-browse-list');
    var courses = allCourses(planId);
    var draw = function(q){
      q = (q || '').trim().toLowerCase();
      var hits = courses.filter(function(c){ return !q || c.name.toLowerCase().indexOf(q) !== -1 || c.ar.indexOf(q) !== -1; }).slice(0, 150);
      list.innerHTML = hits.length ? hits.map(function(c){
        return '<div class="ep-browse-row" draggable="true" data-ep-course="' + esc(c.id) + '" data-ep-from="' + esc(c.from) + '">' +
          '<span>' + esc(ar() && c.ar ? c.ar : c.name) + '</span><small>' + c.hours + L('H', ' س') + '</small></div>';
      }).join('') : '<p class="ep-browse-tip">' + esc(L('No courses match.', 'ما في مواد بهالاسم.')) + '</p>';
    };
    draw('');
    panel.querySelector('.ep-browse-q').addEventListener('input', function(e){ draw(e.target.value); });
    panel.addEventListener('click', function(e){ if(e.target.closest('[data-ep-close]')) closePanel(); });
    panel.addEventListener('dragstart', function(e){
      var r = e.target.closest && e.target.closest('[data-ep-course]');
      if(!r) return;
      e.dataTransfer.setData('text/x-aaup-course', r.getAttribute('data-ep-from') + '|' + r.getAttribute('data-ep-course'));
      e.dataTransfer.effectAllowed = 'copy';
    });
    panel.querySelector('.ep-browse-q').focus();
  }
  function closePanel(){ if(panel){ panel.remove(); panel = null; } document.body.classList.remove('ep-browse-open'); }
  document.addEventListener('click', function(e){ if(e.target.closest && e.target.closest('[data-ep-browse]')){ e.preventDefault(); openPanel(); } });
  function isCourseDrag(e){ return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'text/x-aaup-course') !== -1; }
  function isFileDrag(e){ return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
  function rowAt(e){ var el = e.target.closest && e.target.closest('.imp-semester-block'); return el ? el.querySelector('.course-row[id]') : null; }
  document.addEventListener('dragover', function(e){
    if(isCourseDrag(e)){
      var row = rowAt(e);
      document.querySelectorAll('.course-row.drop-ok').forEach(function(r){ if(r !== row) r.classList.remove('drop-ok'); });
      if(row){ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; row.classList.add('drop-ok'); }
      return;
    }
    if(isFileDrag(e)){ e.preventDefault(); showDropVeil(); }
  });
  document.addEventListener('drop', function(e){
    if(isCourseDrag(e)){
      document.querySelectorAll('.course-row.drop-ok').forEach(function(r){ r.classList.remove('drop-ok'); });
      var row = rowAt(e), where = row && parseContainer(row.id);
      if(!where) return;
      e.preventDefault();
      var parts = e.dataTransfer.getData('text/x-aaup-course').split('|');
      addFrom(where, parts[0], parts[1]);
      return;
    }
    if(isFileDrag(e)){ e.preventDefault(); hideDropVeil(); restoreFile(e.dataTransfer.files && e.dataTransfer.files[0]); }
  });
  function addFrom(where, fromPlan, slug){
    var src = courseOf(plans()[fromPlan], slug);
    if(!src) return;
    var added = change(where.planId, function(p){
      if(courseOf(p, slug)){ toast(L('"' + plain(src.name) + '" is already in this plan', '«' + plain(src.ar || src.name) + '» موجود بالخطة')); return false; }
      p.prerequisites = p.prerequisites || [];
      p.courses.push({ id: src.id, name: src.name, ar: src.ar || src.name, creditHours: parseFloat(src.creditHours) || 0,
                       category: src.category || 'core', yearId: where.yearId, semester: where.semester,
                       placedByStudent: src.category === 'dept' ? true : undefined });
    });
    if(!added) return;
    if(imp().runAutoLink) imp().runAutoLink(where.planId, slug);
    refresh(where.planId);
    if(panel){
      [].forEach.call(panel.querySelectorAll('[data-ep-course]'), function(r){ if(r.getAttribute('data-ep-course') === slug) r.remove(); });
    }
    toast(L('Added "' + plain(src.name) + '"', 'انضاف «' + plain(src.ar || src.name) + '»'));
  }

  // ---- 13 · drop a backup file on the window ------------------------------------
  var veil = null, veilTimer = null;
  function showDropVeil(){
    if(!veil){
      veil = document.createElement('div');
      veil.className = 'ep-drop-veil';
      veil.innerHTML = '<div><b>' + esc(L('Drop to restore', 'افلته لترجّع النسخة')) + '</b><span>' +
        esc(L('An AAUPath backup file (.json)', 'ملف نسخة احتياطية من AAUPath (.json)')) + '</span></div>';
      document.body.appendChild(veil);
    }
    clearTimeout(veilTimer);
    veilTimer = setTimeout(hideDropVeil, 250);
  }
  function hideDropVeil(){ clearTimeout(veilTimer); if(veil){ veil.remove(); veil = null; } }
  function restoreFile(file){
    if(!file) return;
    if(!/\.json$/i.test(file.name || '') && file.type !== 'application/json'){ toast(L('That isn’t a backup file (.json).', 'هاد مش ملف نسخة احتياطية (.json).')); return; }
    if(!window.AAUP_DATA || !window.AAUP_DATA.handleImportFile) return;
    var go = function(){ window.AAUP_DATA.handleImportFile(file); };
    var msg = L('Restore "' + file.name + '"? It replaces what is on this device now.', 'ترجّع «' + file.name + '»؟ رح تحلّ محل اللي على هالجهاز هلق.');
    if(window.__showConfirmDialog) window.__showConfirmDialog(msg, go, ar()); else if(window.confirm(msg)) go();
  }

  // Selection and the panel belong to Edit Mode; leaving it clears both. The
  // plan re-renders its whole DOM on most changes, so picks are repainted.
  // Watching the plan view only (not the body, where this module's own bar
  // and panel come and go), and only for rebuilt nodes; paintPicked() touches
  // classes, not nodes, so it can't set itself off.
  var queued = false;
  function watchPlanView(){
    var host = document.getElementById('importedPlanView');
    if(!host) return;
    new MutationObserver(function(){
      if(queued) return;
      queued = true;
      requestAnimationFrame(function(){
        queued = false;
        if(!editingPage()){ if(picked.length) clearPicked(); if(panel) closePanel(); return; }
        if(picked.length) paintPicked();
      });
    }).observe(host, { childList: true, subtree: true });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPlanView); else watchPlanView();

  window.AAUP_EDIT_POWER = { undo: undo, redo: redo, openPanel: openPanel, startRename: startRename, copy: copy, paste: paste };
})();
