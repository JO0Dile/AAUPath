// ==========================
// DASHBOARD
// ==========================
// The landing screen once a plan has been chosen — a summary (progress,
// GPA, achievements, what's next) built entirely from the same modules
// the full study-plan page already uses, rather than a new parallel
// data source. Works for both a built-in major and a custom plan, since
// both register through the same window.__PLAN_DATA bridge.
(function(){
  var BUILT_IN_ICONS = { robotics: '🤖', cybersecurity: '🔒', medical: '⚕️', cs: '💻' };
  var BUILT_IN_ICON_KEYS = { robotics: 'robot', cybersecurity: 'shield', medical: 'medical', cs: 'code' };
  var SELECTED_KEY = 'aaup_selectedPlan';

  function isImportedPlan(prefix){
    return !!(window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()[prefix]);
  }

  // Every screen that names a plan — the dashboard, Share, Overview & Print —
  // came through here, and it always read majorName.en. So a student in Arabic
  // saw the Arabic plan everywhere except in its own title. It reads the side
  // the switch asks for now, and falls back to English when a plan has no
  // Arabic name rather than showing an empty heading.
  function planDisplayInfo(prefix){
    var ar = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    if(isImportedPlan(prefix)){
      var p = window.AAUP_IMPORTED.loadImportedPlans()[prefix];
      var side = ar ? (p.majorName.ar || p.majorName.en) : p.majorName.en;
      var parts = window.AAUP_IMPORTED.nameParts(side);
      if(!parts.big){ parts = window.AAUP_IMPORTED.nameParts(p.majorName.en); }
      return { icon: p.icon || '🎓', iconKey: p.iconKey || '', imageUrl: p.imageUrl || '',
               name: parts.big + (parts.small ? ' ' + parts.small : '') };
    }
    var page = document.getElementById('page-' + prefix);
    var nameEl = page && page.querySelector('.title-block ' + (ar ? '.ar' : '.en'));
    if(!nameEl || !nameEl.textContent.trim()){
      nameEl = page && page.querySelector('.title-block .en');
    }
    return { icon: BUILT_IN_ICONS[prefix] || '🎓', iconKey: BUILT_IN_ICON_KEYS[prefix] || '', name: nameEl ? nameEl.textContent : prefix };
  }

  function getSelected(){
    try{ return localStorage.getItem(SELECTED_KEY); }catch(e){ return null; }
  }
  function setSelected(prefix){
    try{ localStorage.setItem(SELECTED_KEY, prefix); }catch(e){}
  }

  function selectAndOpen(prefix){
    setSelected(prefix);
    open(prefix);
  }

  function open(prefix){
    try {
      // Reuse the Imported Plans module's own open() to guarantee full
      // registration/rendering for a custom plan (same code path as
      // actually viewing it), then hide it again immediately — cheaper and
      // far less error-prone than duplicating that registration logic here.
      if(isImportedPlan(prefix)){
        window.AAUP_IMPORTED.open(prefix);
        var importedHost = document.getElementById('importedPlanView');
        if(importedHost) importedHost.style.display = 'none';
      } else if(document.getElementById('page-' + prefix)){
        var homeEl = document.getElementById('home');
        if(homeEl) homeEl.style.display = 'none';
        ['robotics', 'cybersecurity', 'medical', 'cs'].forEach(function(p){
          var el = document.getElementById('page-' + p);
          if(el) el.style.display = 'none';
        });
      } else {
        // Selected plan isn't available right now — a feed plan the sync
        // hasn't loaded yet, or one that was deleted. Never hide Home for
        // something we can't render; just show the picker instead.
        choosePlan();
        return;
      }
      var dash = document.getElementById('dashboard');
      dash.style.display = 'block';
      setSelected(prefix);
      render(prefix);
      if(window.AAUP_SIDEBAR){ window.AAUP_SIDEBAR.show(prefix, 'dashboard'); }
      window.scrollTo(0, 0);
      if(window.AAUP_TUTORIAL){ window.AAUP_TUTORIAL.startWhenClear('dashboard'); }
      // A one-time orientation screen — the whole degree laid out year by
      // year — the first time this plan's Dashboard is ever opened. Never
      // shown again after that; always reachable afterward from the
    } catch(e){
      // A malformed/half-loaded plan must NEVER strand the student on a blank
      // screen (Home was already hidden). Fall back to the picker. This is the
      // root fix for the "home flashes then goes blank on load" report — the
      // saved selected plan auto-opened and its render threw.
      if(window.console && console.error){ console.error('Could not open plan "' + prefix + '":', e); }
      try { choosePlan(); } catch(e2){}
    }
  }

  function openStudyPlan(prefix){
    document.getElementById('dashboard').style.display = 'none';
    if(isImportedPlan(prefix)){ window.AAUP_IMPORTED.open(prefix); }
    else if(window.showPage){ window.showPage(prefix); }
    // A built-in plan's cards carry their availability classes from the
    // static markup, and computeAvailability only ever ran off a progress
    // change — so until the student ticked something, the plan showed
    // whatever the HTML was authored with rather than what their own
    // progress actually unlocks. Recompute on open, which is also when the
    // plan data these rules read has finished registering.
    if(window.__refreshPlanUI){ window.__refreshPlanUI(prefix); }
    if(window.AAUP_SIDEBAR){ window.AAUP_SIDEBAR.show(prefix, 'studyplan'); }
    // Before the tour, and before anything else can be read as an answer:
    // which English level this student was placed into decides how many
    // hours their degree actually is (js/77-english-level.js). It asks once
    // and only on a plan that has English levels in it; after that this is
    // just re-applying an answer already given.
    // Opening a plan starts it unfiltered — the filter is momentary by
    // design, and a plan that opens already showing half its courses is the
    // problem the old "Available only" switch created.
    if(window.AAUP_PLAN_FILTER){ window.AAUP_PLAN_FILTER.reset(prefix); }
    if(window.AAUP_ENGLISH){ window.AAUP_ENGLISH.ensure(prefix); }
    if(window.AAUP_TUTORIAL){ window.AAUP_TUTORIAL.startWhenClear('studyplan'); }
  }

  // "Pick another plan": the same college-then-major question the home
  // screen asks, opened over home. The old University -> Faculty -> Major
  // page is no longer where anyone is sent.
  function choosePlan(){
    window.AAUP_TASK_HOME.show();
    window.AAUP_TASK_HOME.openSheet('plan');
  }

  function tx9(rtl, en, ar){ return rtl ? ar : en; }

  function render(prefix){
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var info = planDisplayInfo(prefix);

    var totalCr = 0, doneCr = 0;
    if(window.AAUP_AUDIT){
      window.AAUP_AUDIT.computeAudit(prefix).forEach(function(r){ totalCr += r.total; doneCr += r.completed; });
    }
    var pct = totalCr ? Math.round(doneCr / totalCr * 100) : 0;

    var gpaResult = window.AAUP_GPA ? window.AAUP_GPA.gpaFor(prefix, null) : { gpa: null };
    var standingLabel = null;
    if(gpaResult.gpa != null && window.AAUP_GPA.standingFor){
      var standing = window.AAUP_GPA.standingFor(gpaResult.gpa);
      // standingFor() returns { label, cls, ar } — reading .en gave undefined,
      // so the card fell through to "No grades entered yet" while displaying a
      // real GPA right above it. The audit and GPA Studio already use .label.
      standingLabel = standing ? (rtl ? standing.ar : standing.label) : null;
    }


    // js/50-whats-next.js owns this card's content when it has loaded — it
    // is the same ranked-with-reasons module used in the study-plan
    // sidebar, not a second implementation. Before this, the card here used
    // a plain unranked list (AAUP_ADVISOR.recommend, first 4 in whatever
    // order it returned them) while the actual upgrade lived only in the
    // sidebar of a different page — a page nobody had reason to open just
    // to see it, so the improvement was effectively invisible. This is the
    // screen every student actually lands on after choosing a plan, so this
    // is where it has to be to be found. The old list stays as the fallback
    // if that module fails to load, rather than an empty card.
    var nextCourses = [];
    if(!window.AAUP_WHATS_NEXT && window.AAUP_ADVISOR && window.AAUP_ADVISOR.recommend){
      var rec = window.AAUP_ADVISOR.recommend(prefix);
      nextCourses = (rec.chosen || []).slice(0, 4);
    }
    var courseInfo = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    function nameFor(slug){ var m = courseInfo[slug]; return m ? (rtl ? m.ar : m.name) : slug; }

    // Phone-only hero (see .dash-phone-hero in app.css) — one glanceable
    // ring instead of the three equal stat tiles below, which is what
    // .dash-grid/.dash-swipe-dots still are for desktop. Same three
    // numbers (pct/gpa/achievements) already computed above; this is a
    // second rendering of them, not a second source of truth.
    var ringR = 50, ringC = Math.round(2 * Math.PI * ringR * 100) / 100;
    var ringOffset = Math.round(ringC * (1 - pct / 100) * 100) / 100;
    var phoneHeroHtml = '<div class="dash-phone-hero">' +
      '<div class="dph-ring-wrap"><div class="dph-ring-glow"></div><div class="dph-ring">' +
        '<svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="' + ringR + '"/>' +
        '<circle class="val" cx="60" cy="60" r="' + ringR + '" stroke-dasharray="' + ringC + '" stroke-dashoffset="' + ringOffset + '"/></svg>' +
        '<div class="dph-ring-center"><span class="n">' + pct + '%</span><span class="l">' + (rtl ? 'مكتمل' : 'Complete') + '</span></div>' +
      '</div>' +
      '<div class="dph-stat-stack">' +
        '<div class="dph-stat"><div class="n">' + (gpaResult.gpa != null ? gpaResult.gpa.toFixed(2) : '—') + '</div><div class="l">' + (rtl ? 'المعدل التراكمي' : 'Cumulative GPA') + '</div></div>' +
        '<div class="dph-stat"><div class="n">' + Math.max(0, totalCr - doneCr) + 'H</div><div class="l">' + (rtl ? 'ساعة متبقية' : 'Credits left') + '</div></div>' +
      '</div></div>' +
    '</div>';

    // 29 + 9. A plan with nothing marked cannot be graded, and the honest
    // thing on an empty screen is to name the ONE action that fills it.
    var healthHtml = (window.AAUP_PLAN_HEALTH ? window.AAUP_PLAN_HEALTH.cardHtml(prefix, rtl) : '');
    if(!healthHtml && window.AAUP_EMPTY){
      healthHtml = window.AAUP_EMPTY.card({
        rtl: rtl,
        icon: 'planpin',
        title: tx9(rtl, 'Nothing marked yet', 'ما في إشي مُعلّم بعد'),
        body: tx9(rtl,
          'Tick one course you have already passed and this fills in — pace, load balance, and whether what is left still fits in the terms you have.',
          'علّم مساق واحد خلّصته ومنعبيلك هاي — السرعة والتوازن، وإذا اللي باقي بضل بضبط بالفصول المتبقية.'),
        action: tx9(rtl, 'Open my plan', 'افتح خطتي'),
        onclick: 'AAUP_DASHBOARD.openStudyPlan(\'' + prefix + '\')'
      });
    }

    var host = document.getElementById('dashboard');
    var html = '<div class="dash-header">' +
      '<div class="dash-title"><span class="dash-icon">' + window.AAUP_ICONS.markup(info, { size: 24 }) + '</span><div><h1>' + info.name + '</h1><p>' + (rtl ? 'لوحة التحكم' : 'Dashboard') + '</p></div></div>' +
      '<div class="dash-actions">' +
        // Same one row as the menu's (js/37-sidebar.js): it asks which kind
        // of change rather than being one of two buttons whose labels never
        // explained the difference.
        '<button type="button" class="home-btn" onclick="AAUP_SIDEBAR.openPlanChooser(\'' + prefix + '\')">' + window.AAUP_ICONS.preview('shuffle', 14) + '<span>' + (rtl ? 'تغيير الخطة' : 'Change plan') + '</span></button>' +
        '<button type="button" class="home-btn" onclick="AAUP_DASHBOARD.openStudyPlan(\'' + prefix + '\')">' + window.AAUP_ICONS.preview('planpin', 14) + '<span>' + (rtl ? 'خطتي الدراسية' : 'My Study Plan') + '</span></button>' +
      '</div></div>' +
      phoneHeroHtml +
      // 29 · The judgement, before the numbers that produced it. Empty until
      // there is something marked to judge — the empty state below asks for
      // exactly that, rather than grading a blank plan an A.
      healthHtml +
      '<div class="dash-swipe-dots" id="' + prefix + '-dashDots" aria-hidden="true"><span class="active"></span><span></span></div>' +
      '<div class="dash-grid" id="' + prefix + '-dashGrid">' +
        '<div class="dash-card"><h3>' + (rtl ? 'التقدم' : 'Progress') + '</h3><div class="dash-big">' + pct + '%</div><div class="dash-sub">' + doneCr + ' / ' + totalCr + 'H</div></div>' +
        '<div class="dash-card"><h3>GPA</h3><div class="dash-big">' + (gpaResult.gpa != null ? gpaResult.gpa.toFixed(2) : '\u2014') + '</div><div class="dash-sub">' + (standingLabel || (rtl ? 'لم تُدخل علامات بعد' : 'No grades entered yet')) + '</div></div>' +
      '</div>' +
      // 28 · The badges, as a strip that is seen every time, instead of a
      // count in a tile pointing at a screen visited once.
      (window.AAUP_ACHIEVEMENTS && window.AAUP_ACHIEVEMENTS.stripHtml
        ? window.AAUP_ACHIEVEMENTS.stripHtml(prefix, rtl) : '') +
      (window.AAUP_GRADUATION
        ? '<div class="dash-card grad-card" style="margin-bottom:20px;"><h3 class="mh">' + window.AAUP_ICONS.preview('cap', 18) + window.AAUP_GRADUATION.title(rtl) +
          '</h3><div id="' + prefix + '-dashGradBody"></div></div>'
        : '') +
      '<div class="dash-card" style="margin-bottom:20px;"><h3>' + (rtl ? 'ما الذي يمكنني أخذه الآن؟' : 'What Can I Take Next') + '</h3>' +
      (window.AAUP_WHATS_NEXT
        ? '<div id="' + prefix + '-dashNextBody"></div>'
        : (nextCourses.length
            ? '<div class="dash-next-list">' + nextCourses.map(function(c){ return '<div class="dash-next-item"><span>' + nameFor(c.slug) + '</span><span>' + c.cr + 'H</span></div>'; }).join('') + '</div>'
            : '<p class="ex-note">' + (rtl ? 'لا توجد توصيات متاحة الآن.' : 'No recommendations available right now.') + '</p>')) +
      '</div>' +
      (window.AAUP_FOLLOW ? window.AAUP_FOLLOW.sectionHtml(prefix, rtl) : '') +
      '<div class="dash-quicklinks">' +

        '<div class="dash-quicklink" onclick="AAUP_AUDIT.open(\'' + prefix + '\')"><span class="dq-icon">' + window.AAUP_ICONS.preview('clipboard', 22) + '</span><span class="dq-label">' + (rtl ? 'التدقيق الأكاديمي وGPA' : 'Degree Audit & GPA') + '</span></div>' +
        // The Achievements tile that used to sit here is gone. It was the
        // third door to the same screen — a menu row, this tile, and the
        // toast that fires the moment a badge unlocks. The toast now leads
        // there (js/24-achievements.js) and the menu row is the way in the
        // rest of the time; the count above still says how many are earned.

        '<div class="dash-quicklink" onclick="AAUP_DASHBOARD.openStudyPlan(\'' + prefix + '\')"><span class="dq-icon">' + window.AAUP_ICONS.preview('planpin', 22) + '</span><span class="dq-label">' + (rtl ? 'خطتي الدراسية الكاملة' : 'My Full Study Plan') + '</span></div>' +
        (window.AAUP_SHARE
          ? '<div class="dash-quicklink" onclick="AAUP_SHARE.open(\'' + prefix + '\')"><span class="dq-icon">' + window.AAUP_ICONS.preview('link', 22) + '</span><span class="dq-label">' + (rtl ? 'شارك هذه الخطة' : 'Share this plan') + '</span></div>'
          : '') +
        (window.AAUP_CLOUD && window.AAUP_CLOUD.isConfigured()
          ? '<div class="dash-quicklink" onclick="AAUP_CLOUD.open()"><span class="dq-icon">' + window.AAUP_ICONS.preview('cloud', 22) + '</span><span class="dq-label">' +
            (window.AAUP_CLOUD.isSignedIn()
              ? window.__escapeHtml(window.AAUP_CLOUD.displayName())
              : (rtl ? 'تسجيل الدخول / إنشاء حساب' : 'Sign In / Sign Up')) +
            '</span></div>'
          : '') +
      '</div>';
    // Backup nudge: only when there IS meaningful progress to lose, and no
    // backup in the last 30 days (or ever). Quiet one-liner, not a popup —
    // losing a semester of tracked progress hurts more than this line does.
    var lastBackup = 0;
    try{ lastBackup = parseInt(localStorage.getItem('aaup_lastBackup') || '0', 10) || 0; }catch(e){}
    var hasProgress = doneCr > 0;
    if(hasProgress && (Date.now() - lastBackup) > 30 * 24 * 60 * 60 * 1000){
      html += '<p class="form-note" style="text-align:center;margin-top:18px;">' +
        window.AAUP_ICONS.preview('save', 13) + ' ' +
        (rtl ? 'نصيحة: صدّر نسخة احتياطية من تقدمك من الإعدادات — بيانات المتصفح قد تُمسح.' :
               'Tip: export a backup of your progress from Settings \u2014 browser data can be wiped.') + '</p>';
    }
    host.innerHTML = html;
    if(window.AAUP_FOLLOW){ window.AAUP_FOLLOW.bind(prefix); }
    if(window.AAUP_WHATS_NEXT){ window.AAUP_WHATS_NEXT.render(prefix, prefix + '-dashNextBody', 'lead'); }
    if(window.AAUP_GRADUATION){ window.AAUP_GRADUATION.render(prefix, prefix + '-dashGradBody'); }
    // Phone only (see .dash-swipe-dots in app.css) — the three stat tiles
    // swipe side by side there instead of stacking; the dots are decorative
    // sync only, scroll-snap already does the actual paging.
    var dashGrid = document.getElementById(prefix + '-dashGrid');
    var dashDots = document.getElementById(prefix + '-dashDots');
    if(dashGrid && dashDots){
      var dots = dashDots.querySelectorAll('span');
      dashGrid.addEventListener('scroll', function(){
        var idx = Math.round(dashGrid.scrollLeft / Math.max(1, dashGrid.clientWidth));
        dots.forEach(function(d, i){ d.classList.toggle('active', i === idx); });
      }, { passive: true });
    }
  }

  // showPage('home') means "take me to my landing point", and that is the
  // task-first home for everyone now, with or without a plan: the dashboard
  // is one of the things on it ("Degree Progress"), not the place you land.
  // Every existing "🏠 Home" button across every page already calls
  // showPage('home'), so this one interception point covers all of them
  // without editing each one individually.
  var _origShowPage = window.showPage;
  if(typeof _origShowPage === 'function'){
    window.showPage = function(id){
      if(id === 'home'){ window.AAUP_TASK_HOME.show(); return; }
      return _origShowPage(id);
    };
  }

  window.AAUP_DASHBOARD = {
    open: open, selectAndOpen: selectAndOpen, openStudyPlan: openStudyPlan,
    choosePlan: choosePlan, getSelected: getSelected, select: setSelected,
    planDisplayInfo: planDisplayInfo, isImportedPlan: isImportedPlan,
    // Best-effort completion percentage for the Home "continue" card.
    // Built-in plan pages are always in the DOM (just hidden) so
    // computeStats works directly; an imported plan that hasn't been
    // opened yet has no rendered page, so fall back to its audit rows,
    // and to null if neither can produce a number.
    planPercent: function(prefix){
      try{
        if(!isImportedPlan(prefix) && window.__computeStats){
          var s = window.__computeStats(prefix);
          if(s && s.totalCredits > 0){ return s.pct; }
        }
        if(window.AAUP_AUDIT && window.AAUP_AUDIT.computeAudit){
          var total = 0, done = 0;
          window.AAUP_AUDIT.computeAudit(prefix).forEach(function(r){ total += r.total; done += r.completed; });
          if(total > 0){ return Math.round(done / total * 100); }
        }
      }catch(e){}
      return null;
    }
  };

  function init(){
    // Record every backup's timestamp so the dashboard can nudge people who
    // have real progress but have never exported it — on a phone, the OS
    // can evict site data; the export file is the only true safety net.
    if(window.AAUP_DATA && !window.AAUP_DATA.__backupWrapped){
      var _origExport = window.AAUP_DATA.exportData;
      window.AAUP_DATA.exportData = function(){
        try{ localStorage.setItem('aaup_lastBackup', String(Date.now())); }catch(e){}
        return _origExport.apply(this, arguments);
      };
      window.AAUP_DATA.__backupWrapped = true;
    }
    // A returning student is no longer dropped straight into their plan's
    // dashboard here. Everyone lands on the home screen (js/90-task-home.js),
    // which shows their plan and numbers on its tiles.
  }
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
