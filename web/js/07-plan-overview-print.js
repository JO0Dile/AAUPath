// ==========================
// PLAN OVERVIEW & PRINT — a compact, all-semesters-at-once view of the whole
// plan that doubles as a print-friendly layout for an advising meeting
// (Export already produces JSON, but nobody hands an advisor a JSON file).
// Reads the currently-rendered plan page — which exists for both built-in
// majors (always in the DOM) and imported plans (rendered on open) — plus
// window.__PLAN_DATA for credit hours and the grades map, so one code path
// covers every plan type.
// ==========================
(function(){
  var esc = window.__escapeHtml;

  function splitId(id){ return window.__splitCourseId ? window.__splitCourseId(id) : null; }

  function buildModel(prefix){
    var root = document.getElementById('page-' + prefix);
    if(!root) return null;
    // The Overview is opened from Share, which can be reached with the plan
    // page not rendered — and then the class is absent and the whole sheet
    // came out in English.
    var rtl = root.classList.contains('rtl-mode') ||
      !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var grades = (window.AAUP_GPA && window.AAUP_GPA.loadGrades) ? window.AAUP_GPA.loadGrades() : {};
    var progress = window.__getProgress ? window.__getProgress() : {};

    // Built-in majors nest .year-row > .semesters > .sem; imported plans use
    // .imp-year-block > .imp-semester-block. Normalize both to the same shape.
    var builtInYears = root.querySelectorAll('.year-row');
    var years = [];
    if(builtInYears.length){
      Array.prototype.slice.call(builtInYears).forEach(function(yr){
        var label = (yr.querySelector('.year-badge .label') || {}).textContent || '';
        var sems = [];
        yr.querySelectorAll('.sem').forEach(function(sem){
          var semLabel = (sem.querySelector('.sem-label') || {}).textContent || '';
          sems.push({ label: semLabel.replace(/\s+/g, ' ').trim(), courses: collectCourses(sem, info, grades, progress, prefix, rtl) });
        });
        years.push({ label: label.replace(/\s+/g, ' ').trim(), semesters: sems });
      });
    } else {
      Array.prototype.slice.call(root.querySelectorAll('.imp-year-block')).forEach(function(yb){
        var label = (yb.querySelector('.imp-year-header h3') || {}).textContent || '';
        var sems = [];
        yb.querySelectorAll('.imp-semester-block').forEach(function(sb){
          var semLabel = (sb.querySelector('.imp-semester-title') || {}).textContent || '';
          sems.push({ label: semLabel.replace(/\s+/g, ' ').trim(), courses: collectCourses(sb, info, grades, progress, prefix, rtl) });
        });
        years.push({ label: label.replace(/\s+/g, ' ').trim(), semesters: sems });
      });
    }
    return { rtl: rtl, years: years };
  }

  function collectCourses(container, info, grades, progress, prefix, rtl){
    var out = [];
    container.querySelectorAll('.course[id]:not(.course-removed)').forEach(function(el){
      var parts = splitId(el.id);
      if(!parts) return;
      var nameEl = el.querySelector('.name');
      var name = nameEl ? nameEl.textContent.replace(/\s*✓\s*$/, '').trim() : parts.slug;
      var meta = info[parts.slug] || {};
      var cr = meta.cr != null ? meta.cr : '';
      var pid = (window.AAUP_GPA && window.AAUP_GPA.primaryId) ? window.AAUP_GPA.primaryId(prefix, parts.slug) : el.id;
      var grade = grades[pid] || '';
      var needs = ((window.__PLAN_DATA[prefix] || {}).needsMap || {})[parts.slug] || [];
      out.push({ name: name, credits: cr, done: !!progress[el.id], grade: grade,
                 code: meta.num || '',
                 needs: needs.map(function(n){ return (info[n] && info[n].name) || n; }) });
    });
    return out;
  }

  function planHeader(prefix, rtl){
    var dash = window.AAUP_DASHBOARD;
    var info = dash && dash.planDisplayInfo ? dash.planDisplayInfo(prefix) : { icon: '🎓', name: prefix };
    var student = window.AAUP_STUDENT ? window.AAUP_STUDENT.get() : null;
    var stats = window.__computeStats ? (function(){ try{ return window.__computeStats(prefix); }catch(e){ return null; } })() : null;
    var gpaObj = (window.AAUP_GPA && window.AAUP_GPA.gpaFor) ? (function(){ try{ return window.AAUP_GPA.gpaFor(prefix); }catch(e){ return null; } })() : null;
    var gpa = gpaObj && gpaObj.gpa != null ? gpaObj.gpa.toFixed(2) : null;

    var rows = [];
    if(student && student.name){ rows.push((rtl ? 'الطالب: ' : 'Student: ') + esc(student.name)); }
    if(gpa){ rows.push((rtl ? 'المعدل التراكمي: ' : 'GPA: ') + gpa); }
    if(stats && stats.totalCredits){ rows.push((rtl ? 'الساعات: ' : 'Credit hours: ') + window.__progressText(stats.doneCredits, stats.totalCredits, rtl)); }
    var today = new Date();
    rows.push((rtl ? 'أُنشئ في: ' : 'Generated: ') + today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0'));

    return '<div class="po-header">' +
      '<div class="po-title"><span class="po-icon">' + window.AAUP_ICONS.markup(info, { size: 28 }) + '</span>' +
      // info.name (from planDisplayInfo) is already HTML-escaped once by the
      // sync sanitizer — esc()'ing it again would show a literal "&amp;".
      '<div><div class="po-name">' + (info.name || prefix) + '</div>' +
      '<div class="po-uni">' + (rtl
        ? 'الجامعة العربية الأمريكية'
        : 'The Arab American University') + '</div></div></div>' +
      '<div class="po-meta">' + rows.map(function(r){ return '<span>' + r + '</span>'; }).join('') + '</div>' +
      '</div>';
  }

  // Compact is the plan as a checklist; full adds each course's catalogue
  // number and what it waits on — the two things a student reads off a
  // printout when they are actually registering, and the two that make it
  // long enough that nobody wants them by default.
  var fullMode = false;

  function renderOverview(prefix){
    var model = buildModel(prefix);
    if(!model){
      return '<p class="ex-note">' + ((window.AAUP_LANG && window.AAUP_LANG.isAr())
        ? 'افتح خطة دراسية أولاً.' : 'Open a study plan first.') + '</p>';
    }
    var rtl = model.rtl;
    var html = planHeader(prefix, rtl);
    html += '<div class="po-years">';
    model.years.forEach(function(y){
      html += '<div class="po-year"><div class="po-year-label">' + esc(y.label) + '</div>';
      y.semesters.forEach(function(s){
        if(!s.courses.length) return;
        html += '<div class="po-sem"><div class="po-sem-label">' + esc(s.label) + '</div><ul class="po-courses">';
        s.courses.forEach(function(c){
          var mark = c.done ? '✓' : '○';
          var gradeTag = c.grade ? ' <span class="po-grade">' + esc(c.grade) + '</span>' : '';
          var crTag = c.credits !== '' ? ' <span class="po-cr">' + esc(String(c.credits)) + 'H</span>' : '';
          var codeTag = (fullMode && c.code) ? '<span class="po-code">' + esc(c.code) + '</span>' : '';
          // Course names come out of courseInfo already escaped once by the
          // shared sanitizer — esc()'ing them again printed a real "&" as a
          // literal "&amp;" ("Elementary Probability &amp; Statistics"). The
          // label around them is a literal, so it needs no escaping either.
          var needsTag = (fullMode && c.needs && c.needs.length)
            ? '<span class="po-needs">' + (rtl ? 'يتطلب: ' : 'needs: ') + c.needs.join(', ') + '</span>'
            : '';
          html += '<li class="' + (c.done ? 'po-done' : '') + '"><span class="po-mark">' + mark + '</span>' +
            '<span class="po-cname">' + esc(c.name) + codeTag + needsTag + '</span>' + crTag + gradeTag + '</li>';
        });
        html += '</ul></div>';
      });
      html += '</div>';
    });
    html += '</div>';
    // One language, not both at once. This sheet is printed; a student who
    // reads Arabic should not hand in a page with the same sentence twice.
    html += '<p class="po-foot">' + (rtl
      ? 'أداة طلابية غير رسمية — تأكد دائمًا من مرشدك الأكاديمي.'
      : 'Unofficial student planning tool — always confirm with your academic advisor.') +
      // This sheet gets printed and handed to someone, which is exactly where
      // the app's credit belongs — rather than fixed over every screen inside
      // the app, which is where it used to live.
      '<span class="po-credit"> \u00b7 AAUPath \u00b7 @Dile (AL-Hammam_Natsha)</span></p>';
    return html;
  }

  function ensureOverlay(){
    var overlay = document.getElementById('planOverviewOverlay');
    if(overlay) return overlay;
    // The chrome around the sheet is built once and cached, so it has to be
    // relabelled on every open (see labelOverlay below) rather than only here
    // — otherwise the language the student happened to be in the first time
    // they opened Overview is the language of these buttons for the session.
    var A = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'planOverviewOverlay';
    overlay.innerHTML =
      '<div class="modal-card po-card">' +
        '<button class="modal-close" id="planOverviewClose" aria-label="' + (A ? 'إغلاق' : 'Close') + '">&times;</button>' +
        '<div class="po-actions">' +
          '<div class="po-modes" role="group" aria-label="' + (A ? 'مستوى التفصيل' : 'Detail level') + '">' +
            '<button type="button" class="po-mode is-on" data-po-mode="compact">' + (A ? 'مختصر' : 'Compact') + '</button>' +
            '<button type="button" class="po-mode" data-po-mode="full">' + (A ? 'الخطة كاملة' : 'Full plan') + '</button>' +
          '</div>' +
          '<button type="button" class="home-btn po-print" id="planOverviewPrintBtn">' +
            (window.AAUP_ICONS ? window.AAUP_ICONS.preview('printer', 15) : '') +
            (A ? 'طباعة / حفظ PDF' : 'Print / Save PDF') + '</button>' +
        '</div>' +
        // .po-sheet is a page, not a panel: white, page-proportioned and with
        // a shadow, so what is on screen is what comes out of the printer.
        '<div id="planOverviewPrintRoot"><div class="po-sheet" id="planOverviewBody"></div></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e){ if(e.target === overlay){ overlay.classList.remove('open'); } });
    overlay.querySelector('.modal-card').addEventListener('click', function(e){ e.stopPropagation(); });
    document.getElementById('planOverviewClose').addEventListener('click', function(){ overlay.classList.remove('open'); });
    // Same keyboard escape hatch the audit and course modals already had.
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && overlay.classList.contains('open')) overlay.classList.remove('open'); });
    // The print stylesheet (see @media print in the <style> block) hides
    // everything except #planOverviewPrintRoot, so window.print() yields a
    // clean one-page plan with none of the app chrome around it.
    document.getElementById('planOverviewPrintBtn').addEventListener('click', function(){ window.print(); });
    overlay.querySelectorAll('[data-po-mode]').forEach(function(btn){
      btn.addEventListener('click', function(){
        fullMode = btn.getAttribute('data-po-mode') === 'full';
        overlay.querySelectorAll('[data-po-mode]').forEach(function(b){
          b.classList.toggle('is-on', b === btn);
        });
        if(currentPrefix){
          document.getElementById('planOverviewBody').innerHTML = renderOverview(currentPrefix);
        }
      });
    });
    return overlay;
  }

  var currentPrefix = null;
  // The overlay chrome is built once and reused. Relabel it on every open so
  // it follows the language switch instead of the language it was born in.
  function labelOverlay(overlay){
    var A = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    var set = function(sel, text, attr){
      var el = overlay.querySelector(sel);
      if(!el) return;
      if(attr) el.setAttribute(attr, text);
      else el.textContent = text;
    };
    set('#planOverviewClose', A ? 'إغلاق' : 'Close', 'aria-label');
    set('.po-modes', A ? 'مستوى التفصيل' : 'Detail level', 'aria-label');
    set('[data-po-mode="compact"]', A ? 'مختصر' : 'Compact');
    set('[data-po-mode="full"]', A ? 'الخطة كاملة' : 'Full plan');
    var print = overlay.querySelector('#planOverviewPrintBtn');
    if(print){
      print.innerHTML = (window.AAUP_ICONS ? window.AAUP_ICONS.preview('printer', 15) : '') +
        (A ? 'طباعة / حفظ PDF' : 'Print / Save PDF');
    }
    overlay.setAttribute('dir', A ? 'rtl' : 'ltr');
  }

  function open(prefix){
    currentPrefix = prefix;
    var overlay = ensureOverlay();
    labelOverlay(overlay);
    document.getElementById('planOverviewBody').innerHTML = renderOverview(prefix);
    overlay.classList.add('open');
  }

  window.AAUP_OVERVIEW = { open: open };
})();
