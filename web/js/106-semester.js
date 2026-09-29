// ==========================
// SEMESTER TOOLS (round 7, ideas 14 and 16).
//
// Reset to official plan: in Edit Mode, each semester of an official plan
// has a button that puts it back the way the university plan has it. Its
// official courses come back to it (with their official hours and names,
// and any that were deleted), courses moved in from elsewhere go back where
// the university has them, and courses the student added there are taken
// out. One toast offers Undo, which restores the plan exactly as it was.
//
// End of semester: once a semester's usual last day has passed, the This
// semester card on Home offers "Finish this semester". One sheet lists its
// courses: tick what you passed, pick each grade, and "Save and move on".
// That replaces ticking on the plan, then opening Grades, then moving on.
// Search finds it too ("end of semester", "انتهى الفصل").
// ==========================
(function(){
  'use strict';

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }
  function plans(){ return (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()) || {}; }
  function toast(m){ if(window.__showToast) window.__showToast(m); }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function savePlan(id, p){
    var all = plans();
    all[id] = p;
    window.AAUP_IMPORTED.saveImportedPlans(all);
    if(window.AAUP_IMPORTED.refresh) window.AAUP_IMPORTED.refresh(id);
  }

  // ---- Reset to official plan ---------------------------------------------------
  function resetSemester(planId, yearId, sem){
    var local = plans()[planId];
    if(!local || !window.AAUP_SYNC || !window.AAUP_SYNC.officialPlan) return;
    window.AAUP_SYNC.officialPlan(planId).then(function(off){
      if(!off){ toast(L('Could not reach the official plan. Check your connection and try again.', 'ما قدرنا نوصل للخطة الرسمية. تأكد من الإنترنت وجرّب كمان مرة.')); return; }
      var before = clone(local), p = clone(local);
      var offById = {}, here = {};
      (off.courses || []).forEach(function(c){ offById[c.id] = c; if(c.yearId === yearId && c.semester === sem) here[c.id] = c; });
      var byId = {};
      p.courses = (p.courses || []).filter(function(c){
        byId[c.id] = c;
        var inThis = c.yearId === yearId && c.semester === sem;
        // Added by the student, sitting in this semester: out.
        return !(inThis && !offById[c.id]);
      });
      p.courses.forEach(function(c){
        var o = offById[c.id];
        if(!o) return;
        var inThis = c.yearId === yearId && c.semester === sem;
        if(here[c.id]){
          c.yearId = o.yearId; c.semester = o.semester;
          c.creditHours = o.creditHours; c.name = o.name; c.ar = o.ar;
          delete c.placedByStudent;
        } else if(inThis){
          // Moved in from elsewhere: back to where the university has it.
          c.yearId = o.yearId; c.semester = o.semester;
          if(!o.yearId) delete c.placedByStudent;
        }
      });
      // Official courses of this semester the student deleted come back.
      Object.keys(here).forEach(function(id){ if(!byId[id]) p.courses.push(clone(here[id])); });
      // Prerequisites: drop ones pointing at courses that are gone, bring
      // back the official ones that touch this semester.
      var ids = {};
      p.courses.forEach(function(c){ ids[c.id] = 1; });
      var key = function(pr){ return pr[0] + '>' + pr[1]; };
      var have = {};
      p.prerequisites = (p.prerequisites || []).filter(function(pr){ return ids[pr[0]] && ids[pr[1]]; });
      p.prerequisites.forEach(function(pr){ have[key(pr)] = 1; });
      (off.prerequisites || []).forEach(function(pr){
        if((here[pr[0]] || here[pr[1]]) && ids[pr[0]] && ids[pr[1]] && !have[key(pr)]){ p.prerequisites.push(pr.slice()); have[key(pr)] = 1; }
      });
      p.wasEdited = true;
      savePlan(planId, p);
      var undo = function(){ savePlan(planId, before); toast(L('Put back as it was', 'رجعت متل ما كانت')); };
      if(window.__showActionToast) window.__showActionToast(L('Semester reset to the official plan', 'الفصل رجع للخطة الرسمية'), L('Undo', 'تراجع'), undo);
      else toast(L('Semester reset to the official plan', 'الفصل رجع للخطة الرسمية'));
    });
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-sem-reset]');
    if(!b) return;
    e.preventDefault(); e.stopPropagation();
    var parts = b.getAttribute('data-sem-reset').split('|');
    resetSemester(b.getAttribute('data-plan'), parts[0], parts[1]);
  }, true);

  // ---- End of semester ----------------------------------------------------------
  // Usual last days (month, day), the same ones the calendar sheet starts
  // from. "Over" means that day has passed within the last 75 days.
  var END = { s1: [1, 20], s2: [6, 10], s3: [8, 20] };
  var DAY = 86400000;
  function termOf(id){
    var ts = window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.thisSemester ? window.AAUP_TASK_HOME.thisSemester(id) : null;
    if(!ts || !ts.list || !ts.list.length) return null;
    var c = ts.list[0];
    var p = plans()[id], yi = 0;
    ((p && p.structure && p.structure.years) || []).forEach(function(y, i){ if(y.id === c.yearId) yi = i + 1; });
    return { list: ts.list, yearId: c.yearId, sem: c.semester, n: yi };
  }
  function isOver(sem){
    var e = END[sem];
    if(!e) return false;
    var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for(var y = now.getFullYear() - 1; y <= now.getFullYear(); y++){
      var end = new Date(y, e[0] - 1, e[1]);
      var since = (today - end) / DAY;
      if(since > 0 && since <= 75) return true;
    }
    return false;
  }
  function label(t){
    var semTx = { s1: L('First semester', 'الفصل الأول'), s2: L('Second semester', 'الفصل الثاني'), s3: L('Summer', 'الصيفي') }[t.sem] || '';
    return (t.n ? L('Year ' + t.n, 'السنة ' + t.n) + ' · ' : '') + semTx;
  }
  function pid(id, slug){ return window.AAUP_GPA && window.AAUP_GPA.primaryId ? window.AAUP_GPA.primaryId(id, slug) : id + '-c-' + slug; }

  // The line on Home's This semester card, only once its usual end has passed.
  function promptHtml(id){
    var t = id && termOf(id);
    if(!t || !isOver(t.sem)) return '';
    return '<button type="button" class="hm-tt-prompt sem-end-prompt" data-sem-end>' +
      esc(L(label(t) + ' is over? Finish it', 'خلص ' + label(t) + '؟ سكّره')) + '</button>';
  }

  var openFor = null, openTerm = null;
  function overlayEl(){
    var el = document.getElementById('semEndOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'semEndOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card sem-end-card" role="dialog" aria-modal="true" aria-labelledby="semEndTitle"><div class="modal-body" id="semEndBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      if(e.target === el || e.target.closest('[data-sem-end-close]')){ el.classList.remove('open'); return; }
      var row = e.target.closest('[data-sem-pass]');
      if(row && !e.target.closest('select')){
        var on = row.getAttribute('aria-pressed') !== 'true';
        row.setAttribute('aria-pressed', String(on));
        var sel = row.querySelector('select');
        if(sel) sel.disabled = !on;
        return;
      }
      if(e.target.closest('[data-sem-end-save]')) save();
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && el.classList.contains('open')) el.classList.remove('open'); });
    return el;
  }
  function open(id){
    id = id || (window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected && window.AAUP_DASHBOARD.getSelected());
    var t = id && termOf(id);
    if(!t){ toast(L('No semester to finish right now.', 'ما في فصل لتسكّره هلق.')); return; }
    openFor = id; openTerm = t;
    var grades = window.AAUP_GPA ? window.AAUP_GPA.loadGrades() : {};
    var order = (window.AAUP_GPA && window.AAUP_GPA.GRADE_ORDER) || [];
    overlayEl().classList.add('open');
    document.getElementById('semEndBody').innerHTML =
      '<div class="dates-head"><h2 class="mh" id="semEndTitle" style="margin:0;">' + esc(L(label(t) + ' is over', 'خلص ' + label(t))) + '</h2>' +
        '<button type="button" class="home-btn btn-quiet btn-sm" data-sem-end-close>' + esc(L('Close', 'إغلاق')) + '</button></div>' +
      '<p class="form-note" style="margin-top:0;">' + esc(L('Untick what you didn\'t pass, and pick each grade you know.', 'شيل الإشارة عن اللي ما نجحت فيه، واختار العلامة اللي بتعرفها.')) + '</p>' +
      '<div class="sem-end-list">' + t.list.map(function(c){
        var g = grades[pid(id, c.id)] || '';
        return '<div class="sem-end-row" role="button" tabindex="0" aria-pressed="true" data-sem-pass="' + esc(c.id) + '">' +
          '<span class="sem-end-tick" aria-hidden="true"></span>' +
          '<span class="sem-end-name">' + esc(ar() && c.ar ? c.ar : c.name) + '<small>' + (parseFloat(c.creditHours) || 0) + L('H', ' س') + '</small></span>' +
          '<select aria-label="' + esc(L('Grade', 'العلامة')) + '"><option value="">' + esc(L('Grade', 'العلامة')) + '</option>' +
            order.map(function(x){ return '<option' + (x === g ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
          '</div>';
      }).join('') + '</div>' +
      '<div class="form-actions"><button type="button" class="home-btn btn-pri" data-sem-end-save>' + esc(L('Save and move on', 'احفظ وكمّل')) + '</button></div>';
  }
  function save(){
    var id = openFor, t = openTerm;
    if(!id || !t) return;
    var prog = window.__getProgress ? window.__getProgress() : {};
    var st = window.AAUP_GPA.loadStatuses(), gr = window.AAUP_GPA.loadGrades();
    var passed = 0;
    Array.prototype.forEach.call(document.querySelectorAll('#semEndBody [data-sem-pass]'), function(row){
      var k = pid(id, row.getAttribute('data-sem-pass'));
      var on = row.getAttribute('aria-pressed') === 'true';
      var g = row.querySelector('select').value;
      delete st[k];                      // no longer "in progress" either way
      if(on){ prog[k] = true; passed++; if(g) gr[k] = g; }
      else { delete prog[k]; }
    });
    window.AAUP_GPA.saveStatuses(st);
    window.AAUP_GPA.saveGrades(gr);
    if(window.__saveProgress) window.__saveProgress(prog);
    overlayEl().classList.remove('open');
    if(window.AAUP_IMPORTED && window.AAUP_IMPORTED.refresh) window.AAUP_IMPORTED.refresh(id);
    if(window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.visible && window.AAUP_TASK_HOME.visible()) window.AAUP_TASK_HOME.render();
    toast(L(passed + ' passed · on to the next semester', passed + ' نجحت فيهم · عالفصل الجاي'));
  }
  document.addEventListener('click', function(e){
    if(e.target.closest && e.target.closest('[data-sem-end]')) open();
  });

  window.AAUP_SEMESTER = { resetSemester: resetSemester, open: open, promptHtml: promptHtml, isOver: isOver };
})();
