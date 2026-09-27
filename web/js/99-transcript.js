// ==========================
// UNOFFICIAL TRANSCRIPT — every passed course, semester by semester, with
// each semester's GPA and the cumulative one, on a plain light page that
// prints or saves as a PDF (idea 14). Marked "unofficial" at the top and
// the bottom: it is the student's own record from this app, not the
// registrar's.
//
// The cumulative GPA is AAUP_GPA.gpaFor's, the same number the Grades
// screen shows, so the two can never disagree. A semester's own GPA counts
// each course once through its primary half, as gpaFor does.
// ==========================
(function(){
  'use strict';

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }
  var SEM = { s1: ['First semester', 'الفصل الأول'], s2: ['Second semester', 'الفصل الثاني'], s3: ['Summer', 'الصيفي'] };

  function build(prefix, r){
    var G = window.AAUP_GPA;
    var p = (window.AAUP_IMPORTED.loadImportedPlans() || {})[prefix];
    if(!p) return '';
    var progress = window.__getProgress ? window.__getProgress() : {};
    var grades = G.loadGrades();
    var full = function(slug){ return prefix + '-c-' + slug; };
    var passed = (p.courses || []).filter(function(c){ return progress[full(c.id)]; });
    var terms = [];
    (p.structure && p.structure.years || []).forEach(function(y, i){
      ['s1', 's2', 's3'].forEach(function(s){ terms.push({ y: y.id, s: s, n: i + 1 }); });
    });
    var used = {};
    var groups = terms.map(function(t){
      var rows = passed.filter(function(c){ return c.yearId === t.y && c.semester === t.s; });
      rows.forEach(function(c){ used[c.id] = 1; });
      return { label: r ? ('السنة ' + t.n + ' · ' + SEM[t.s][1]) : ('Year ' + t.n + ' · ' + SEM[t.s][0]), rows: rows };
    }).filter(function(g){ return g.rows.length; });
    var other = passed.filter(function(c){ return !used[c.id]; });
    if(other.length) groups.push({ label: r ? 'مساقات أخرى' : 'Other courses', rows: other });

    var totalHours = 0;
    var body = groups.map(function(g){
      var pts = 0, cr = 0;
      var lines = g.rows.map(function(c){
        var pid = G.primaryId ? G.primaryId(prefix, c.id) : full(c.id);
        var gr = grades[pid] || '';
        var h = parseFloat(c.creditHours) || 0;
        totalHours += h;
        if(pid === full(c.id) && G.isRealGrade(gr)){ pts += G.GRADE_POINTS[gr] * h; cr += h; }
        var nm = r && c.ar ? c.ar : c.name;
        var code = c.num || c.courseNumber || '';
        if(code === '-') code = '';
        return '<tr><td class="tr-n tr-code">' + esc(code) + '</td><td>' + esc(nm) + '</td><td class="tr-n">' + h + '</td><td class="tr-n">' + esc(gr || '—') + '</td></tr>';
      }).join('');
      return '<section class="tr-sem"><h3>' + esc(g.label) + '</h3>' +
        '<table><thead><tr><th>' + (r ? 'الرقم' : 'Code') + '</th><th>' + (r ? 'المساق' : 'Course') + '</th><th class="tr-n">' + (r ? 'ساعات' : 'Hours') + '</th><th class="tr-n">' + (r ? 'العلامة' : 'Grade') + '</th></tr></thead>' +
        '<tbody>' + lines + '</tbody>' +
        (cr ? '<tfoot><tr><td></td><td>' + (r ? 'معدل الفصل' : 'Semester GPA') + '</td><td></td><td class="tr-n"><b>' + (pts / cr).toFixed(2) + '</b></td></tr></tfoot>' : '') +
        '</table></section>';
    }).join('');
    var cum = G.gpaFor ? G.gpaFor(prefix).gpa : null;
    var major = (p.majorName && (r ? (p.majorName.ar || p.majorName.en) : p.majorName.en)) || prefix;
    var np = window.AAUP_IMPORTED.nameParts;
    if(np) major = np(major).big || major;
    return '<div class="tr-sheet" dir="' + (r ? 'rtl' : 'ltr') + '">' +
      '<div class="tr-head"><div class="tr-uni">' + (r ? 'الجامعة العربية الأمريكية' : 'Arab American University') + '</div>' +
      '<h2>' + (r ? 'كشف علامات غير رسمي' : 'Unofficial transcript') + '</h2>' +
      '<div class="tr-major">' + esc(major) + '</div></div>' +
      (groups.length ? body : '<p class="tr-empty">' + (r ? 'ما في مساقات منجزة بعد.' : 'No passed courses yet.') + '</p>') +
      '<div class="tr-total"><span>' + (r ? 'الساعات المنجزة' : 'Hours passed') + ' <b>' + totalHours + '</b></span>' +
        (cum != null ? '<span>' + (r ? 'المعدل التراكمي' : 'Cumulative GPA') + ' <b>' + cum.toFixed(2) + '</b></span>' : '') + '</div>' +
      '<p class="tr-foot">' + (r ? 'غير رسمي · من سجلّك بتطبيق AAUPath، مش من دائرة القبول والتسجيل. ' : 'Unofficial · from your own record in AAUPath, not from the Registrar. ') +
        esc(new Date().toLocaleDateString(r ? 'ar' : 'en', { year: 'numeric', month: 'long', day: 'numeric' })) + '</p>' +
      '</div>';
  }

  function overlayEl(){
    var el = document.getElementById('transcriptOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'transcriptOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card tr-card" role="dialog" aria-modal="true" aria-label="Unofficial transcript">' +
      '<div class="tr-actions"><button type="button" class="home-btn btn-quiet btn-sm" data-tr-close></button><button type="button" class="home-btn btn-pri btn-sm" data-tr-print></button></div>' +
      '<div id="transcriptRoot"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      if(e.target === el || e.target.closest('[data-tr-close]')){ el.classList.remove('open'); return; }
      if(e.target.closest('[data-tr-print]')){
        document.body.classList.add('printing-transcript');
        var done = function(){ document.body.classList.remove('printing-transcript'); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        window.print();
        setTimeout(done, 1500);
      }
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') el.classList.remove('open'); });
    return el;
  }
  function open(prefix){
    var r = ar(), el = overlayEl();
    el.querySelector('[data-tr-close]').textContent = r ? 'إغلاق' : 'Close';
    el.querySelector('[data-tr-print]').textContent = r ? 'احفظ PDF أو اطبع' : 'Save as PDF or print';
    document.getElementById('transcriptRoot').innerHTML = build(prefix, r);
    el.classList.add('open');
  }
  function buttonHtml(prefix, r){
    // Wired on the button itself: the Grades window handles its own clicks
    // and a delegated listener on the document never heard this one.
    return '<div class="tr-open-row"><button type="button" class="home-btn" data-transcript-open="' + esc(prefix) + '" onclick="AAUP_TRANSCRIPT.open(this.getAttribute(\'data-transcript-open\'))">' +
      window.AAUP_ICONS.preview('printer', 14) + (r ? 'كشف علامات غير رسمي' : 'Unofficial transcript') + '</button></div>';
  }
  window.AAUP_TRANSCRIPT = { open: open, buttonHtml: buttonHtml };
})();
