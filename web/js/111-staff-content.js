// Round 10, part B: what deans and professors wrote, shown to students.
//
// GET <admin Worker>/api/public/content?uni= gives, per course: About this
// course, Revise first, the semester it is offered in, a note on its
// prerequisites, and a note pinned until a date; plus professors' cards for
// Find a Professor. The last copy is kept on the phone, so all of it still
// shows offline, and it is asked for again at most every half hour.
//
// Used by the course window (js/49-course-detail.js), the plan cards
// (js/28-imported.js: the "Fall only" warning) and Find a Professor
// (js/68-contacts.js). The editing side is js/110-staff-room.js.
(function(){
  'use strict';

  var KEY = 'aaup_staffContent';
  var MAX_AGE = 30 * 60 * 1000;
  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }

  function stored(){
    var d = window.AAUP_STORAGE ? window.AAUP_STORAGE.getJSON(KEY, null) : null;
    return d && typeof d === 'object' ? d : null;
  }
  function uniNow(){
    var id = window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected ? window.AAUP_DASHBOARD.getSelected() : '';
    var p = id && window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans()[id] : null;
    return (p && p.university) || 'aaup';
  }
  function data(){
    var d = stored();
    return d && d.uni === uniNow() && d.data ? d.data : { courses: {}, cards: [] };
  }

  var asking = false;
  function load(force){
    var base = String(window.APP_ADMIN_URL || '').replace(/\/+$/, '');
    if(!base || asking || !window.fetch) return;
    var d = stored(), uni = uniNow();
    if(!force && d && d.uni === uni && Date.now() - (d.at || 0) < MAX_AGE) return;
    asking = true;
    fetch(base + '/api/public/content?uni=' + encodeURIComponent(uni))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(!j || !j.ok) return;
        var changed = !d || d.uni !== uni || (d.data && d.data.v) !== j.v;
        if(window.AAUP_STORAGE) window.AAUP_STORAGE.setJSON(KEY, { at: Date.now(), uni: uni, data: { v: j.v, courses: j.courses || {}, cards: j.cards || [] } });
        if(changed){
          var id = window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected ? window.AAUP_DASHBOARD.getSelected() : '';
          var host = document.getElementById('importedPlanView');
          if(id && host && host.style.display !== 'none' && window.AAUP_IMPORTED && window.AAUP_IMPORTED.refresh) window.AAUP_IMPORTED.refresh(id);
        }
      })
      .catch(function(){})
      .then(function(){ asking = false; });
  }

  function today(){ var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // What was written under a course's old id (before its major switched to
  // course numbers, js/02-id-renames.js) still belongs to it.
  var oldIds = null;
  function oldIdsOf(id){
    if(!oldIds){
      oldIds = {};
      var t = window.APP_ID_RENAMES || {};
      Object.keys(t).forEach(function(p){ Object.keys(t[p]).forEach(function(o){ (oldIds[t[p][o]] = oldIds[t[p][o]] || []).push(o); }); });
    }
    return oldIds[id] || [];
  }
  function forCourse(id){
    var all = data().courses, out = null;
    oldIdsOf(id).concat([id]).forEach(function(k){ if(all[k]){ out = out || {}; Object.keys(all[k]).forEach(function(f){ out[f] = all[k][f]; }); } });
    return out;
  }
  function noteNow(c){ return c && c.note && c.note.text && c.note.until >= today() ? c.note : null; }
  function semTx(s){ return s === 's1' ? L('first semester', 'الفصل الأول') : L('second semester', 'الفصل الثاني'); }
  function chipTx(s){ return s === 's1' ? L('Fall only', 'فصل أول بس') : L('Spring only', 'فصل ثاني بس'); }
  // Offered in one semester only, and sitting in the other one in the plan.
  function offerClash(course){
    var c = course && forCourse(course.id);
    var sem = course && String(course.semester || '').toLowerCase();
    return !!(c && c.offered && (sem === 's1' || sem === 's2') && sem !== c.offered);
  }

  // The course window: pieces for under the course's title and under its
  // one-sentence lead.
  function subChipHtml(course){
    var c = course && forCourse(course.id);
    return c && c.offered ? '<span class="sc-chip' + (offerClash(course) ? ' is-warn' : '') + '">' + esc(chipTx(c.offered)) + '</span>' : '';
  }
  function courseHtml(course){
    var c = course && forCourse(course.id);
    if(!c) return '';
    var out = '';
    if(offerClash(course)){
      out += '<p class="sc-warn">' + esc(L('Only taught in the ' + semTx(c.offered) + ', but it is in a ' + semTx(course.semester) + ' in your plan. Move it so you don’t lose a term.',
        'بتنعطى بـ' + semTx(c.offered) + ' بس، وهي بخطتك بـ' + semTx(course.semester) + '. انقلها عشان ما يروح عليك فصل.')) + '</p>';
    }
    var n = noteNow(c);
    if(n){
      var until = new Date(n.until + 'T00:00:00').toLocaleDateString(ar() ? 'ar' : 'en', { day: 'numeric', month: 'short' });
      out += '<div class="sc-note"><b>' + esc(L('Note from the college · until ', 'ملاحظة من الكلية · لحد ') + until) + '</b>' + esc(n.text) + '</div>';
    }
    // F · this semester's sections. "Put it in My Week" makes the section's
    // days, times and room this course's class times.
    if(Array.isArray(c.sections) && c.sections.length){
      var picked = window.AAUP_TIMETABLE && course.plan ? window.AAUP_TIMETABLE.pickedSection(course.plan, course.id) : '';
      out += '<div class="sc-secs"><div class="sc-lbl">' + esc(L('Sections this semester', 'شعب هالفصل')) + '</div>' +
        c.sections.map(function(x, i){
          var on = picked && picked === String(x.n);
          return '<div class="sc-sec"><div class="sc-sec-t"><b>' + esc(L('Section ', 'شعبة ') + x.n) + '</b><small>' +
              esc([secDays(x.days), fmt(x.s) + '–' + fmt(x.e), x.room, x.prof].filter(Boolean).join(' · ')) + '</small></div>' +
            (course.plan ? '<button type="button" class="sc-pick' + (on ? ' is-on' : '') + '" data-sc-pick="' + esc(course.plan + '|' + course.id + '|' + i) + '">' +
              esc(on ? L('In My Week ✓', 'بأسبوعي ✓') : L('Put it in My Week', 'حطها بأسبوعي')) + '</button>' : '') +
          '</div>';
        }).join('') + '</div>';
    }
    if(c.about){
      out += '<div class="sc-about"><div class="sc-lbl">' + esc(L('About this course', 'عن المساق')) + '<span class="sc-by">' + esc(L('from the college', 'من الكلية')) + '</span></div>' +
        '<p>' + esc(c.about) + '</p></div>';
    }
    return out ? '<div class="sc">' + out + '</div>' : '';
  }
  var DAY_TX = { 6: ['Sat', 'سبت'], 0: ['Sun', 'أحد'], 1: ['Mon', 'اثنين'], 2: ['Tue', 'ثلاثاء'], 3: ['Wed', 'أربعاء'], 4: ['Thu', 'خميس'], 5: ['Fri', 'جمعة'] };
  function secDays(days){
    return [6, 0, 1, 2, 3, 4, 5].filter(function(d){ return (days || []).indexOf(d) !== -1; })
      .map(function(d){ return L(DAY_TX[d][0], DAY_TX[d][1]); }).join(L(', ', '، '));
  }
  function fmt(t){ return window.__fmtTime ? window.__fmtTime(t) : t; }
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-sc-pick]');
    if(!b || !window.AAUP_TIMETABLE) return;
    var parts = b.getAttribute('data-sc-pick').split('|');
    var c = forCourse(parts[1]), sec = c && c.sections && c.sections[+parts[2]];
    if(!sec) return;
    window.AAUP_TIMETABLE.pickSection(parts[0], parts[1], sec);
    var box = b.closest('.sc-secs');
    if(box) box.querySelectorAll('[data-sc-pick]').forEach(function(x){
      var on = x === b;
      x.classList.toggle('is-on', on);
      x.textContent = on ? L('In My Week ✓', 'بأسبوعي ✓') : L('Put it in My Week', 'حطها بأسبوعي');
    });
    if(window.__showToast) window.__showToast(L('Section ' + sec.n + ' is in My Week', 'الشعبة ' + sec.n + ' صارت بأسبوعي'));
  });
  function cardChipHtml(course, done){
    var c = course && forCourse(course.id);
    if(!c || !c.offered || done) return '';
    return '<span class="cm-offer' + (offerClash(course) ? ' is-warn' : '') + '">' + esc(chipTx(c.offered)) + '</span>';
  }
  function cards(){ return data().cards || []; }

  if(document.readyState === 'complete') setTimeout(load, 1500);
  else window.addEventListener('load', function(){ setTimeout(load, 1500); });
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) load(); });

  window.AAUP_STAFF_CONTENT = {
    load: load, forCourse: forCourse, offerClash: offerClash, subChipHtml: subChipHtml,
    courseHtml: courseHtml, cardChipHtml: cardChipHtml, cards: cards, noteNow: noteNow
  };
})();
