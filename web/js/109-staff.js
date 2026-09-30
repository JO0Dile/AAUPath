// ==========================
// FOR DEANS AND PROFESSORS (round 8, ideas 19, 20, 21).
//
// 19  A read-only page for staff: pick a major and see its whole official
//     plan on one screen, year by year, with each semester's hours. Courses
//     that many later courses depend on are marked ("opens 7"). Nothing can
//     be edited and nobody signs in. Open it with the app's address + #staff
//     (or #staff=<major id>), which is the link to give them.
// 20  Click a course: what it needs, what it opens, and how many students
//     using AAUPath have passed it, are taking it now, or have it planned.
//     Counts only, from the cloud worker (/api/stats/plan); under 5 shows as
//     "fewer than 5".
// 21  Present: the plan big enough for a projector, one year at a time,
//     arrow keys to move. Also from Ctrl+K for a student's own plan.
// ==========================
(function(){
  'use strict';

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }
  var decoder = document.createElement('textarea');
  function plain(s){ decoder.innerHTML = String(s == null ? '' : s); return decoder.value; }
  // The published plans (plans.json), never the viewer's own copy: a
  // student's copy carries their own moves, retakes and placed electives,
  // and staff must see the plan as the college publishes it. The phone's
  // copy is only a stand-in for the moment before the file arrives.
  var official = null, officialAsked = false;
  function loadOfficial(){
    if(officialAsked || !window.fetch) return;
    officialAsked = true;
    fetch(window.APP_PLANS_FEED_URL || 'plans.json').then(function(r){ return r.json(); }).then(function(d){
      var m = {};
      (d.plans || []).forEach(function(p){ if(p && p.id) m[p.id] = p; });
      official = m;
      if(view && view.classList.contains('open')) render();
    }).catch(function(){ officialAsked = false; });
  }
  function plans(){
    loadOfficial();
    return official || (window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans() : {});
  }
  function nameOf(p){
    var mn = (p && p.majorName) || {};
    var pick = typeof mn === 'string' ? mn : ((ar() && mn.ar) || mn.en || '');
    if(pick && typeof pick === 'object') pick = [pick.big, pick.small].filter(Boolean).join(' ');
    return plain(pick);
  }
  function courseName(c){ return plain(ar() && c.ar ? c.ar : c.name); }
  var SEM = { s1: ['First semester', 'الفصل الأول'], s2: ['Second semester', 'الفصل الثاني'], s3: ['Summer', 'الصيفي'] };
  function semName(s){ var x = SEM[s] || [s, s]; return L(x[0], x[1]); }

  // Everything that sits after a course in the prerequisite chain.
  function graph(p){
    var next = {}, prev = {};
    (p.prerequisites || []).forEach(function(pr){
      (next[pr[0]] = next[pr[0]] || []).push(pr[1]);
      (prev[pr[1]] = prev[pr[1]] || []).push(pr[0]);
    });
    var opensAll = function(slug){
      var seen = {}, stack = (next[slug] || []).slice();
      while(stack.length){ var s = stack.pop(); if(seen[s]) continue; seen[s] = 1; (next[s] || []).forEach(function(x){ stack.push(x); }); }
      return Object.keys(seen);
    };
    return { next: next, prev: prev, opensAll: opensAll };
  }
  function yearsOf(p){
    var byId = {};
    (p.courses || []).forEach(function(c){
      if(!c.yearId || !c.semester) return;
      var y = byId[c.yearId] || (byId[c.yearId] = {});
      (y[c.semester] = y[c.semester] || []).push(c);
    });
    return ((p.structure && p.structure.years) || []).map(function(y, i){
      var sems = ['s1', 's2', 's3'].filter(function(s){ return byId[y.id] && byId[y.id][s] && byId[y.id][s].length; })
        .map(function(s){ return { s: s, list: byId[y.id][s] }; });
      return { n: i + 1, id: y.id, sems: sems };
    }).filter(function(y){ return y.sems.length; });
  }
  function hours(list){ return list.reduce(function(n, c){ return n + (parseFloat(c.creditHours) || 0); }, 0); }

  // ---- 19 · the page ------------------------------------------------------------------
  var view = null, current = null, statsFor = {};
  function majors(){
    var all = plans();
    return Object.keys(all).filter(function(id){
      var p = all[id];
      return p && p.structure && Array.isArray(p.structure.years) && (p.courses || []).length;
    }).map(function(id){ return { id: id, name: nameOf(all[id]) || id }; })
      .sort(function(a, b){ return a.name.localeCompare(b.name, ar() ? 'ar' : 'en'); });
  }
  function open(planId){
    var list = majors();
    if(!list.length) return;
    var known = function(id){ return list.some(function(m){ return m.id === id; }); };
    current = planId && known(planId) ? planId : (current && known(current) ? current : list[0].id);
    var wiz = document.getElementById('onboardingWizardOverlay');
    if(wiz) wiz.remove();
    if(!view){
      view = document.createElement('div');
      view.id = 'staffView';
      view.className = 'stf';
      view.setAttribute('role', 'dialog');
      view.setAttribute('aria-modal', 'true');
      document.body.appendChild(view);
      view.addEventListener('click', onClick);
      view.addEventListener('change', function(e){
        if(e.target.id === 'stfMajor'){ current = e.target.value; setHash(); render(); }
      });
    }
    view.classList.add('open');
    document.documentElement.classList.add('stf-open');
    if(window.AAUP_STAFF_ROOM) window.AAUP_STAFF_ROOM.loadMe();
    render();
  }
  function close(){
    if(view) view.classList.remove('open');
    document.documentElement.classList.remove('stf-open');
    if(/^#staff/.test(location.hash)){ try{ history.replaceState(history.state, '', location.pathname + location.search); }catch(e){} }
  }
  function setHash(){ try{ history.replaceState(history.state, '', '#staff=' + current); }catch(e){} }
  function render(){
    var p = plans()[current];
    if(!p){ close(); return; }
    var g = graph(p), years = yearsOf(p);
    var total = hours(p.courses || []);
    var R = window.AAUP_STAFF_ROOM;
    var role = R ? R.pillHtml() : '';
    view.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    view.setAttribute('aria-label', L('AAUPath for staff', 'AAUPath للكادر'));
    view.innerHTML =
      '<header class="stf-head">' +
        '<div class="stf-brand"><b>AAUPath</b><span>' + esc(L('for staff', 'للكادر')) + '</span>' + (role || '<span class="stf-pill">' + esc(L('Read only', 'للقراءة فقط')) + '</span>') + '</div>' +
        '<label class="stf-pick"><span>' + esc(L('Major', 'التخصص')) + '</span><select id="stfMajor">' + majors().map(function(m){
          return '<option value="' + esc(m.id) + '"' + (m.id === current ? ' selected' : '') + '>' + esc(m.name) + '</option>';
        }).join('') + '</select></label>' +
        '<div class="stf-actions">' +
          (R ? R.actionsHtml() : '') +
          '<button type="button" class="stf-btn stf-pri" data-stf="present">' + esc(L('Present', 'اعرض على الشاشة')) + '</button>' +
          '<button type="button" class="stf-btn" data-stf="link">' + esc(L('Copy link', 'انسخ الرابط')) + '</button>' +
          '<button type="button" class="stf-btn" data-stf="lang">' + esc(L('العربية', 'English')) + '</button>' +
          '<button type="button" class="stf-x" data-stf="close" aria-label="' + esc(L('Close', 'إغلاق')) + '">×</button>' +
        '</div>' +
      '</header>' +
      '<div class="stf-sum">' + esc(L(total + ' hours · ' + years.length + ' years · ' + (p.courses || []).length + ' courses',
                                        total + ' ساعة · ' + years.length + ' سنوات · ' + (p.courses || []).length + ' مساق')) +
        '<span class="stf-key"><i></i>' + esc(L('Many later courses depend on it', 'مواد كثير بتعتمد عليه')) + '</span></div>' +
      '<div class="stf-body"><div class="stf-years">' + years.map(function(y){
        return '<section class="stf-year"><h2>' + esc(L('Year ' + y.n, 'السنة ' + y.n)) +
          '<span>' + hours([].concat.apply([], y.sems.map(function(s){ return s.list; }))) + L('H', ' س') + '</span></h2>' +
          y.sems.map(function(s){
            return '<div class="stf-sem"><h3>' + esc(semName(s.s)) + '<span>' + hours(s.list) + L('H', ' س') + '</span></h3>' +
              s.list.map(function(c){
                var n = g.opensAll(c.id).length;
                return '<button type="button" class="stf-c' + (n >= 4 ? ' is-key' : '') + (c.id === openCourse ? ' is-on' : '') + '" data-stf-c="' + esc(c.id) + '">' +
                  '<span>' + esc(courseName(c)) + '</span><small>' + (parseFloat(c.creditHours) || 0) + L('H', ' س') +
                  (n >= 4 ? ' · ' + esc(L('opens ' + n, 'بيفتح ' + n)) : '') + '</small></button>';
              }).join('') + '</div>';
          }).join('') + '</section>';
      }).join('') + '</div>' +
      (openCourse ? detailHtml(p, g) : (R ? R.panelHtml() : '')) + '</div>' +
      (R ? R.dialogHtml() : '');
    if(R) R.afterRender(view);
  }

  // ---- 20 · one course, with the counts ----------------------------------------------
  var openCourse = null;
  function detailHtml(p, g){
    var c = (p.courses || []).filter(function(x){ return x.id === openCourse; })[0];
    if(!c) return '';
    var byId = {};
    (p.courses || []).forEach(function(x){ byId[x.id] = x; });
    var names = function(list){ return list.map(function(s){ return byId[s] ? courseName(byId[s]) : s; }); };
    var needs = names(g.prev[c.id] || []), opens = names(g.opensAll(c.id));
    var st = statsFor[current];
    var count = function(v){ return v == null ? '<span class="stf-few">' + esc(L('fewer than 5', 'أقل من 5')) + '</span>' : '<b>' + v + '</b>'; };
    var stats;
    if(!window.APP_CLOUD_URL) stats = '';
    else if(!st) stats = '<p class="stf-muted">' + esc(L('Counting…', 'عم نعدّ…')) + '</p>';
    else if(st.error) stats = '<p class="stf-muted">' + esc(L('Couldn’t reach the counts right now.', 'ما قدرنا نجيب الأعداد هلق.')) + '</p>';
    else if(st.tooFew) stats = '<p class="stf-muted">' + esc(L('Not enough students of this major use AAUPath yet to show counts.', 'لسا ما في طلاب كفاية من هالتخصص على AAUPath لنعرض أعداد.')) + '</p>';
    else {
      var cc = (st.courses || {})[c.id] || { passed: null, now: null, planned: null };
      stats = '<div class="stf-counts">' +
        '<div><span>' + esc(L('Planned', 'مخططين إلها')) + '</span>' + count(cc.planned) + '</div>' +
        '<div><span>' + esc(L('Taking it now', 'بياخدوها هلق')) + '</span>' + count(cc.now) + '</div>' +
        '<div><span>' + esc(L('Passed', 'نجحوا فيها')) + '</span>' + count(cc.passed) + '</div></div>' +
        '<p class="stf-muted">' + esc(L('Out of ' + st.students + ' students of this major who use AAUPath. Counts only, never names.',
                                          'من أصل ' + st.students + ' طالب من هالتخصص بيستعملوا AAUPath. أعداد بس، بدون أسماء.')) + '</p>';
    }
    return '<aside class="stf-detail"><div class="stf-detail-h"><b>' + esc(courseName(c)) + '</b>' +
        '<button type="button" class="stf-x" data-stf="shut" aria-label="' + esc(L('Close', 'إغلاق')) + '">×</button></div>' +
      '<p class="stf-muted">' + esc((parseFloat(c.creditHours) || 0) + L(' hours', ' ساعات') + (c.yearId ? ' · ' + L('Year ', 'السنة ') + c.yearId.replace(/^y/, '') + ' · ' + semName(c.semester) : '')) + '</p>' +
      '<h4>' + esc(L('Needs', 'بيحتاج')) + '</h4><p>' + (needs.length ? esc(needs.join(L(', ', '، '))) : esc(L('Nothing', 'ولا إشي'))) + '</p>' +
      '<h4>' + esc(L('Opens', 'بيفتح')) + (opens.length ? ' (' + opens.length + ')' : '') + '</h4><p>' + (opens.length ? esc(opens.slice(0, 12).join(L(', ', '، '))) + (opens.length > 12 ? '…' : '') : esc(L('Nothing', 'ولا إشي'))) + '</p>' +
      (stats ? '<h4>' + esc(L('Students', 'الطلاب')) + '</h4>' + stats : '') +
      (window.AAUP_STAFF_ROOM ? window.AAUP_STAFF_ROOM.courseEditHtml(c) : '') +
    '</aside>';
  }
  function loadStats(planId){
    if(statsFor[planId] || !window.APP_CLOUD_URL || !window.fetch) return;
    statsFor[planId] = null;
    fetch(window.APP_CLOUD_URL + '/api/stats/plan?plan=' + encodeURIComponent(planId))
      .then(function(r){ return r.json(); })
      .then(function(j){ statsFor[planId] = j && j.ok ? j : { error: true }; })
      .catch(function(){ statsFor[planId] = { error: true }; })
      .then(function(){ if(view && view.classList.contains('open') && current === planId) render(); });
  }

  function onClick(e){
    if(window.AAUP_STAFF_ROOM && window.AAUP_STAFF_ROOM.onClick(e)) return;
    var b = e.target.closest('[data-stf], [data-stf-c]');
    if(!b) return;
    var act = b.getAttribute('data-stf');
    if(b.hasAttribute('data-stf-c')){ openCourse = b.getAttribute('data-stf-c'); loadStats(current); render(); return; }
    if(act === 'shut'){ openCourse = null; render(); return; }
    if(act === 'close'){ close(); return; }
    if(act === 'present'){ present(current); return; }
    if(act === 'lang'){ if(window.AAUP_LANG) window.AAUP_LANG.toggle(); render(); return; }
    if(act === 'link'){
      var link = location.origin + location.pathname + '#staff=' + current;
      var done = function(){ if(window.__showToast) window.__showToast(L('Link copied', 'انتسخ الرابط')); };
      if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function(){ window.prompt(L('Copy this link', 'انسخ هالرابط'), link); });
      else window.prompt(L('Copy this link', 'انسخ هالرابط'), link);
    }
  }

  // ---- 21 · present ----------------------------------------------------------------
  var show = null, showAt = 0, showPlan = null;
  function present(planId){
    var p = plans()[planId];
    if(!p) return;
    showPlan = planId; showAt = 0;
    if(!show){
      show = document.createElement('div');
      show.className = 'stf-show';
      show.setAttribute('role', 'dialog');
      show.setAttribute('aria-modal', 'true');
      document.body.appendChild(show);
      show.addEventListener('click', function(e){
        var b = e.target.closest('[data-show]');
        if(!b) return;
        var a = b.getAttribute('data-show');
        if(a === 'prev') step(-1); else if(a === 'next') step(1); else if(a === 'end') endShow();
      });
    }
    show.classList.add('open');
    try{ if(show.requestFullscreen) show.requestFullscreen().catch(function(){}); }catch(err){}
    drawShow();
  }
  function step(n){
    var years = yearsOf(plans()[showPlan] || {});
    showAt = Math.max(0, Math.min(years.length - 1, showAt + n));
    drawShow();
  }
  function endShow(){
    if(show) show.classList.remove('open');
    try{ if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){}); }catch(err){}
  }
  function drawShow(){
    var p = plans()[showPlan];
    if(!p){ endShow(); return; }
    var years = yearsOf(p), y = years[showAt];
    if(!y){ endShow(); return; }
    var g = graph(p);
    show.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    show.setAttribute('aria-label', nameOf(p));
    var all = [].concat.apply([], y.sems.map(function(s){ return s.list; }));
    show.innerHTML = '<div class="stf-show-top"><span>' + esc(nameOf(p)) + '</span>' +
        '<button type="button" class="stf-x" data-show="end" aria-label="' + esc(L('End', 'إنهاء')) + '">×</button></div>' +
      '<h2>' + esc(L('Year ' + y.n, 'السنة ' + y.n)) + '</h2>' +
      '<p class="stf-show-sub">' + esc(L(hours(all) + ' hours · ' + y.sems.length + (y.sems.length === 1 ? ' semester' : ' semesters'),
                                         hours(all) + ' ساعة · ' + y.sems.length + ' فصول')) + '</p>' +
      y.sems.map(function(s){
        return '<div class="stf-show-sem"><h3>' + esc(semName(s.s)) + ' · ' + hours(s.list) + L('H', ' س') + '</h3><div class="stf-show-grid">' +
          s.list.map(function(c){
            var n = g.opensAll(c.id).length;
            return '<div class="stf-show-c' + (n >= 4 ? ' is-key' : '') + '"><b>' + esc(courseName(c)) + '</b><span>' + (parseFloat(c.creditHours) || 0) + L(' hours', ' ساعات') + '</span></div>';
          }).join('') + '</div></div>';
      }).join('') +
      '<div class="stf-show-nav">' +
        '<button type="button" class="stf-btn" data-show="prev"' + (showAt === 0 ? ' disabled' : '') + '>' + esc(L('← Year ' + (y.n - 1), '→ السنة ' + (y.n - 1))) + '</button>' +
        '<span>' + (showAt + 1) + ' / ' + years.length + '</span>' +
        '<button type="button" class="stf-btn stf-pri" data-show="next"' + (showAt >= years.length - 1 ? ' disabled' : '') + '>' + esc(L('Year ' + (y.n + 1) + ' →', 'السنة ' + (y.n + 1) + ' ←')) + '</button>' +
      '</div>';
  }
  document.addEventListener('keydown', function(e){
    if(show && show.classList.contains('open')){
      var fwd = ar() ? 'ArrowLeft' : 'ArrowRight', back = ar() ? 'ArrowRight' : 'ArrowLeft';
      if(e.key === fwd || e.key === ' ' || e.key === 'PageDown'){ e.preventDefault(); step(1); }
      else if(e.key === back || e.key === 'PageUp'){ e.preventDefault(); step(-1); }
      else if(e.key === 'Escape'){ e.preventDefault(); endShow(); }
      return;
    }
    if(view && view.classList.contains('open') && window.AAUP_STAFF_ROOM && window.AAUP_STAFF_ROOM.onKey(e)){ e.preventDefault(); return; }
    if(view && view.classList.contains('open') && e.key === 'Escape'){
      if(openCourse){ openCourse = null; render(); } else close();
    }
  });
  document.addEventListener('fullscreenchange', function(){ if(!document.fullscreenElement && show && show.classList.contains('open')) show.classList.remove('open'); });

  // ---- the link ----------------------------------------------------------------------
  function fromHash(){
    var m = /^#staff(?:=([a-z0-9-]+))?$/.exec(location.hash || '');
    if(!m) return false;
    // Plans arrive a moment after the page loads on a first visit.
    var tries = 0;
    (function wait(){
      if(majors().length){ open(m[1]); return; }
      if(++tries < 40) setTimeout(wait, 150);
    })();
    return true;
  }
  window.addEventListener('hashchange', fromHash);
  if(document.readyState === 'complete') fromHash(); else window.addEventListener('load', fromHash);

  window.AAUP_STAFF = { open: open, close: close, present: present,
    refresh: function(){ if(view && view.classList.contains('open')) render(); },
    current: function(){ return current; }, plans: plans };
})();
