// ==========================
// HOME — task first
//
// The app used to open on a plan: pick a university, a faculty, a major,
// and only then find the one thing you came for, three screens deep. A
// student who opened it to email a professor or check a prerequisite had to
// pretend to be planning a degree first.
//
// So this screen opens on the question instead — "What do you need?" — with
// one search box that looks across everything and every feature laid out as
// an equal choice. Nothing has to come first.
//
// A few features genuinely cannot work without a major: a GPA is computed
// from your own courses, progress is measured against your plan, and every
// major has its own Student Thoughts wall. Those ask for the major the first
// time they are tapped — college first, then the majors in it — and never
// again: the answer is the same remembered selection the dashboard has always
// kept (aaup_selectedPlan), so nothing new is stored.
//
// Everything a tile opens is the existing screen for it, opened over this one
// the way the sidebar opens it. Close it and you are back here.
// ==========================
(function(){
  'use strict';

  var state = { q: '', sheetKey: null, sheetCollege: null, sheetQ: '', hint: 0 };
  var contacts = null;      // contacts.json once loaded, for the search box
  var hintTimer = null;

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml(String(s == null ? '' : s)); }
  // Plan and college names are escaped once on the way into storage;
  // __cleanText escapes again idempotently, so they are safe and never
  // show a literal "&amp;".
  function clean(s){ return window.__cleanText ? window.__cleanText(String(s == null ? '' : s)) : esc(s); }
  function plain(s){
    return String(s == null ? '' : s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  function norm(v){ return window.AAUP_SEARCH ? window.AAUP_SEARCH.normalize(v) : String(v == null ? '' : v).toLowerCase(); }
  function ic(k, n){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview(k, n || 22) : ''; }
  function toast(msg){ if(window.__showToast) window.__showToast(msg); }

  // ---------------------------------------------------------------------
  // Plans. Every plan the app knows is an imported plan now — the catalogue
  // arrives through the same sync as a student's own — so one registry
  // answers every question here.
  function plans(){ return (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()) || {}; }
  // A published plan whose course list has not been typed in yet. Only the
  // catalogue's own plans can be that: a plan a student made starts empty on
  // purpose and is theirs to fill, so it opens like any other.
  function isPending(p){ return !p || (p.official && (!Array.isArray(p.courses) || !p.courses.length)); }
  // A catalogue name is two parts: the major ("Cyber Security") and a detail
  // line ("B.Sc. · 132 CH · Program 24051"). Titles show the first; the
  // detail is only worth its space on the list you pick from.
  function nameSide(p){
    if(!p || !p.majorName) return { big: '', small: '' };
    var np = window.AAUP_IMPORTED.nameParts;
    var side = np(ar() ? (p.majorName.ar || p.majorName.en) : p.majorName.en);
    return side.big ? side : np(p.majorName.en);
  }
  function planName(p){ return nameSide(p).big; }
  function planNameBoth(p){
    var np = window.AAUP_IMPORTED.nameParts;
    var en = np(p.majorName && p.majorName.en), a = np(p.majorName && p.majorName.ar);
    return plain([en.big, en.small, a.big, a.small].join(' '));
  }

  // The remembered major, but only while it still exists and has courses —
  // a deleted plan or one whose curriculum is not in yet cannot answer a GPA.
  function selected(){
    var id = window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected();
    var p = id && plans()[id];
    return (p && !isPending(p)) ? id : null;
  }

  // Registers a plan and builds its page without showing it. Every screen a
  // tile opens reads the plan through window.__PLAN_DATA and the plan's page,
  // which normally exist only once the plan has been opened. The page is
  // rebuilt when the language changed since, because several screens read
  // their direction from the page (window.__isRtl).
  function ensurePlan(id){
    try{
      var page = document.getElementById('page-' + id);
      var stale = !page || !(window.__PLAN_DATA || {})[id] || page.classList.contains('rtl-mode') !== ar();
      if(stale && window.AAUP_IMPORTED) window.AAUP_IMPORTED.refresh(id);
    }catch(e){}
  }

  function collegeKey(p){
    return window.AAUP_IMPORTED.collegeKeyForPlan ? window.AAUP_IMPORTED.collegeKeyForPlan(p) : (p.collegeId || 'other');
  }
  function collegeName(key, samplePlan){
    var c = (window.APP_COLLEGES || {})[key];
    if(c && c.name) return ar() ? (c.name.ar || c.name.en) : (c.name.en || c.name.ar);
    var pc = samplePlan && samplePlan.college;
    if(pc && (pc.en || pc.ar)) return ar() ? (pc.ar || pc.en) : (pc.en || pc.ar);
    return L('Other plans', 'خطط أخرى');
  }
  function colleges(){
    var all = plans(), groups = {};
    Object.keys(all).forEach(function(id){
      var p = all[id];
      if(!p || !p.majorName) return;
      var k = collegeKey(p);
      (groups[k] = groups[k] || { key: k, ids: [], sample: p }).ids.push(id);
    });
    var list = Object.keys(groups).map(function(k){
      var g = groups[k];
      g.name = collegeName(k, g.sample);
      g.ids.sort(function(a, b){ return planName(all[a]).localeCompare(planName(all[b]), ar() ? 'ar' : 'en'); });
      return g;
    });
    list.sort(function(a, b){ return a.name.localeCompare(b.name, ar() ? 'ar' : 'en'); });
    return list;
  }

  // ---------------------------------------------------------------------
  // Numbers for a student who already has a major. Each is computed by the
  // module that owns it — the same calls the dashboard makes — and each is
  // left out rather than guessed when it cannot be computed.
  function stats(id){
    var s = { pct: 0, done: 0, total: 0, gpa: null, standing: null, health: null, finish: null };
    ensurePlan(id);
    try{
      window.AAUP_AUDIT.computeAudit(id).forEach(function(r){ s.total += r.total; s.done += r.completed; });
      s.pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    }catch(e){}
    try{
      var g = window.AAUP_GPA.gpaFor(id, null);
      if(g && g.gpa != null && isFinite(g.gpa)){ s.gpa = g.gpa; s.standing = window.AAUP_GPA.standingFor(g.gpa); }
    }catch(e){}
    try{ var h = window.AAUP_PLAN_HEALTH && window.AAUP_PLAN_HEALTH.compute(id); if(h) s.health = h.grade; }catch(e){}
    try{ if(window.AAUP_GRADUATION && window.AAUP_GRADUATION.estimate) s.finish = window.AAUP_GRADUATION.estimate(id, ar()); }catch(e){}
    return s;
  }

  // ---------------------------------------------------------------------
  // Features. `needs` means it cannot run without a major.
  var FEATURES = [
    { key: 'plan', icon: 'map', needs: true, en: 'Choose a Plan', ar: 'اختيار الخطة',
      dEn: 'Every course in your major, year by year', dAr: 'كل مساقات تخصصك، سنة بسنة',
      words: ['plan', 'major', 'خطة', 'خطت', 'تخصص'],
      run: function(id){ window.AAUP_DASHBOARD.openStudyPlan(id); } },
    { key: 'gpa', icon: 'clipboard', needs: true, en: 'Calculate My GPA', ar: 'احسب معدلي',
      dEn: 'Your GPA now, and what it could be', dAr: 'معدلك هلق، وقديش ممكن يصير',
      words: ['gpa', 'grade', 'average', 'معدل', 'علام'],
      run: function(id){ window.AAUP_AUDIT.open(id); } },
    { key: 'thoughts', icon: 'speech', needs: true, en: 'Student Thoughts', ar: 'أفكار الطلبة',
      dEn: 'What students say about courses', dAr: 'شو بحكوا الطلاب عن المساقات',
      words: ['thought', 'review', 'opinion', 'أفكار', 'رأي', 'آراء'],
      run: function(id){ window.AAUP_THOUGHTS.open(id); } },
    { key: 'prof', icon: 'cap', needs: false, en: 'Find a Professor', ar: 'ابحث عن محاضر',
      dEn: 'Professors, offices and university contacts', dAr: 'المحاضرين والمكاتب وجهات اتصال الجامعة',
      words: ['prof', 'instructor', 'doctor', 'teacher', 'lecturer', 'محاضر', 'دكتور', 'أستاذ'],
      run: function(id){ window.AAUP_CONTACTS.open(id, { category: 'instructor', query: '' }); } },
    { key: 'courses', icon: 'book', needs: false, en: 'Browse Courses', ar: 'تصفّح المساقات',
      dEn: 'Prerequisites, hours, what unlocks what', dAr: 'المتطلبات والساعات وشو بيفتح شو',
      words: ['course', 'prereq', 'library', 'subject', 'مساق', 'متطلب', 'مادة'],
      run: function(id){ window.AAUP_IMPORTED.openLibrary(id); } },
    { key: 'sched', icon: 'calendar', needs: true, en: 'My Schedule', ar: 'جدولي',
      dEn: 'Your semesters on your calendar', dAr: 'فصولك على تقويمك',
      words: ['schedule', 'calendar', 'semester', 'جدول', 'تقويم', 'فصل'],
      run: function(id){ window.AAUP_CALENDAR.open(id); } },
    { key: 'progress', icon: 'chart', needs: true, en: 'Degree Progress', ar: 'تقدّمي الدراسي',
      dEn: 'How far you are and what is left', dAr: 'وين وصلت وشو ضايل',
      words: ['progress', 'audit', 'graduat', 'dashboard', 'تقدم', 'تخرج'],
      run: function(id){ window.AAUP_DASHBOARD.open(id); } },
    { key: 'ach', icon: 'trophy', needs: true, en: 'Achievements', ar: 'الإنجازات',
      dEn: 'Badges you’ve earned so far', dAr: 'الشارات اللي حصّلتها لهلق',
      words: ['achiev', 'badge', 'إنجاز', 'شار'],
      run: function(id){ window.AAUP_ACHIEVEMENTS.open(id); } }
  ];
  var EXTRAS = [
    // The one place to switch major: here, beside it. Only offered once a
    // major is chosen — before that, Choose a Plan is the same question.
    { key: 'switch', icon: 'shuffle', needs: true, onlyWithPlan: true, en: 'Switch major', ar: 'غيّر التخصص',
      run: function(id){ window.AAUP_SIDEBAR.openPlanChooser(id); } },
    { key: 'share', icon: 'send', needs: true, en: 'Share my plan', ar: 'شارك خطتي',
      run: function(id){ window.AAUP_SHARE.open(id); } },
    { key: 'about', icon: 'help', needs: false, en: 'About', ar: 'عن التطبيق',
      run: function(){ window.AAUP_ABOUT.open(); } }
  ];
  // Found by search, never drawn as a card. University Contacts opened the
  // same screen as Find a Professor, just on a different tab, so the home
  // keeps one card for it — but "registration" or "finance" should still
  // land a student on the right tab.
  var SEARCH_ONLY = [
    { key: 'contacts', icon: 'people', needs: false, en: 'University Contacts', ar: 'جهات اتصال الجامعة',
      dEn: 'Registration, finance, IT, deans', dAr: 'التسجيل، المالية، تقنية المعلومات، العمادات',
      words: ['contact', 'registration', 'finance', 'email', 'office', 'اتصال', 'تسجيل', 'مالي', 'مكتب'],
      run: function(id){ window.AAUP_CONTACTS.open(id, { category: 'all', query: '' }); } }
  ];
  function everything(){ return FEATURES.concat(EXTRAS, SEARCH_ONLY); }
  function feature(key){
    return everything().filter(function(f){ return f.key === key; })[0];
  }

  // Why a feature needs the major — said once, on the sheet that asks.
  var REASON = {
    plan: ['Pick your major and AAUPath opens every course in it.', 'اختار تخصصك وAAUPath بيفتحلك كل مساقاته.'],
    gpa: ['Your GPA is worked out from your own courses, so this needs your major. You only pick it once.',
          'معدلك بينحسب من مساقاتك، فبنحتاج تخصصك. بتختاره مرة وحدة بس.'],
    progress: ['Progress is measured against your major’s plan, so this needs your major. You only pick it once.',
               'تقدّمك بينقاس على خطة تخصصك، فبنحتاج تخصصك. بتختاره مرة وحدة بس.'],
    thoughts: ['Every major has its own wall, so this needs your major. You only pick it once.',
               'لكل تخصص حائطه الخاص، فبنحتاج تخصصك. بتختاره مرة وحدة بس.'],
    other: ['This works from your major’s courses, so it needs your major. You only pick it once.',
            'هاد بيشتغل من مساقات تخصصك، فبنحتاج تخصصك. بتختاره مرة وحدة بس.']
  };

  function go(key){
    var f = feature(key);
    if(!f) return;
    var id = selected();
    if(f.needs && !id){ openSheet(key); return; }
    if(id) ensurePlan(id);
    try{ f.run(id); }catch(e){ if(window.console) console.error('Home: could not open ' + key, e); }
  }

  // ---------------------------------------------------------------------
  // The page.
  function greeting(){
    var h = new Date().getHours();
    var word = h < 12 ? L('Good morning', 'صباح الخير') : (h < 18 ? L('Good afternoon', 'مساء الخير') : L('Good evening', 'مساء الخير'));
    var who = window.AAUP_STUDENT && window.AAUP_STUDENT.get && window.AAUP_STUDENT.get();
    var name = who && who.name ? String(who.name).trim().split(/\s+/)[0] : '';
    return name ? word + L(', ', '، ') + name : word;
  }
  var HINTS = {
    en: ['Try “Calculus”', 'Try “my GPA”', 'Try “registration”', 'Try “Cyber Security”'],
    ar: ['جرّب «Calculus»', 'جرّب «معدلي»', 'جرّب «التسجيل»', 'جرّب «الأمن السيبراني»']
  };
  var CHIPS = { en: ['my GPA', 'Calculus', 'Suwan'], ar: ['معدلي', 'Calculus', 'Suwan'] };
  function hint(){ var h = HINTS[ar() ? 'ar' : 'en']; return h[state.hint % h.length]; }

  function cardHtml(f, id, s){
    var val = '';
    if(id && f.key === 'gpa' && s.gpa != null) val = s.gpa.toFixed(2);
    if(id && f.key === 'progress') val = s.pct + '%';
    var title = (f.key === 'plan' && id) ? L('My Plan', 'خطتي') : L(f.en, f.ar);
    var desc = (f.key === 'plan' && id)
      ? '<span class="hm-card-desc hm-card-major">' + clean(planName(plans()[id])) + '</span>'
      : '<span class="hm-card-desc">' + esc(L(f.dEn, f.dAr)) + '</span>';
    return '<button type="button" class="hm-card" data-hm-go="' + f.key + '">' +
      '<span class="hm-card-top"><span class="hm-card-ic">' + ic(f.icon, 22) + '</span>' +
        (val ? '<span class="hm-card-val">' + esc(val) + '</span>' : '') + '</span>' +
      '<span class="hm-card-title">' + esc(title) + '</span>' + desc +
    '</button>';
  }

  function railHtml(id, s){
    if(!id){
      return '<aside class="hm-rail">' +
        '<span class="hm-rail-ic">' + ic('chart', 26) + '</span>' +
        '<b class="hm-rail-empty-t">' + esc(L('Your numbers live here', 'أرقامك رح تبيّن هون')) + '</b>' +
        '<p class="hm-rail-empty-b">' + esc(L('Pick your major and this fills in with your GPA, your progress and when you graduate.',
          'اختار تخصصك وهاد المكان بيتعبّى بمعدلك وتقدّمك وإمتى رح تتخرج.')) + '</p>' +
        '<button type="button" class="hm-rail-btn" data-hm-go="plan">' + esc(L('Pick my major', 'اختار تخصصي')) + '</button>' +
      '</aside>';
    }
    var C = 2 * Math.PI * 36, dash = Math.max(0.01, C * s.pct / 100);
    var rows = '';
    function row(label, valueHtml){
      rows += '<div class="hm-rail-row"><span>' + esc(label) + '</span><span class="hm-rail-v">' + valueHtml + '</span></div>';
    }
    if(s.gpa != null){
      var st = s.standing || {};
      row(L('GPA', 'المعدل'), '<b>' + s.gpa.toFixed(2) + '</b>' +
        (st.label ? '<span class="hm-badge ' + esc(st.cls || '') + '">' + esc(ar() ? st.ar : st.label) + '</span>' : ''));
    } else {
      row(L('GPA', 'المعدل'), '<span class="hm-dim">' + esc(L('No grades yet', 'لا توجد علامات بعد')) + '</span>');
    }
    if(s.health){
      row(L('Plan health', 'صحة الخطة'), '<b class="hm-letter">' + esc(s.health.letter) + '</b><span class="hm-dim">' + esc(ar() ? s.health.ar : s.health.en) + '</span>');
    }
    if(s.finish){
      row(L('Projected finish', 'التخرج المتوقع'), '<b>' + esc(s.finish.term) + '</b><span class="hm-dim">' + esc(s.finish.left) + '</span>');
    }
    return '<aside class="hm-rail">' +
      '<span class="hm-rail-kicker">' + esc(L('Your plan at a glance', 'خطتك بلمحة')) + '</span>' +
      '<b class="hm-rail-name">' + clean(planName(plans()[id])) + '</b>' +
      '<div class="hm-rail-ring">' +
        '<svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">' +
          '<circle cx="46" cy="46" r="36" fill="none" class="hm-ring-track" stroke-width="10"></circle>' +
          '<circle cx="46" cy="46" r="36" fill="none" class="hm-ring-val" stroke-width="10" stroke-linecap="round" stroke-dasharray="' +
            dash.toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 46 46)"></circle></svg>' +
        '<span><b class="hm-rail-pct">' + s.pct + '%</b><span class="hm-dim">' +
          esc(L(s.done + ' of ' + s.total + ' hours', s.done + ' من ' + s.total + ' ساعة')) + '</span></span>' +
      '</div>' +
      '<div class="hm-rail-rows">' + rows + '</div>' +
      '<button type="button" class="hm-rail-btn" data-hm-go="plan">' + esc(L('Open my plan', 'افتح خطتي')) + '</button>' +
    '</aside>';
  }

  // Developer is hidden from students: seven taps on the version number in a
  // row (each within 1.5s of the last) reveal it, and it stays revealed on
  // this device. The password behind it is unchanged.
  var DEV_KEY = 'aaup_dev_shown';
  var verTaps = 0, verLast = 0;
  function devShown(){ try{ return localStorage.getItem(DEV_KEY) === '1'; }catch(e){ return false; } }
  function verTap(){
    if(devShown()) return;
    var now = Date.now();
    verTaps = (now - verLast < 1500) ? verTaps + 1 : 1;
    verLast = now;
    if(verTaps < 7) return;
    verTaps = 0;
    try{ localStorage.setItem(DEV_KEY, '1'); }catch(e){}
    if(window.__showToast) window.__showToast(L('Developer mode is on', 'وضع المطوّر شغّال'));
    render();
  }

  function render(){
    var host = document.getElementById('taskHome');
    if(!host) return;
    var id = selected();
    var s = id ? stats(id) : {};
    var rtl = ar();
    host.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    host.setAttribute('lang', rtl ? 'ar' : 'en');
    host.innerHTML =
      '<section class="hm-hero">' +
        '<img class="hm-hero-art" src="assets/img/landing-campus.webp" alt="" aria-hidden="true">' +
        '<div class="hm-top">' +
          '<span class="hm-brand"><img src="assets/icons/favicon.png" alt="" aria-hidden="true">AAUPath</span>' +
          '<span class="hm-top-actions">' +
            '<button type="button" class="hm-iconbtn" data-hm-lang aria-label="' + esc(L('Switch to Arabic', 'Switch to English')) + '">' + (rtl ? 'EN' : 'ع') + '</button>' +
            '<button type="button" class="hm-iconbtn" data-hm-settings aria-label="' + esc(L('Settings', 'الإعدادات')) + '">' + ic('gear', 20) + '</button>' +
          '</span>' +
        '</div>' +
        '<div class="hm-hero-body">' +
          '<span class="hm-greet">' + esc(greeting()) + '</span>' +
          '<h1 class="hm-title">' + esc(L('What do you need?', 'شو بدك؟')) + '</h1>' +
          '<div class="hm-search">' +
            '<label for="hmSearch" class="hm-sr">' + esc(L('Search AAUPath', 'ابحث في AAUPath')) + '</label>' +
            '<span class="hm-search-ic" aria-hidden="true">' + ic('search', 22) + '</span>' +
            '<input id="hmSearch" type="search" autocomplete="off" enterkeyhint="search" value="' + esc(state.q) + '" placeholder="' + esc(hint()) + '">' +
            '<button type="button" class="hm-search-cancel" data-hm-cancel>' + esc(L('Cancel', 'إلغاء')) + '</button>' +
            '<div class="hm-results" id="hmResults" role="listbox" hidden></div>' +
          '</div>' +
          '<div class="hm-try"><span>' + esc(L('Try', 'جرّب')) + '</span>' +
            CHIPS[rtl ? 'ar' : 'en'].map(function(c){ return '<button type="button" class="hm-chip" data-hm-q="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') +
          '</div>' +
        '</div>' +
      '</section>' +
      '<div class="hm-body">' +
        '<div class="hm-main">' +
          '<div class="home-install-row" id="homeInstallRow" hidden></div>' +
          '<span class="hm-label hm-label-desk">' + esc(L('Everything in AAUPath', 'كل إشي في AAUPath')) + '</span>' +
          '<div class="hm-grid">' + FEATURES.map(function(f){ return cardHtml(f, id, s); }).join('') + '</div>' +
          '<div class="hm-also"><span class="hm-label">' + esc(L('Also here', 'كمان هون')) + '</span>' +
            EXTRAS.filter(function(f){ return !f.onlyWithPlan || id; }).map(function(f){ return '<button type="button" class="hm-pill" data-hm-go="' + f.key + '">' + ic(f.icon, 15) + esc(L(f.en, f.ar)) + '</button>'; }).join('') +
          '</div>' +
          '<div class="hm-foot"><button type="button" class="app-version-badge hm-ver" data-hm-ver>v' + esc(window.APP_VERSION || '?') + '</button>' +
            (devShown() ? '<button type="button" class="dev-link" data-hm-dev>' + esc(L('Developer', 'المطوّر')) + '</button>' : '') + '</div>' +
        '</div>' +
        railHtml(id, s) +
      '</div>';
    if(window.AAUP_INSTALL) window.AAUP_INSTALL.refresh();
    renderResults();
  }

  // ---------------------------------------------------------------------
  // Search — features, instructors, courses and majors, in one list.
  //
  // Courses come from every plan on the device (js/03-search.js keeps that
  // index), the student's own plan first. The same course sits in dozens of
  // plans, so each is listed once, from the first plan that has it.
  function courseResults(q){
    if(!window.AAUP_SEARCH) return [];
    var seen = {}, out = [];
    var S = window.AAUP_SEARCH;
    S.allCourses().some(function(c){
      var hay = norm(c.en + ' ' + c.ar + ' ' + c.code);
      if(hay.indexOf(q) < 0 && !(q.length >= 4 && S.fuzzyContains(q, norm(c.en)))) return false;
      var key = norm(c.en) + '|' + c.code;
      if(seen[key]) return false;
      seen[key] = true;
      out.push({ kind: L('Course', 'مساق'), title: plain(ar() && c.ar ? c.ar : c.en),
                 sub: plain((c.code ? c.code + ' \u00b7 ' : '') + c.where), go: 'c:' + c.page + '|' + c.slug });
      return out.length >= 30;
    });
    return out;
  }

  function results(){
    var q = norm(state.q.trim());
    if(!q) return [];
    var out = [];
    everything().forEach(function(f){
      var hay = norm(f.en + ' ' + f.ar);
      var hit = hay.indexOf(q) >= 0 || (f.words || []).some(function(w){ w = norm(w); return q.indexOf(w) >= 0 || w.indexOf(q) === 0; });
      if(hit) out.push({ kind: L('Feature', 'ميزة'), title: L(f.en, f.ar), sub: f.dEn ? L(f.dEn, f.dAr) : '', go: 'f:' + f.key });
    });
    if(contacts && contacts !== 'error' && contacts.contacts){
      contacts.contacts.forEach(function(c){
        if(c.category !== 'instructor') return;
        if(norm(c.name + ' ' + (c.courses || []).join(' ')).indexOf(q) >= 0){
          out.push({ kind: L('Professor', 'محاضر'), title: c.name, sub: (c.courses || []).join(' \u00b7 '), go: 'p:' + c.name });
        }
      });
    }
    out = out.concat(courseResults(q));
    var all = plans();
    Object.keys(all).forEach(function(id){
      var p = all[id];
      if(!p || !p.majorName) return;
      if(norm(planNameBoth(p)).indexOf(q) >= 0){
        out.push({ kind: L('Major', 'تخصص'), title: plain(planName(p)), sub: plain(collegeName(collegeKey(p), p)), go: 'm:' + id });
      }
    });
    return out;
  }

  // Results grouped by kind: courses first (what people search for most),
  // then professors, majors and features. Each group shows its first few
  // with "Show all" for the rest. On a phone the results are the whole page.
  var GROUP_ORDER = ['c:', 'p:', 'm:', 'f:'];
  var GROUP_NAME = { 'c:': ['Courses', 'مساقات'], 'p:': ['Professors', 'محاضرين'], 'm:': ['Majors', 'تخصصات'], 'f:': ['In the app', 'بالتطبيق'] };
  var GROUP_CAP = 4;
  var openGroups = {};

  function renderResults(){
    var box = document.getElementById('hmResults');
    var host = document.getElementById('taskHome');
    if(!box || !host) return;
    var q = state.q.trim();
    host.classList.toggle('hm-has-q', !!q);
    if(!q){ box.hidden = true; box.innerHTML = ''; openGroups = {}; return; }
    var rs = results();
    var groups = {};
    rs.forEach(function(r){ var k = r.go.slice(0, 2); (groups[k] = groups[k] || []).push(r); });
    box.innerHTML = GROUP_ORDER.filter(function(k){ return groups[k]; }).map(function(k){
      var list = groups[k], all = openGroups[k] || list.length <= GROUP_CAP + 1;
      var shown = all ? list : list.slice(0, GROUP_CAP);
      return '<div class="hm-group" role="group" aria-label="' + esc(L(GROUP_NAME[k][0], GROUP_NAME[k][1])) + '">' +
        '<div class="hm-group-h">' + esc(L(GROUP_NAME[k][0], GROUP_NAME[k][1])) + ' <span>' + list.length + '</span></div>' +
        shown.map(function(r){
          return '<button type="button" class="hm-res" role="option" data-hm-res="' + esc(r.go) + '">' +
            '<span class="hm-res-body"><b>' + esc(r.title) + '</b>' + (r.sub ? '<span>' + esc(r.sub) + '</span>' : '') + '</span></button>';
        }).join('') +
        (all ? '' : '<button type="button" class="hm-res-more" data-hm-more="' + k + '">' +
          esc(L('Show all ' + list.length, 'اعرض الكل (' + list.length + ')')) + '</button>') +
        '</div>';
    }).join('') +
      '<button type="button" class="hm-res hm-res-ask" data-hm-res="ask">' + ic('chatdots', 17) +
        esc(rs.length ? L('Ask AAUPath: “' + q + '”', 'اسأل AAUPath: «' + q + '»')
                      : L('Nothing matches that. Ask AAUPath instead', 'ما في نتيجة. اسأل AAUPath بدالها')) + '</button>';
    box.hidden = false;
  }

  function isPhone(){ return !!(window.matchMedia && window.matchMedia('(max-width: 899px)').matches); }
  function clearSearch(){
    var had = history.state && history.state.hmSearch;
    state.q = '';
    var input = document.getElementById('hmSearch');
    if(input) input.value = '';
    renderResults();
    if(had){ try{ history.back(); }catch(e){} }
  }

  function runResult(code){
    if(code === 'ask'){
      var q = state.q.trim();
      if(window.AAUP_ASSISTANT_UI){ window.AAUP_ASSISTANT_UI.open(); if(q) window.AAUP_ASSISTANT_UI.send(q); }
      return;
    }
    var kind = code.slice(0, 2), val = code.slice(2);
    if(kind === 'f:') go(val);
    else if(kind === 'p:') window.AAUP_CONTACTS.open(selected(), { category: 'instructor', query: val });
    else if(kind === 'm:') choose(val, 'plan');
    else if(kind === 'c:'){
      var bar = val.indexOf('|');
      window.AAUP_SEARCH.openCourse(val.slice(0, bar), val.slice(bar + 1));
    }
  }

  // ---------------------------------------------------------------------
  // The one-time question: college, then major.
  function sheetEl(){
    var el = document.getElementById('hmSheetOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'hmSheetOverlay';
    el.className = 'hm-sheet-overlay';
    el.innerHTML = '<div class="hm-sheet" role="dialog" aria-modal="true" aria-labelledby="hmSheetTitle"></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      if(e.target === el){ closeSheet(); return; }
      var t = e.target.closest ? e.target : null;
      if(!t) return;
      var b;
      if((b = t.closest('[data-hm-college]'))){ state.sheetCollege = b.getAttribute('data-hm-college'); renderSheet(); focusSheet(); }
      else if((b = t.closest('[data-hm-major]'))){ choose(b.getAttribute('data-hm-major'), state.sheetKey); }
      else if(t.closest('[data-hm-back]')){ state.sheetCollege = null; renderSheet(); focusSheet(); }
      else if(t.closest('[data-hm-close]')){ closeSheet(); }
      else if(t.closest('[data-hm-newplan]')){
        // Started from inside a college, the new plan is filed under it.
        var key = state.sheetCollege, col = key && (window.APP_COLLEGES || {})[key];
        closeSheet();
        window.AAUP_PLAN_EDITOR.openNewPlanDialog(col ? { university: col.university, college: key } : null);
      }
      else if(t.closest('[data-hm-retry]')){ if(window.__retryCatalogue) window.__retryCatalogue(); renderSheetList(); }
    });
    el.addEventListener('input', function(e){
      if(e.target && e.target.id === 'hmSheetSearch'){
        state.sheetQ = e.target.value;
        renderSheetList();
      }
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && el.classList.contains('open')) closeSheet();
    });
    return el;
  }

  function majorRow(id, p, withCollege){
    var pending = isPending(p);
    return '<button type="button" class="hm-row" data-hm-major="' + esc(id) + '">' +
      '<span class="hm-row-body"><b>' + clean(planName(p)) + '</b>' +
        (withCollege ? '<span>' + clean(collegeName(collegeKey(p), p)) + '</span>'
                     : (nameSide(p).small && !pending ? '<span>' + clean(nameSide(p).small) + '</span>' : '')) + '</span>' +
      (pending ? '<span class="hm-soon">' + esc(L('Coming soon', 'قريبًا')) + '</span>' : '') +
    '</button>';
  }

  function sheetListHtml(){
    var all = plans(), q = norm(state.sheetQ.trim());
    // Nothing on the device yet: the catalogue is still arriving, or its first
    // read failed. An empty list would read as "this app has no majors".
    if(!Object.keys(all).length){
      return window.__catalogueStatus === 'failed'
        ? '<p class="hm-none">' + esc(L('Could not load the list of majors. Check your connection.', 'ما قدرنا نحمّل قائمة التخصصات. تأكد من الاتصال.')) + '</p>' +
          '<button type="button" class="hm-pill" data-hm-retry>' + esc(L('Try again', 'حاول مرة ثانية')) + '</button>'
        : '<p class="hm-none">' + esc(L('Loading the list of majors\u2026', 'عم نحمّل قائمة التخصصات\u2026')) + '</p>';
    }
    if(q){
      var hits = Object.keys(all).filter(function(id){ return all[id] && all[id].majorName && norm(planNameBoth(all[id])).indexOf(q) >= 0; });
      hits.sort(function(a, b){ return planName(all[a]).localeCompare(planName(all[b]), ar() ? 'ar' : 'en'); });
      return hits.length ? hits.map(function(id){ return majorRow(id, all[id], true); }).join('')
        : '<p class="hm-none">' + esc(L('No major matches that.', 'ما في تخصص بهالاسم.')) + '</p>';
    }
    if(state.sheetCollege != null){
      var g = colleges().filter(function(c){ return c.key === state.sheetCollege; })[0];
      return g ? g.ids.map(function(id){ return majorRow(id, all[id], false); }).join('') : '';
    }
    return colleges().map(function(c){
      var n = c.ids.length;
      return '<button type="button" class="hm-row" data-hm-college="' + esc(c.key) + '">' +
        '<span class="hm-row-body"><b>' + clean(c.name) + '</b><span>' +
          esc(n === 1 ? L('1 major', 'تخصص واحد') : L(n + ' majors', n + ' تخصصات')) + '</span></span>' +
        '<span class="hm-chev" aria-hidden="true">' + ic('chevronRight', 18) + '</span></button>';
    }).join('');
  }

  function renderSheet(){
    var el = sheetEl(), card = el.querySelector('.hm-sheet');
    var inCollege = state.sheetCollege != null && !state.sheetQ.trim();
    var g = inCollege ? colleges().filter(function(c){ return c.key === state.sheetCollege; })[0] : null;
    var reason = REASON[state.sheetKey] || REASON.other;
    card.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    card.innerHTML =
      '<span class="hm-grab" aria-hidden="true"></span>' +
      '<div class="hm-sheet-head">' +
        (inCollege ? '<button type="button" class="hm-iconbtn hm-back" data-hm-back aria-label="' + esc(L('Back to colleges', 'رجوع للكليات')) + '">' + ic('chevronLeft', 20) + '</button>' : '') +
        '<div><h2 id="hmSheetTitle">' + (g ? clean(g.name) : esc(L('Which college is your major in?', 'تخصصك بأي كلية؟'))) + '</h2>' +
        '<p>' + esc(inCollege ? L('Pick your major.', 'اختار تخصصك.') : L(reason[0], reason[1])) + '</p></div>' +
      '</div>' +
      (inCollege ? '' :
        '<div class="hm-sheet-search"><label for="hmSheetSearch">' + esc(L('Or search every major', 'أو دوّر بكل التخصصات')) + '</label>' +
        '<input id="hmSheetSearch" type="search" autocomplete="off" value="' + esc(state.sheetQ) + '" placeholder="' + esc(L('e.g. Computer Science', 'مثلًا: علوم الحاسوب')) + '"></div>') +
      '<div class="hm-sheet-list" id="hmSheetList">' + sheetListHtml() + '</div>' +
      '<div class="hm-sheet-foot">' +
        '<button type="button" class="hm-link" data-hm-newplan>' + esc(L('Don’t see your major? Create a plan', 'تخصصك مش موجود؟ أنشئ خطة')) + '</button>' +
        '<button type="button" class="hm-pill" data-hm-close>' + esc(L('Not now', 'مش هلق')) + '</button>' +
      '</div>';
  }
  function renderSheetList(){
    var list = document.getElementById('hmSheetList');
    if(list) list.innerHTML = sheetListHtml();
  }
  function focusSheet(){
    var el = document.getElementById('hmSheetOverlay');
    var first = el && (el.querySelector('#hmSheetSearch') || el.querySelector('.hm-row'));
    if(first) first.focus({ preventScroll: true });
  }

  function openSheet(key){
    state.sheetKey = key; state.sheetCollege = null; state.sheetQ = '';
    renderSheet();
    sheetEl().classList.add('open');
    focusSheet();
  }
  function closeSheet(){
    var el = document.getElementById('hmSheetOverlay');
    if(el) el.classList.remove('open');
    state.sheetKey = null;
  }

  // A major has been picked, from the sheet or straight from search: remember
  // it (the dashboard's own selection), then do what was asked for.
  function choose(id, key){
    var p = plans()[id];
    if(!p) return;
    closeSheet();
    if(isPending(p)){
      if(window.AAUP_IMPORTED && window.AAUP_IMPORTED.notePending) window.AAUP_IMPORTED.notePending(id);
      return;
    }
    var had = selected();
    window.AAUP_DASHBOARD.select(id);
    if(!had) toast(L('Saved your major. AAUPath won’t ask again.', 'انحفظ تخصصك. مش رح نسألك مرة تانية.'));
    render();
    go(key || 'plan');
  }

  // ---------------------------------------------------------------------
  function show(){
    ['dashboard', 'importedPlanView'].forEach(function(k){
      var el = document.getElementById(k);
      if(el) el.style.display = 'none';
    });
    var home = document.getElementById('home');
    if(home) home.style.display = 'block';
    var host = document.getElementById('taskHome');
    if(host) host.hidden = false;
    if(window.AAUP_SIDEBAR) window.AAUP_SIDEBAR.hide();
    render();
    window.scrollTo(0, 0);
    if(window.AAUP_TUTORIAL) window.AAUP_TUTORIAL.startWhenClear('home');
  }
  function visible(){
    var home = document.getElementById('home'), host = document.getElementById('taskHome');
    return !!(home && host && home.style.display !== 'none' && !host.hidden);
  }

  function bind(){
    var host = document.getElementById('taskHome');
    if(!host || host.__hmBound) return;
    host.__hmBound = true;
    host.addEventListener('click', function(e){
      var t = e.target, b;
      if(!t || !t.closest) return;
      if((b = t.closest('[data-hm-go]'))) go(b.getAttribute('data-hm-go'));
      else if((b = t.closest('[data-hm-res]'))) runResult(b.getAttribute('data-hm-res'));
      else if((b = t.closest('[data-hm-q]'))){
        state.q = b.getAttribute('data-hm-q');
        var input = document.getElementById('hmSearch');
        if(input){ input.value = state.q; input.focus(); }
        renderResults();
      }
      else if(t.closest('[data-hm-lang]')){ if(window.AAUP_LANG) window.AAUP_LANG.toggle(); }
      else if(t.closest('[data-hm-settings]')){ if(window.AAUP_SIDEBAR) window.AAUP_SIDEBAR.openSettings(); }
      else if(t.closest('[data-hm-dev]')){ if(window.AAUP_DEV) window.AAUP_DEV.openDialog(); }
      else if(t.closest('[data-hm-ver]')) verTap();
      else if((b = t.closest('[data-hm-more]'))){ openGroups[b.getAttribute('data-hm-more')] = true; renderResults(); }
      else if(t.closest('[data-hm-cancel]')) clearSearch();
    });
    host.addEventListener('input', function(e){
      if(e.target && e.target.id === 'hmSearch'){
        var was = !!state.q.trim();
        state.q = e.target.value;
        // On a phone the results are a page of their own, so the phone's
        // Back button should close them rather than leave the app.
        if(!was && state.q.trim() && isPhone()){
          try{ history.pushState({ hmSearch: 1 }, ''); }catch(err){}
        }
        renderResults();
      }
    });
    window.addEventListener('popstate', function(){
      if(state.q && visible()){ state.q = ''; var i = document.getElementById('hmSearch'); if(i) i.value = ''; renderResults(); }
    });
    host.addEventListener('keydown', function(e){
      if(e.target && e.target.id === 'hmSearch' && e.key === 'Enter'){
        var first = host.querySelector('[data-hm-res]');
        if(first){ e.preventDefault(); first.click(); }
      }
      if(e.target && e.target.id === 'hmSearch' && e.key === 'Escape' && state.q) clearSearch();
    });
    // Tapping anywhere else closes an open results list on a wide screen,
    // where it floats over the cards.
    document.addEventListener('click', function(e){
      if(!state.q || !visible()) return;
      if(e.target.closest && e.target.closest('.hm-search')) return;
      if(window.matchMedia && window.matchMedia('(min-width: 900px)').matches){
        var box = document.getElementById('hmResults');
        if(box) box.hidden = true;
      }
    });
    host.addEventListener('focusin', function(e){
      if(e.target && e.target.id === 'hmSearch' && state.q) renderResults();
    });
  }

  // The placeholder walks through real searches so the box shows what it
  // can do. It stays put for anyone who asks their device for less motion.
  function startHints(){
    if(hintTimer) return;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(calm) return;
    hintTimer = setInterval(function(){
      if(!visible()) return;
      state.hint++;
      var input = document.getElementById('hmSearch');
      if(input) input.setAttribute('placeholder', hint());
    }, 3200);
  }

  // Redraw when the language changes from anywhere — this screen and the
  // sheet are both built in the language they were opened in.
  function watchLanguage(){
    var Lang = window.AAUP_LANG;
    if(!Lang || Lang.__hmWrapped) return;
    ['set', 'toggle'].forEach(function(k){
      var orig = Lang[k];
      Lang[k] = function(){
        var r = orig.apply(Lang, arguments);
        if(visible()) render();
        var sheet = document.getElementById('hmSheetOverlay');
        if(sheet && sheet.classList.contains('open')) renderSheet();
        return r;
      };
    });
    Lang.__hmWrapped = true;
  }

  // The catalogue lands a moment after the page does, and plans are saved,
  // synced and deleted while the app is open. Each fires 'aaup:plans'
  // (js/28-imported.js, js/01-catalogue.js); redraw once for a burst of them,
  // and only what is on screen.
  var redrawQueued = false;
  function onPlansChanged(){
    if(redrawQueued) return;
    redrawQueued = true;
    setTimeout(function(){
      redrawQueued = false;
      if(visible()) render();
      var sheet = document.getElementById('hmSheetOverlay');
      if(sheet && sheet.classList.contains('open')) renderSheetList();
    }, 0);
  }

  function init(){
    bind();
    watchLanguage();
    window.addEventListener('aaup:plans', onPlansChanged);
    startHints();
    if(window.AAUP_CONTACTS && window.AAUP_CONTACTS.data){
      window.AAUP_CONTACTS.data().then(function(d){ contacts = d; if(state.q) renderResults(); });
    }
    show();
  }

  window.AAUP_TASK_HOME = { show: show, render: render, openSheet: openSheet, go: go, visible: visible };
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
