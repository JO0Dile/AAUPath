// ==========================
// DATES THAT MATTER — counting down on Home (idea 16).
//
// Three sources, shown together:
//   - the university's own dates (add/drop, midterms, finals…), set by the
//     maintainer in the Developer panel's university editor and shipped in
//     plans.json with the rest of the university record;
//   - the college's dates (midterm week, a deadline), added by its dean on
//     the staff page, for students of that college only (round 10, idea 11;
//     js/111-staff-content.js);
//   - the student's own dates (a quiz, a project deadline), kept on this
//     phone through AAUP_STORAGE, so they follow the profile and Cloud Sync.
//
// Home shows the next two as small tiles ("Add / drop ends · 3 days"); a tap
// opens the full list, where a student adds or removes their own. Past dates
// drop off by themselves, the day after.
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_myDates';
  var DAY = 86400000;

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }

  function today(){ var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parse(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function daysLeft(iso){
    var d = parse(iso);
    return d ? Math.round((d - today()) / DAY) : null;
  }

  function mine(){
    var l = window.AAUP_STORAGE ? window.AAUP_STORAGE.getJSON(KEY, []) : [];
    return Array.isArray(l) ? l : [];
  }
  function saveMine(l){ if(window.AAUP_STORAGE) window.AAUP_STORAGE.setJSON(KEY, l); }

  function universityOf(planId){
    var plans = window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans ? window.AAUP_IMPORTED.loadImportedPlans() : {};
    var p = planId && plans[planId];
    return (p && p.university) || 'aaup';
  }
  function official(planId){
    var u = (window.APP_UNIVERSITIES || {})[universityOf(planId)];
    return (u && Array.isArray(u.dates)) ? u.dates : [];
  }

  // Everything from today on, soonest first. Each item: { label, date, days, own, id }.
  function upcoming(planId){
    var out = [];
    official(planId).forEach(function(d){
      var n = daysLeft(d.date);
      if(n === null || n < 0) return;
      out.push({ label: ar() && d.ar ? d.ar : d.en, date: d.date, days: n, own: false });
    });
    var sc = window.AAUP_STAFF_CONTENT;
    (sc && sc.collegeDates && planId ? sc.collegeDates(planId) : []).forEach(function(d){
      var n = daysLeft(d.date);
      if(n === null || n < 0) return;
      out.push({ label: d.label, date: d.date, days: n, own: false, college: d.college || '' });
    });
    mine().forEach(function(d){
      var n = daysLeft(d.date);
      if(n === null || n < 0) return;
      out.push({ label: d.label, date: d.date, days: n, own: true, id: d.id });
    });
    return out.sort(function(a, b){ return a.days - b.days; });
  }

  function whenTx(n){
    if(n === 0) return L('today', 'اليوم');
    if(n === 1) return L('tomorrow', 'بكرا');
    if(ar()) return n <= 10 ? (n + ' أيام') : (n + ' يوم');
    return n + ' days';
  }
  function dateTx(iso){
    var d = parse(iso);
    return d ? d.toLocaleDateString(ar() ? 'ar' : 'en', { weekday: 'short', day: 'numeric', month: 'short' }) : iso;
  }

  // The two tiles on Home. With no dates at all, one quiet button to add
  // your own, so the feature can be found before the university's are in.
  function homeHtml(planId){
    var list = upcoming(planId);
    if(!list.length){
      return '<button type="button" class="hm-dates-empty" data-dates-open>' +
        (window.AAUP_ICONS ? window.AAUP_ICONS.preview('calendar', 16) : '') + esc(L('Add a date to count down to', 'ضيف تاريخ تعدّ الأيام عليه')) + '</button>';
    }
    return '<div class="hm-dates" role="list">' + list.slice(0, 2).map(function(d){
      return '<button type="button" class="hm-date' + (d.days <= 3 ? ' is-soon' : '') + (d.college ? ' is-college' : '') + '" role="listitem" data-dates-open>' +
        '<span class="hm-date-what">' + esc(d.label) + '</span>' +
        '<span class="hm-date-row"><b class="hm-date-n">' + esc(whenTx(d.days)) + '</b>' +
          (d.college ? '<span class="hm-date-tag" title="' + esc(d.college) + '">' + esc(L('Your college', 'كليتك')) + '</span>' : '') + '</span></button>';
    }).join('') + '</div>';
  }

  // ---- the full list --------------------------------------------------------
  var openFor = null;
  function overlayEl(){
    var el = document.getElementById('datesOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'datesOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card dates-card" role="dialog" aria-modal="true" aria-labelledby="datesTitle"><div class="modal-body" id="datesBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      if(e.target === el || e.target.closest('[data-dates-close]')){ close(); return; }
      var del = e.target.closest('[data-date-del]');
      if(del){
        var id = del.getAttribute('data-date-del');
        saveMine(mine().filter(function(d){ return d.id !== id; }));
        render(); refreshHome();
        return;
      }
      if(e.target.closest('[data-date-add]')){
        var lab = document.getElementById('datesNewLabel'), dt = document.getElementById('datesNewDate');
        var err = document.getElementById('datesErr');
        var label = (lab.value || '').trim().slice(0, 60), date = dt.value;
        if(!label || !date){ err.textContent = L('Write what it is and pick the date.', 'اكتب شو هو واختار التاريخ.'); err.hidden = false; return; }
        if(daysLeft(date) < 0){ err.textContent = L('That date has already passed.', 'هالتاريخ صار ورا.'); err.hidden = false; return; }
        var l = mine();
        l.push({ id: 'd' + Date.now().toString(36), label: label, date: date });
        saveMine(l);
        render(); refreshHome();
      }
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && el.classList.contains('open')) close(); });
    return el;
  }
  function close(){ var el = document.getElementById('datesOverlay'); if(el) el.classList.remove('open'); }
  function render(){
    var body = document.getElementById('datesBody');
    if(!body) return;
    var list = upcoming(openFor);
    var todayIso = new Date(today().getTime() - today().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    body.innerHTML =
      '<div class="dates-head"><h2 class="mh" id="datesTitle" style="margin:0;">' + (window.AAUP_ICONS ? window.AAUP_ICONS.preview('calendar', 20) : '') + esc(L('Dates that matter', 'تواريخ مهمة')) + '</h2>' +
      '<button type="button" class="home-btn btn-quiet btn-sm" data-dates-close>' + esc(L('Close', 'إغلاق')) + '</button></div>' +
      (list.length
        ? '<div class="dates-list">' + list.map(function(d){
            return '<div class="dates-row' + (d.days <= 3 ? ' is-soon' : '') + '">' +
              '<div class="dates-tx"><b>' + esc(d.label) + '</b><span>' + esc(dateTx(d.date)) + (d.own ? ' · ' + esc(L('yours', 'إلك')) : '') + (d.college ? ' · ' + esc(d.college) : '') + '</span></div>' +
              '<b class="dates-n">' + esc(whenTx(d.days)) + '</b>' +
              (d.own ? '<button type="button" class="dates-del" data-date-del="' + esc(d.id) + '" aria-label="' + esc(L('Remove', 'احذف')) + '">×</button>' : '') +
              '</div>';
          }).join('') + '</div>'
        : '<p class="form-note">' + esc(L('No dates yet. The university\'s dates show here once they are added; you can add your own below.', 'لسا ما في تواريخ. تواريخ الجامعة بتظهر هون لما تنضاف، وبتقدر تضيف تبعك تحت.')) + '</p>') +
      '<div class="dates-add"><b>' + esc(L('Add your own', 'ضيف تاريخ إلك')) + '</b>' +
        '<div class="form-field"><input type="text" id="datesNewLabel" maxlength="60" placeholder="' + esc(L('e.g. Calculus II quiz', 'مثلًا: كويز تفاضل 2')) + '"></div>' +
        '<div class="form-field"><input type="date" id="datesNewDate" min="' + todayIso + '"></div>' +
        '<p class="dev-error-msg" id="datesErr" hidden></p>' +
        '<div class="form-actions" style="justify-content:flex-start;"><button type="button" class="home-btn btn-pri" data-date-add>' + esc(L('Add', 'ضيف')) + '</button></div>' +
      '</div>';
  }
  function open(planId){
    openFor = planId || (window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected && window.AAUP_DASHBOARD.getSelected());
    overlayEl().classList.add('open');
    render();
  }
  function refreshHome(){
    if(window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.visible && window.AAUP_TASK_HOME.visible()) window.AAUP_TASK_HOME.render();
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-dates-open]');
    if(b) open();
  });

  window.AAUP_DATES = { upcoming: upcoming, homeHtml: homeHtml, open: open };
})();
