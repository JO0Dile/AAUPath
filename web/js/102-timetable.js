// ==========================
// CLASS TIMES + TODAY ON HOME (idea 17).
//
// The catalogue does not know when anything meets; the university gives
// that out at registration. So the student types it once: for each course
// this semester, the days, the start and end time, and the room. Home then
// shows today's classes in order, with how long until the next one, and
// shows nothing on a day with no classes (or before any times are added).
//
// Stored per major through AAUP_STORAGE (so it follows the profile and
// Cloud Sync):
//   aaup_timetable = { [planId]: { [courseSlug]: [ { d:[0..6], s:'10:00', e:'11:15', r:'B-203' } ] } }
// Days are Date.getDay() numbers: 0 Sunday … 6 Saturday.
//
// Beyond this semester's courses, a student can add any other class: one
// picked from the major's full course list (keyed by its slug), or one they
// type themselves, like an elective from another college (keyed 'x:' + the
// name). Those show wherever this semester's do, and go away with their last
// time.
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_timetable';
  // AAUP's teaching week: Saturday to Thursday.
  var WEEK = [6, 0, 1, 2, 3, 4];
  var DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_AR = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  var DAY_FULL_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAY_FULL_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }
  function ic(k, n){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview(k, n || 16) : ''; }

  function all(){ var m = window.AAUP_STORAGE ? window.AAUP_STORAGE.getJSON(KEY, {}) : {}; return (m && typeof m === 'object') ? m : {}; }
  function forPlan(planId){ var m = all()[planId]; return (m && typeof m === 'object') ? m : {}; }
  function savePlan(planId, map){ var m = all(); m[planId] = map; if(window.AAUP_STORAGE) window.AAUP_STORAGE.setJSON(KEY, m); }
  function hasAny(planId){ var m = forPlan(planId); return Object.keys(m).some(function(k){ return Array.isArray(m[k]) && m[k].length; }); }

  function mins(hhmm){ var p = String(hhmm || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function planCourses(planId){
    var p = window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans ? (window.AAUP_IMPORTED.loadImportedPlans() || {})[planId] : null;
    return (p && Array.isArray(p.courses)) ? p.courses : [];
  }
  function extraCourse(planId, key){
    if(key.indexOf('x:') === 0) return { id: key, name: key.slice(2), ar: '' };
    return planCourses(planId).filter(function(c){ return c.id === key; })[0] || null;
  }
  // This semester's courses, then every other class the student added.
  function courses(planId){
    var ts = window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.thisSemester ? window.AAUP_TASK_HOME.thisSemester(planId) : null;
    var list = ts ? ts.list.slice() : [], seen = {};
    list.forEach(function(c){ seen[c.id] = 1; });
    var keys = Object.keys(forPlan(planId));
    if(planId === openFor && picked) keys.push(picked);
    keys.forEach(function(k){
      if(seen[k]) return;
      var c = extraCourse(planId, k);
      if(c){ seen[k] = 1; list.push(c); }
    });
    return list;
  }
  function courseName(c){ return ar() && c.ar ? c.ar : c.name; }

  // Every meeting on one weekday, soonest first: { c, s, e, r }.
  function meetingsOn(planId, day){
    var m = forPlan(planId), out = [];
    courses(planId).forEach(function(c){
      (m[c.id] || []).forEach(function(x){
        if((x.d || []).indexOf(day) >= 0) out.push({ c: c, s: x.s, e: x.e, r: x.r || '' });
      });
    });
    return out.sort(function(a, b){ return mins(a.s) - mins(b.s); });
  }

  // ---- Home ---------------------------------------------------------------
  function todayHtml(planId){
    if(!planId || !hasAny(planId)) return '';
    var now = new Date(), day = now.getDay(), nowM = now.getHours() * 60 + now.getMinutes();
    var list = meetingsOn(planId, day).filter(function(x){ return mins(x.e) > nowM; });
    if(!list.length) return '';
    var first = list[0], startIn = mins(first.s) - nowM;
    var pill = startIn <= 0 ? L('on now', 'هلأ')
      : startIn < 60 ? L('next in ' + startIn + ' min', 'بعد ' + startIn + ' دقيقة')
      : L('next at ' + first.s, 'الجاي الساعة ' + first.s);
    return '<section class="hm-sem hm-today" aria-label="' + esc(L('Today', 'اليوم')) + '">' +
      '<div class="hm-sem-h"><b>' + esc(L('Today · ' + DAY_FULL_EN[day], 'اليوم · ' + DAY_FULL_AR[day])) + '</b>' +
        '<span class="hm-today-pill' + (startIn <= 0 ? ' is-now' : '') + '">' + esc(pill) + '</span></div>' +
      list.map(function(x){
        var on = mins(x.s) <= nowM;
        return '<div class="hm-sem-row hm-today-row' + (on ? ' is-now' : '') + '">' +
          '<span class="hm-sem-name">' + esc(courseName(x.c)) + (x.r ? '<small>' + esc(x.r) + '</small>' : '') + '</span>' +
          '<b class="hm-today-time">' + esc(x.s) + '</b></div>';
      }).join('') +
      '</section>';
  }
  // For the This semester card: one quiet line that leads here. It stays
  // once times are added (it used to vanish, taking the way back with it)
  // and then reads as the way to see or change them.
  function promptHtml(planId){
    if(!planId || !courses(planId).length) return '';
    return '<button type="button" class="hm-tt-prompt" data-tt-open>' + ic('clock', 14) +
      (hasAny(planId)
        ? esc(L('My class times · Edit', 'أوقات محاضراتي · تعديل'))
        : esc(L('Add your class times to see today\'s classes here', 'ضيف أوقات محاضراتك لتشوف محاضرات اليوم هون'))) + '</button>';
  }

  // ---- the window -----------------------------------------------------------
  var openFor = null, editing = null;   // editing: course slug with its add form open
  var adding = false, picked = null;   // the "Add another class" picker, and the class it picked
  function overlayEl(){
    var el = document.getElementById('ttOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'ttOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card tt-card" role="dialog" aria-modal="true" aria-labelledby="ttTitle"><div class="modal-body" id="ttBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    // The phone's back arrow and back button close windows by taking the
    // class off directly; a time still being typed is saved then too.
    new MutationObserver(function(){
      if(el.classList.contains('open')) return;
      var form = el.querySelector('.tt-form');
      if(form && form.querySelector('[data-tt-day][aria-pressed="true"]') && saveForm(form)) render();
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
    el.addEventListener('input', function(e){ if(e.target.id === 'ttPick') fillPicks(); });
    el.addEventListener('change', function(e){ var f = e.target.closest && e.target.closest('.tt-form'); if(f) autoSave(f); });
    el.addEventListener('keydown', function(e){
      if(e.target.id !== 'ttPick' || e.key !== 'Enter') return;
      var first = document.querySelector('#ttPickList [data-tt-pick]') || document.querySelector('#ttPickList [data-tt-own]');
      if(first){ e.preventDefault(); first.click(); }
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && el.classList.contains('open')) close(); });
    return el;
  }
  // "Done" with a time half-entered used to close and drop it, which read as
  // the times vanishing. Now a form with a day picked is saved on the way
  // out; one with a problem stays open and says what to fix.
  function close(){
    var form = document.querySelector('#ttOverlay .tt-form');
    if(form && form.querySelector('[data-tt-day][aria-pressed="true"]')){
      if(!saveForm(form)) return;
      render();   // the saved form leaves the page, so closing can't save it twice
    }
    var el = document.getElementById('ttOverlay');
    if(el) el.classList.remove('open');
    if(window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.visible && window.AAUP_TASK_HOME.visible()) window.AAUP_TASK_HOME.render();
  }
  function dayLabel(d){ return ar() ? DAY_AR[d] : DAY_EN[d]; }
  // Days in the reading direction; the time range and room always left to right.
  function meetingHtml(x){
    return esc((x.d || []).slice().sort(function(a, b){ return WEEK.indexOf(a) - WEEK.indexOf(b); }).map(dayLabel).join(' ')) +
      ' · <bdi dir="ltr">' + esc(x.s + '–' + x.e) + '</bdi>' + (x.r ? ' · <bdi dir="ltr">' + esc(x.r) + '</bdi>' : '');
  }
  function render(){
    var body = document.getElementById('ttBody');
    if(!body) return;
    var list = courses(openFor), m = forPlan(openFor);
    body.innerHTML =
      '<div class="tt-head"><h2 class="mh" id="ttTitle" style="margin:0;">' + ic('clock', 20) + esc(L('Your class times', 'أوقات محاضراتك')) + '</h2>' +
      '<button type="button" class="home-btn btn-quiet btn-sm" id="ttClose" data-tt-close>' + esc(L('Done', 'تم')) + '</button></div>' +
      '<p class="form-note" style="margin-top:0;">' + esc(L('From your registration. Home shows today\'s classes from these.', 'من تسجيلك. الرئيسية بتعرض محاضرات اليوم منها.')) + '</p>' +
      (window.AAUP_WEEK ? window.AAUP_WEEK.panelHtml(openFor) : '') +
      // My Week holds the calendar file too (round 7, idea 1): it opens over
      // this window, and closing it comes back here.
      (window.AAUP_CALENDAR && hasAny(openFor) ? '<button type="button" class="home-btn btn-sm tt-cal-btn" data-tt-cal>' + ic('calendar', 15) +
        esc(L('Add to my calendar', 'ضيفها لتقويمي')) + '</button>' : '') +
      (list.length ? list.map(function(c){
        var rows = m[c.id] || [];
        return '<div class="tt-course">' +
          '<div class="tt-course-h"><b>' + esc(courseName(c)) + '</b>' +
            '<button type="button" class="cloud-link" data-tt-add="' + esc(c.id) + '">+ ' + esc(L('Add a time', 'ضيف وقت')) + '</button></div>' +
          rows.map(function(x, i){
            return '<div class="tt-meet"><span>' + meetingHtml(x) + '</span>' +
              '<button type="button" class="dates-del" data-tt-del="' + esc(c.id) + '" data-tt-i="' + i + '" aria-label="' + esc(L('Remove', 'احذف')) + '">×</button></div>';
          }).join('') +
          (editing === c.id ? formHtml(c.id) : '') +
          '</div>';
      }).join('') : '<p class="form-note">' + esc(L('No courses for this semester yet.', 'ما في مساقات لهالفصل بعد.')) + '</p>') +
      (adding ? pickerHtml() : editing ? '' : '<button type="button" class="home-btn btn-quiet btn-sm tt-more" data-tt-more>+ ' + esc(L('Add another class', 'ضيف محاضرة ثانية')) + '</button>');
    var pick = document.getElementById('ttPick');
    if(pick){ pick.focus(); fillPicks(); return; }
    var first = body.querySelector('.tt-form input[type="time"]');
    if(first) first.focus();
  }

  // ---- adding another class ---------------------------------------------------
  function pickerHtml(){
    return '<div class="tt-pick">' +
      '<label class="tt-pick-l" for="ttPick">' + esc(L('Pick a course or type its name', 'اختار مساق أو اكتب اسمه')) + '</label>' +
      '<input type="search" id="ttPick" maxlength="60" autocomplete="off" placeholder="' + esc(L('e.g. Leadership', 'مثلًا: القيادة')) + '">' +
      '<div class="tt-pick-list" id="ttPickList" role="listbox"></div>' +
      '<div class="form-actions" style="justify-content:flex-start;"><button type="button" class="home-btn btn-quiet btn-sm" data-tt-cancel>' + esc(L('Cancel', 'إلغاء')) + '</button></div>' +
      '</div>';
  }
  function norm(t){ return String(t || '').toLowerCase().replace(/[\u064B-\u0652]/g, '').replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim(); }
  function fillPicks(){
    var box = document.getElementById('ttPickList'), q = norm(document.getElementById('ttPick').value);
    if(!box) return;
    var shown = {};
    courses(openFor).forEach(function(c){ shown[c.id] = 1; });
    var raw = document.getElementById('ttPick').value.trim();
    var list = planCourses(openFor).filter(function(c){
      if(shown[c.id]) return false;
      if(!q) return true;
      return norm(c.name).indexOf(q) >= 0 || norm(c.ar).indexOf(q) >= 0 || norm(c.num || c.courseNumber).indexOf(q) >= 0;
    }).sort(function(a, b){ return courseName(a).localeCompare(courseName(b), ar() ? 'ar' : 'en'); });
    var exact = list.some(function(c){ return norm(c.name) === q || norm(c.ar) === q; });
    box.innerHTML =
      (raw && !exact ? '<button type="button" class="tt-pick-row is-own" data-tt-own>' + esc(L('Add “' + raw + '”', 'ضيف “' + raw + '”')) + '<small>' + esc(L('not in your plan', 'مش بخطتك')) + '</small></button>' : '') +
      list.map(function(c){
        var code = c.num || c.courseNumber || '';
        return '<button type="button" class="tt-pick-row" role="option" data-tt-pick="' + esc(c.id) + '">' + esc(courseName(c)) +
          '<small>' + esc((code ? code + ' · ' : '') + (parseFloat(c.creditHours) || 0) + L('H', ' س')) + '</small></button>';
      }).join('') +
      (!raw && !list.length ? '<p class="form-note">' + esc(L('Type the course name.', 'اكتب اسم المساق.')) + '</p>' : '');
  }
  function startTimes(key){
    picked = key; adding = false; editing = key;
    render();
  }
  function formHtml(slug){
    return '<div class="tt-form" data-tt-form="' + esc(slug) + '">' +
      '<div class="tt-days" role="group" aria-label="' + esc(L('Days', 'الأيام')) + '">' + WEEK.map(function(d){
        return '<button type="button" class="tt-day" data-tt-day="' + d + '" aria-pressed="false">' + esc(dayLabel(d)) + '</button>';
      }).join('') + '</div>' +
      '<div class="tt-times">' +
        '<label>' + esc(L('From', 'من')) + '<input type="time" class="tt-s" value="08:00"></label>' +
        '<label>' + esc(L('To', 'لـ')) + '<input type="time" class="tt-e" value="09:15"></label>' +
        '<label class="tt-room">' + esc(L('Room', 'القاعة')) + '<input type="text" class="tt-r" maxlength="20" placeholder="B-203"></label>' +
      '</div>' +
      '<p class="dev-error-msg tt-err" hidden></p>' +
      // No Save button (round 7, idea 10): the time is kept as soon as it has
      // a day and a start and end, and "Saved" says so. Cancel takes it back.
      '<div class="form-actions" style="justify-content:flex-start;align-items:center;">' +
        '<span class="tt-saved" hidden>' + esc(L('✓ Saved', '✓ انحفظ')) + '</span>' +
        '<button type="button" class="home-btn btn-quiet btn-sm" data-tt-cancel>' + esc(L('Cancel', 'إلغاء')) + '</button>' +
      '</div></div>';
  }
  function onClick(e){
    var el = document.getElementById('ttOverlay');
    var t = e.target, b;
    if(t === el || t.closest('[data-tt-close]')){ close(); return; }
    if((b = t.closest('[data-tt-add]'))){ editing = b.getAttribute('data-tt-add'); render(); return; }
    if(t.closest('[data-tt-cancel]')){
      var cf = t.closest('.tt-form');
      if(cf && cf.getAttribute('data-idx')){
        var cm = forPlan(openFor), ck = cf.getAttribute('data-tt-form');
        if(cm[ck]){ cm[ck].splice(+cf.getAttribute('data-idx'), 1); if(!cm[ck].length) delete cm[ck]; savePlan(openFor, cm); }
      }
      editing = null; adding = false; picked = null; render(); return;
    }
    if(t.closest('[data-tt-cal]')){
      var dm = document.getElementById('devModalOverlay');
      if(dm){
        dm.classList.add('is-over-tt');
        new MutationObserver(function(l, o){ if(!dm.classList.contains('open')){ dm.classList.remove('is-over-tt'); o.disconnect(); } })
          .observe(dm, { attributes: true, attributeFilter: ['class'] });
      }
      window.AAUP_CALENDAR.open(openFor);
      return;
    }
    if(t.closest('[data-tt-more]')){ adding = true; editing = null; render(); return; }
    if((b = t.closest('[data-tt-pick]'))){ startTimes(b.getAttribute('data-tt-pick')); return; }
    if(t.closest('[data-tt-own]')){
      var nm = document.getElementById('ttPick').value.trim().replace(/\s+/g, ' ').slice(0, 60);
      if(nm) startTimes('x:' + nm);
      return;
    }
    if((b = t.closest('[data-tt-day]'))){ b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); autoSave(b.closest('.tt-form')); return; }
    if((b = t.closest('[data-tt-del]'))){
      var m = forPlan(openFor), slug = b.getAttribute('data-tt-del'), i = +b.getAttribute('data-tt-i');
      (m[slug] || []).splice(i, 1);
      if(m[slug] && !m[slug].length) delete m[slug];
      savePlan(openFor, m); render();
      return;
    }
  }
  // What the form holds, and what's wrong with it if anything.
  function readForm(form){
    var days = Array.prototype.map.call(form.querySelectorAll('[data-tt-day][aria-pressed="true"]'), function(x){ return +x.getAttribute('data-tt-day'); });
    var s = form.querySelector('.tt-s').value, en = form.querySelector('.tt-e').value, r = form.querySelector('.tt-r').value.trim().slice(0, 20);
    var problem = '';
    if(!days.length) problem = L('Pick at least one day.', 'اختار يوم واحد على الأقل.');
    else if(!s || !en || mins(en) <= mins(s)) problem = L('The end time has to be after the start.', 'وقت النهاية لازم يكون بعد البداية.');
    // A class before 6 in the morning is almost always 12:15 PM entered as AM
    // on a phone's 12-hour clock.
    else if(mins(s) < 6 * 60) problem = L('That is ' + s + ' at night. Did you mean PM? (e.g. 12:15 PM)', 'هاد ' + s + ' بالليل. قصدك بعد الظهر؟ (مثلًا 12:15 م)');
    return { v: { d: days, s: s, e: en, r: r }, problem: problem };
  }
  // The first write adds the time; later ones update the same time.
  function writeForm(form, v){
    var map = forPlan(openFor), key = form.getAttribute('data-tt-form'), idx = form.getAttribute('data-idx');
    map[key] = map[key] || [];
    if(idx && map[key][+idx]) map[key][+idx] = v;
    else { map[key].push(v); form.setAttribute('data-idx', String(map[key].length - 1)); }
    savePlan(openFor, map);
  }
  // Kept as it is typed (round 7, idea 10). Silent while it isn't complete;
  // what is wrong is said when the window closes.
  function autoSave(form){
    if(!form) return;
    var f = readForm(form), ok = form.querySelector('.tt-saved');
    if(f.problem){ if(ok) ok.hidden = true; return; }
    writeForm(form, f.v);
    form.querySelector('.tt-err').hidden = true;
    if(ok) ok.hidden = false;
  }
  // On the way out: saves, or says what to fix and keeps the window open.
  function saveForm(form){
    var err = form.querySelector('.tt-err'), f = readForm(form);
    if(f.problem){ err.textContent = f.problem; err.hidden = false; return false; }
    writeForm(form, f.v);
    editing = null; picked = null;
    return true;
  }
  function open(planId){
    openFor = planId || (window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected && window.AAUP_DASHBOARD.getSelected());
    if(!openFor) return;
    editing = null; adding = false; picked = null;
    overlayEl().classList.add('open');
    render();
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-tt-open]');
    if(b) open();
  });

  window.AAUP_TIMETABLE = { courses: courses, open: open, todayHtml: todayHtml, promptHtml: promptHtml, meetingsOn: meetingsOn, forPlan: forPlan, hasAny: hasAny };
})();
