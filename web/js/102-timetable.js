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
  function courses(planId){
    var ts = window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.thisSemester ? window.AAUP_TASK_HOME.thisSemester(planId) : null;
    return ts ? ts.list : [];
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
  // For the This semester card: one quiet line that leads here, only while
  // no times have been added.
  function promptHtml(planId){
    if(!planId || hasAny(planId) || !courses(planId).length) return '';
    return '<button type="button" class="hm-tt-prompt" data-tt-open>' + ic('clock', 14) +
      esc(L('Add your class times to see today\'s classes here', 'ضيف أوقات محاضراتك لتشوف محاضرات اليوم هون')) + '</button>';
  }

  // ---- the window -----------------------------------------------------------
  var openFor = null, editing = null;   // editing: course slug with its add form open
  function overlayEl(){
    var el = document.getElementById('ttOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'ttOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card tt-card" role="dialog" aria-modal="true" aria-labelledby="ttTitle"><div class="modal-body" id="ttBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && el.classList.contains('open')) close(); });
    return el;
  }
  function close(){
    var el = document.getElementById('ttOverlay');
    if(el) el.classList.remove('open');
    if(window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.visible && window.AAUP_TASK_HOME.visible()) window.AAUP_TASK_HOME.render();
  }
  function dayLabel(d){ return ar() ? DAY_AR[d] : DAY_EN[d]; }
  function meetingTx(x){
    return (x.d || []).slice().sort(function(a, b){ return WEEK.indexOf(a) - WEEK.indexOf(b); }).map(dayLabel).join(' ') +
      ' · ' + x.s + '–' + x.e + (x.r ? ' · ' + x.r : '');
  }
  function render(){
    var body = document.getElementById('ttBody');
    if(!body) return;
    var list = courses(openFor), m = forPlan(openFor);
    body.innerHTML =
      '<div class="tt-head"><h2 class="mh" id="ttTitle" style="margin:0;">' + ic('clock', 20) + esc(L('Your class times', 'أوقات محاضراتك')) + '</h2>' +
      '<button type="button" class="home-btn btn-quiet btn-sm" data-tt-close>' + esc(L('Done', 'تم')) + '</button></div>' +
      '<p class="form-note" style="margin-top:0;">' + esc(L('From your registration. Home shows today\'s classes from these.', 'من تسجيلك. الرئيسية بتعرض محاضرات اليوم منها.')) + '</p>' +
      (list.length ? list.map(function(c){
        var rows = m[c.id] || [];
        return '<div class="tt-course">' +
          '<div class="tt-course-h"><b>' + esc(courseName(c)) + '</b>' +
            (editing === c.id ? '' : '<button type="button" class="cloud-link" data-tt-add="' + esc(c.id) + '">+ ' + esc(L('Add a time', 'ضيف وقت')) + '</button>') + '</div>' +
          rows.map(function(x, i){
            return '<div class="tt-meet"><span>' + esc(meetingTx(x)) + '</span>' +
              '<button type="button" class="dates-del" data-tt-del="' + esc(c.id) + '" data-tt-i="' + i + '" aria-label="' + esc(L('Remove', 'احذف')) + '">×</button></div>';
          }).join('') +
          (editing === c.id ? formHtml(c.id) : '') +
          '</div>';
      }).join('') : '<p class="form-note">' + esc(L('No courses for this semester yet.', 'ما في مساقات لهالفصل بعد.')) + '</p>');
    var first = body.querySelector('.tt-form input[type="time"]');
    if(first) first.focus();
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
      '<div class="form-actions" style="justify-content:flex-start;">' +
        '<button type="button" class="home-btn btn-pri btn-sm" data-tt-save="' + esc(slug) + '">' + esc(L('Save', 'حفظ')) + '</button>' +
        '<button type="button" class="home-btn btn-quiet btn-sm" data-tt-cancel>' + esc(L('Cancel', 'إلغاء')) + '</button>' +
      '</div></div>';
  }
  function onClick(e){
    var el = document.getElementById('ttOverlay');
    var t = e.target, b;
    if(t === el || t.closest('[data-tt-close]')){ close(); return; }
    if((b = t.closest('[data-tt-add]'))){ editing = b.getAttribute('data-tt-add'); render(); return; }
    if(t.closest('[data-tt-cancel]')){ editing = null; render(); return; }
    if((b = t.closest('[data-tt-day]'))){ b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); return; }
    if((b = t.closest('[data-tt-del]'))){
      var m = forPlan(openFor), slug = b.getAttribute('data-tt-del'), i = +b.getAttribute('data-tt-i');
      (m[slug] || []).splice(i, 1);
      if(m[slug] && !m[slug].length) delete m[slug];
      savePlan(openFor, m); render();
      return;
    }
    if((b = t.closest('[data-tt-save]'))){
      var form = b.closest('.tt-form'), err = form.querySelector('.tt-err');
      var days = Array.prototype.map.call(form.querySelectorAll('[data-tt-day][aria-pressed="true"]'), function(x){ return +x.getAttribute('data-tt-day'); });
      var s = form.querySelector('.tt-s').value, en = form.querySelector('.tt-e').value, r = form.querySelector('.tt-r').value.trim().slice(0, 20);
      if(!days.length){ err.textContent = L('Pick at least one day.', 'اختار يوم واحد على الأقل.'); err.hidden = false; return; }
      if(!s || !en || mins(en) <= mins(s)){ err.textContent = L('The end time has to be after the start.', 'وقت النهاية لازم يكون بعد البداية.'); err.hidden = false; return; }
      var map = forPlan(openFor), key = b.getAttribute('data-tt-save');
      (map[key] = map[key] || []).push({ d: days, s: s, e: en, r: r });
      savePlan(openFor, map);
      editing = null; render();
    }
  }
  function open(planId){
    openFor = planId || (window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected && window.AAUP_DASHBOARD.getSelected());
    if(!openFor) return;
    editing = null;
    overlayEl().classList.add('open');
    render();
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-tt-open]');
    if(b) open();
  });

  window.AAUP_TIMETABLE = { open: open, todayHtml: todayHtml, promptHtml: promptHtml, meetingsOn: meetingsOn, forPlan: forPlan, hasAny: hasAny };
})();
