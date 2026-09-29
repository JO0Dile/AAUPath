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
  // "ai" finds Artificial Intelligence, any word order, Arabic "ال" (js/03-search.js).
  function smart(q, text){ return !!(window.AAUP_SEARCH && window.AAUP_SEARCH.smartMatch && window.AAUP_SEARCH.smartMatch(q, text)); }
  // One test for every kind of result. A short query (3 letters or fewer)
  // only counts at the start of a word or as initials, so "cs" is Computer
  // Science and not the end of "Mathematics".
  function found(q, text){
    if(q.length <= 3) return smart(q, text);
    return norm(text).indexOf(q) >= 0 || smart(q, text);
  }
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
    // My Week: the class times, with "Add to my calendar" inside them. It
    // took the place of the two cards My Schedule and My Class Times.
    { key: 'classes', icon: 'clock', needs: true, en: 'My Week', ar: 'أسبوعي',
      dEn: 'Class times, and your calendar', dAr: 'أوقات محاضراتك، وتقويمك',
      words: ['class', 'time', 'timetable', 'lecture', 'room', 'week', 'محاضر', 'وقت', 'أوقات', 'ساعات', 'موعد', 'قاعة', 'أسبوع'],
      run: function(id){ window.AAUP_TIMETABLE.open(id); } },
    { key: 'ach', icon: 'trophy', needs: true, en: 'Achievements', ar: 'الإنجازات',
      dEn: 'Badges you’ve earned so far', dAr: 'الشارات اللي حصّلتها لهلق',
      words: ['achiev', 'badge', 'إنجاز', 'شار'],
      run: function(id){ window.AAUP_ACHIEVEMENTS.open(id); } }
  ];
  // ---- Arrange Home (idea 18) ------------------------------------------------
  // The student's own order for the cards, and where each thing lives: on
  // Home as a card, or in the More row under the cards. Cards start on Home
  // and the small extras (switch major, share, about, what's new) start in
  // More; Arrange moves either way.
  //   order:  the Home order (card and extra keys)
  //   hidden: cards moved to More (the name is older than More)
  //   out:    extras brought out onto Home
  var ARRANGE_KEY = 'aaup_homeArrange';
  function arrangeCfg(){
    var c = window.AAUP_STORAGE ? window.AAUP_STORAGE.getJSON(ARRANGE_KEY, {}) : {};
    var arr = function(v){ return Array.isArray(v) ? v : []; };
    return { order: arr(c && c.order), hidden: arr(c && c.hidden), out: arr(c && c.out) };
  }
  function saveArrange(c){ if(window.AAUP_STORAGE) window.AAUP_STORAGE.setJSON(ARRANGE_KEY, c); }
  function isExtra(key){ return EXTRAS.some(function(f){ return f.key === key; }); }
  function offered(f){ return !f.onlyWithPlan || !!selected(); }
  function onHome(f, c){ return isExtra(f.key) ? c.out.indexOf(f.key) >= 0 : c.hidden.indexOf(f.key) < 0; }
  // Everything that can be a card or a More row, in the student's order.
  function orderedFeatures(){
    var order = arrangeCfg().order, byKey = {};
    var pool = FEATURES.concat(EXTRAS).filter(offered);
    pool.forEach(function(f){ byKey[f.key] = f; });
    var out = [];
    order.forEach(function(k){ if(byKey[k]){ out.push(byKey[k]); delete byKey[k]; } });
    pool.forEach(function(f){ if(byKey[f.key]) out.push(f); });   // new ones join at the end
    return out;
  }
  function arrangedFeatures(){
    var c = arrangeCfg();
    return orderedFeatures().filter(function(f){ return onHome(f, c); });
  }
  function moreFeatures(){
    var c = arrangeCfg();
    return orderedFeatures().filter(function(f){ return !onHome(f, c); });
  }

  function arrangeRowsHtml(){
    var shown = arrangedFeatures();
    var off = moreFeatures();
    var row = function(f, isHidden, i, n){
      return '<div class="arr-row' + (isHidden ? ' is-hidden' : '') + '" data-arr-key="' + f.key + '">' +
        (isHidden ? '' : '<span class="arr-handle" aria-hidden="true">' + ic('menu', 16) + '</span>') +
        '<span class="arr-ic">' + ic(f.icon, 16) + '</span>' +
        '<span class="arr-name">' + esc(titleOf(f)) + '</span>' +
        (isHidden ? '' :
          '<button type="button" class="arr-mv" data-arr-up="' + f.key + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="' + esc(L('Move up', 'لفوق')) + '">↑</button>' +
          '<button type="button" class="arr-mv" data-arr-down="' + f.key + '"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="' + esc(L('Move down', 'لتحت')) + '">↓</button>') +
        '<button type="button" class="arr-hide" data-arr-toggle="' + f.key + '">' + esc(isHidden ? L('Put on Home', 'حطّها بالرئيسية') : L('Move to More', 'انقلها لـ المزيد')) + '</button>' +
        '</div>';
    };
    return '<div class="arr-list" id="arrShown">' + shown.map(function(f, i){ return row(f, false, i, shown.length); }).join('') + '</div>' +
      (off.length ? '<div class="arr-sub">' + esc(L('In More', 'بـ المزيد')) + '</div>' +
        '<div class="arr-list">' + off.map(function(f){ return row(f, true); }).join('') + '</div>' : '');
  }
  function arrangeOverlay(){
    var el = document.getElementById('hmArrangeOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'hmArrangeOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card arr-card" role="dialog" aria-modal="true" aria-labelledby="arrTitle"><div class="modal-body" id="arrBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      var t = e.target, b, c = arrangeCfg();
      if(t === el || t.closest('[data-arr-done]')){ el.classList.remove('open'); render(); return; }
      if(t.closest('[data-arr-reset]')){ saveArrange({ order: [], hidden: [], out: [] }); renderArrange(); return; }
      var keys = arrangedFeatures().map(function(f){ return f.key; });
      var offKeys = moreFeatures().map(function(f){ return f.key; });
      if((b = t.closest('[data-arr-up]')) || (b = t.closest('[data-arr-down]'))){
        var k = b.getAttribute('data-arr-up') || b.getAttribute('data-arr-down');
        var i = keys.indexOf(k), j = b.hasAttribute('data-arr-up') ? i - 1 : i + 1;
        if(i < 0 || j < 0 || j >= keys.length) return;
        keys.splice(j, 0, keys.splice(i, 1)[0]);
        c.order = keys.concat(offKeys);
        saveArrange(c); renderArrange();
        return;
      }
      if((b = t.closest('[data-arr-toggle]'))){
        var key = b.getAttribute('data-arr-toggle');
        var list = isExtra(key) ? c.out : c.hidden;
        if(list.indexOf(key) >= 0) list.splice(list.indexOf(key), 1); else list.push(key);
        c.order = orderedFeatures().map(function(f){ return f.key; });
        saveArrange(c); renderArrange();
      }
    });
    // Drag by the handle: the row follows the finger and the others make
    // room; the order is saved when it is let go.
    var drag = null;
    el.addEventListener('pointerdown', function(e){
      var h = e.target.closest && e.target.closest('.arr-handle');
      if(!h) return;
      var rowEl = h.closest('.arr-row');
      drag = { row: rowEl, list: rowEl.parentNode };
      rowEl.classList.add('is-drag');
      try{ h.setPointerCapture(e.pointerId); }catch(err){}
      e.preventDefault();
    });
    el.addEventListener('pointermove', function(e){
      if(!drag) return;
      var rows = Array.prototype.filter.call(drag.list.children, function(r){ return r !== drag.row; });
      var before = null;
      for(var i = 0; i < rows.length; i++){
        var r = rows[i].getBoundingClientRect();
        if(e.clientY < r.top + r.height / 2){ before = rows[i]; break; }
      }
      if(before) drag.list.insertBefore(drag.row, before); else drag.list.appendChild(drag.row);
    });
    var end = function(){
      if(!drag) return;
      drag.row.classList.remove('is-drag');
      var c = arrangeCfg();
      c.order = Array.prototype.map.call(drag.list.children, function(r){ return r.getAttribute('data-arr-key'); })
        .concat(moreFeatures().map(function(f){ return f.key; }));
      saveArrange(c);
      drag = null;
      renderArrange();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && el.classList.contains('open')){ el.classList.remove('open'); render(); } });
    return el;
  }
  function renderArrange(){
    var body = document.getElementById('arrBody');
    if(!body) return;
    body.innerHTML =
      '<div class="arr-head"><h2 class="mh" id="arrTitle" style="margin:0;">' + esc(L('Arrange Home', 'رتّب الرئيسية')) + '</h2>' +
      '<button type="button" class="home-btn btn-pri btn-sm" data-arr-done>' + esc(L('Done', 'تم')) + '</button></div>' +
      '<p class="form-note" style="margin-top:0;">' + esc(L('Drag by the handle, or use the arrows. Move what you rarely use to More, or bring things out of it.', 'اسحب من المقبض أو استعمل الأسهم. انقل اللي نادرًا بتستعمله لـ المزيد، أو طلّع أشياء منه.')) + '</p>' +
      arrangeRowsHtml() +
      '<div class="form-actions" style="justify-content:flex-start;margin-top:10px;"><button type="button" class="home-btn btn-quiet btn-sm" data-arr-reset>' + esc(L('Back to the usual order', 'رجّع الترتيب الأصلي')) + '</button></div>';
  }
  function openArrange(){ arrangeOverlay().classList.add('open'); renderArrange(); }

  var EXTRAS = [
    // The one place to switch major: here, beside it. Only offered once a
    // major is chosen — before that, Choose a Plan is the same question.
    { key: 'switch', icon: 'shuffle', needs: true, onlyWithPlan: true, en: 'Switch major', ar: 'غيّر التخصص',
      dEn: 'Pick a different major', dAr: 'اختار تخصص ثاني',
      run: function(id){ window.AAUP_SIDEBAR.openPlanChooser(id); } },
    { key: 'share', icon: 'send', needs: true, en: 'Share my plan', ar: 'شارك خطتي',
      dEn: 'A link or picture of your plan', dAr: 'رابط أو صورة لخطتك',
      run: function(id){ window.AAUP_SHARE.open(id); } },
    { key: 'about', icon: 'help', needs: false, en: 'About', ar: 'عن التطبيق',
      dEn: 'Who made AAUPath, and how to reach them', dAr: 'مين عمل AAUPath وكيف توصله',
      run: function(){ window.AAUP_ABOUT.open(); } },
    { key: 'whatsnew', icon: 'news', needs: false, en: "What's new", ar: 'الجديد',
      dEn: 'Changes in the latest update', dAr: 'شو تغيّر بآخر تحديث',
      run: function(){ if(window.AAUP_WHATS_NEW) window.AAUP_WHATS_NEW.open(); } }
  ];
  // Found by search, never drawn as a card. University Contacts opened the
  // same screen as Find a Professor, just on a different tab, so the home
  // keeps one card for it — but "registration" or "finance" should still
  // land a student on the right tab.
  var SEARCH_ONLY = [
    // My Plan now carries progress (its Courses | Progress tabs) and My Week
    // carries the calendar, so these two left the grid; search still finds them.
    { key: 'sched', icon: 'calendar', needs: true, en: 'My Schedule', ar: 'جدولي',
      dEn: 'Your semesters on your calendar', dAr: 'فصولك على تقويمك',
      words: ['schedule', 'calendar', 'semester', 'جدول', 'تقويم', 'فصل'],
      run: function(id){ window.AAUP_CALENDAR.open(id); } },
    { key: 'progress', icon: 'chart', needs: true, en: 'Degree Progress', ar: 'تقدّمي الدراسي',
      dEn: 'How far you are and what is left', dAr: 'وين وصلت وشو ضايل',
      words: ['progress', 'audit', 'graduat', 'dashboard', 'تقدم', 'تخرج'],
      run: function(id){ window.AAUP_DASHBOARD.open(id); } },
    { key: 'finish', icon: 'check', needs: true, en: 'Finish this semester', ar: 'سكّر الفصل',
      dEn: 'Tick what you passed and add the grades, in one go', dAr: 'علّم اللي نجحت فيه وحط العلامات، مرة وحدة',
      words: ['end of semester', 'finish semester', 'semester over', 'انتهى الفصل', 'خلص الفصل', 'سكر الفصل', 'نهاية الفصل'],
      run: function(id){ window.AAUP_SEMESTER.open(id); } },
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

  // The name a card goes by: the plan card says My Plan once a major is chosen.
  function titleOf(f){ return (f.key === 'plan' && selected()) ? L('My Plan', 'خطتي') : L(f.en, f.ar); }
  function cardHtml(f, id, s){
    var val = '';
    if(id && f.key === 'gpa' && s.gpa != null) val = s.gpa.toFixed(2);
    if(id && f.key === 'plan') val = s.pct + '%';
    var title = titleOf(f);
    var desc = (f.key === 'plan' && id)
      ? '<span class="hm-card-desc hm-card-major">' + clean(planName(plans()[id])) + '</span>'
      : '<span class="hm-card-desc">' + esc(L(f.dEn, f.dAr)) + '</span>';
    return '<button type="button" class="hm-card" data-hm-go="' + f.key + '">' +
      '<span class="hm-card-top"><span class="hm-card-ic">' + ic(f.icon, 22) + '</span>' +
        (val ? '<span class="hm-card-val">' + esc(val) + '</span>' : '') + '</span>' +
      '<span class="hm-card-title">' + esc(title) + '</span>' + desc +
    '</button>';
  }

  // ---- More (round 7, idea 5) ---------------------------------------------------
  // One row under the cards instead of a line of small pills: it names what
  // is inside and opens them as a list. Arrange Home decides what lives here.
  function moreRowHtml(){
    var list = moreFeatures();
    if(!list.length) return '';
    return '<button type="button" class="hm-more-row" data-hm-more-open>' + ic('menu', 18) +
      '<span class="hm-more-body"><b>' + esc(L('More', 'المزيد')) + '</b><span>' +
        esc(list.map(titleOf).join(L(', ', '، '))) + '</span></span>' +
      '<span class="hm-more-go" aria-hidden="true">›</span></button>';
  }
  function moreOverlay(){
    var el = document.getElementById('hmMoreOverlay');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'hmMoreOverlay';
    el.className = 'modal-overlay';
    el.innerHTML = '<div class="modal-card hm-more-card" role="dialog" aria-modal="true" aria-labelledby="hmMoreTitle"><div class="modal-body" id="hmMoreBody"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function(e){
      if(e.target === el || e.target.closest('[data-hm-more-close]')){ el.classList.remove('open'); return; }
      var b = e.target.closest('[data-hm-more-go]');
      if(b){ el.classList.remove('open'); go(b.getAttribute('data-hm-more-go')); return; }
      if(e.target.closest('[data-hm-more-arrange]')){ el.classList.remove('open'); openArrange(); }
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && el.classList.contains('open')) el.classList.remove('open'); });
    return el;
  }
  function openMore(){
    moreOverlay().classList.add('open');
    document.getElementById('hmMoreBody').innerHTML =
      '<div class="arr-head"><h2 class="mh" id="hmMoreTitle" style="margin:0;">' + esc(L('More', 'المزيد')) + '</h2>' +
        '<button type="button" class="home-btn btn-quiet btn-sm" data-hm-more-close>' + esc(L('Close', 'إغلاق')) + '</button></div>' +
      '<div class="hm-more-list">' + moreFeatures().map(function(f){
        return '<button type="button" class="hm-more-item" data-hm-more-go="' + f.key + '">' +
          '<span class="arr-ic">' + ic(f.icon, 18) + '</span><span class="hm-more-body"><b>' + esc(titleOf(f)) + '</b>' +
          (f.dEn ? '<span>' + esc(L(f.dEn, f.dAr)) + '</span>' : '') + '</span></button>';
      }).join('') + '</div>' +
      '<button type="button" class="hm-arrange-link" data-hm-more-arrange>' + ic('menu', 14) + esc(L('Arrange Home', 'رتّب الرئيسية')) + '</button>';
  }

  // ---- Search that answers (round 7, idea 3) ------------------------------------
  // A few questions students actually type get the answer itself on top of
  // the results, from this phone's own data. Only these; anything else
  // searches exactly as before, so the results don't get busier.
  var ANSWERS = [
    { key: 'gpa', re: /^(my\s+)?(gpa|cgpa|average)$|^معدل(ي)?$|^المعدل$/ },
    { key: 'next', re: /^(my\s+)?next\s+(class|lecture)$|^(the\s+)?next$|^(المحاضرة|محاضرتي)\s*(الجاية|الجاي|القادمة)$/ },
    { key: 'left', re: /^(how\s+many\s+)?hours\s+(left|remaining)$|^(كم\s+)?(ضايل|باقي)$|^(الساعات\s+)?(الباقية|المتبقية)$|^كم\s+ساعة\s+(ضايل|باقي)$/ },
    { key: 'grad', re: /^(when\s+(do\s+|will\s+)?i\s+)?graduat(e|ion)$|^(متى|إمتى|امتى)\s+(بتخرج|رح\s+اتخرج)$|^التخرج$/ }
  ];
  var DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function nextClass(id){
    var T = window.AAUP_TIMETABLE;
    if(!T || !T.meetingsOn || !T.hasAny(id)) return null;
    var now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
    for(var k = 0; k < 7; k++){
      var day = (now.getDay() + k) % 7;
      var list = T.meetingsOn(id, day).filter(function(x){
        var p = String(x.s).split(':'); return k > 0 || (+p[0] * 60 + +p[1]) > nowM;
      });
      if(list.length) return { x: list[0], day: day, k: k };
    }
    return null;
  }
  function answerFor(raw){
    var id = selected();
    if(!id) return null;
    var q = String(raw || '').trim().toLowerCase().replace(/[?؟]+$/, '').replace(/\s+/g, ' ');
    var hit = ANSWERS.filter(function(a){ return a.re.test(q); })[0];
    if(!hit) return null;
    var s = stats(id);
    if(hit.key === 'gpa'){
      if(s.gpa == null) return { label: L('Your GPA', 'معدلك'), big: '—', sub: L('No grades yet', 'ما في علامات بعد'), go: 'gpa' };
      return { label: L('Your GPA', 'معدلك'), big: s.gpa.toFixed(2), sub: s.standing ? (ar() ? s.standing.ar : s.standing.label) : '', go: 'gpa' };
    }
    if(hit.key === 'left'){
      return { label: L('Hours left', 'الساعات الباقية'), big: String(Math.max(0, s.total - s.done)),
               sub: L(s.done + ' of ' + s.total + ' hours · ' + s.pct + '%', s.done + ' من ' + s.total + ' ساعة · ' + s.pct + '%'), go: 'plan' };
    }
    if(hit.key === 'grad'){
      if(!s.finish) return null;
      return { label: L('Projected finish', 'التخرج المتوقع'), big: s.finish.term, sub: s.finish.left || '', go: 'progress' };
    }
    var n = nextClass(id);
    if(!n) return { label: L('Next class', 'المحاضرة الجاية'), big: '—', sub: L('Add your class times to see it', 'ضيف أوقات محاضراتك لتشوفها'), go: 'classes' };
    var c = n.x.c, when = n.k === 0 ? L('Today', 'اليوم') : n.k === 1 ? L('Tomorrow', 'بكرا') : (ar() ? DAYS_AR[n.day] : DAYS_EN[n.day]);
    return { label: L('Next class', 'المحاضرة الجاية'), big: window.__fmtTime(n.x.s), sub: (ar() && c.ar ? c.ar : c.name) + ' · ' + when + (n.x.r ? ' · ' + n.x.r : ''), go: 'classes' };
  }
  function answerHtml(){
    var a = answerFor(state.q);
    if(!a) return '';
    return '<button type="button" class="hm-answer" data-hm-res="f:' + a.go + '">' +
      '<span class="hm-answer-l">' + esc(a.label) + '</span>' +
      '<b class="hm-answer-big">' + esc(a.big) + '</b>' +
      (a.sub ? '<span class="hm-answer-sub">' + esc(a.sub) + '</span>' : '') + '</button>';
  }
  // The "Ask AAUPath" line under results: always when nothing matched, and
  // otherwise only for what reads like a question (round 7, idea 4), so a
  // plain search like "calc" doesn't carry it every time.
  function looksLikeQuestion(q){
    q = String(q || '').trim().toLowerCase();
    if(/[?؟]/.test(q)) return true;
    if(/^(how|what|which|when|why|can|could|should|is|are|do|does|will|who|where|هل|كيف|شو|ايش|إيش|ليش|ليه|متى|إمتى|امتى|وين|مين|قديش|بقدر|ممكن)\b/.test(q)) return true;
    return q.split(/\s+/).length >= 4;
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

  // "This semester" (idea 2): most visits are "did I pass this?", so the
  // courses you are taking now sit on Home with a tick each. Taking now means
  // courses marked In progress; with none marked, it is the first semester of
  // the plan that still has something left in it.
  function thisSemester(id){
    var p = id && plans()[id];
    if(!p || !p.structure || !Array.isArray(p.structure.years)) return null;
    var progress = window.__getProgress ? window.__getProgress() : {};
    var statuses = window.AAUP_GPA && window.AAUP_GPA.loadStatuses ? window.AAUP_GPA.loadStatuses() : {};
    var real = (p.courses || []).filter(function(c){ return !(c.category === 'dept' && !c.placedByStudent) && (parseFloat(c.creditHours) || 0) > 0; });
    var taking = real.filter(function(c){ return statuses[id + '-c-' + c.id] === 'in_progress'; });
    if(taking.length) return { list: taking, now: true, progress: progress };
    var terms = [];
    p.structure.years.forEach(function(y, i){ ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).forEach(function(s){ terms.push({ y: y.id, s: s, n: i + 1 }); }); });
    for(var i = 0; i < terms.length; i++){
      var here = real.filter(function(c){ return c.yearId === terms[i].y && c.semester === terms[i].s; });
      if(here.some(function(c){ return !progress[id + '-c-' + c.id]; })){
        return { list: here, now: false, term: terms[i], progress: progress };
      }
    }
    return null;
  }
  // Pinned courses (idea 10): the ones a student chose from a course's ⋯
  // menu, at the top of Home, one tap from the course window.
  function pinnedHtml(id){
    var P = window.AAUP_PINS, p = id && plans()[id];
    if(!P || !p) return '';
    var byId = {};
    (p.courses || []).forEach(function(c){ byId[c.id] = c; });
    var list = P.list(id).map(function(sl){ return byId[sl]; }).filter(Boolean);
    if(!list.length) return '';
    var progress = window.__getProgress ? window.__getProgress() : {};
    return '<section class="hm-sem hm-pins" aria-label="' + esc(L('Pinned', 'مثبّتة')) + '">' +
      '<div class="hm-sem-h"><b>' + esc(L('Pinned', 'مثبّتة')) + '</b><span>' + list.length + '</span></div>' +
      list.map(function(c){
        var done = !!progress[id + '-c-' + c.id];
        var nm = plain(ar() && c.ar ? c.ar : c.name);
        return '<button type="button" class="hm-sem-row hm-pin-row' + (done ? ' is-done' : '') + '" data-hm-pin="' + esc(c.id) + '">' +
          '<span class="hm-sem-name">' + esc(nm) + '<small>' + (parseFloat(c.creditHours) || 0) + 'H' + (done ? ' · ' + esc(L('passed', 'منجز')) : '') + '</small></span>' +
          '<span class="hm-pin-go app-icon-dir" aria-hidden="true">' + ic('chevronRight', 16) + '</span></button>';
      }).join('') +
      '</section>';
  }
  function thisSemesterHtml(id){
    var ts = thisSemester(id);
    if(!ts || !ts.list.length) return '';
    var hours = ts.list.reduce(function(a, c){ return a + (parseFloat(c.creditHours) || 0); }, 0);
    var semName = { s1: L('first semester', 'الفصل الأول'), s2: L('second semester', 'الفصل الثاني'), s3: L('summer', 'الصيفي') };
    var title = ts.now ? L('Taking now', 'بآخذها هلأ')
      : L('Year ' + ts.term.n + ' · ' + semName[ts.term.s], 'السنة ' + ts.term.n + ' · ' + semName[ts.term.s]);
    return '<section class="hm-sem" aria-label="' + esc(L('This semester', 'هالفصل')) + '">' +
      '<div class="hm-sem-h"><b>' + esc(L('This semester', 'هالفصل')) + '</b>' +
        '<span>' + esc(title) + ' · ' + ts.list.length + ' · ' + hours + 'H</span></div>' +
      ts.list.slice(0, 7).map(function(c){
        var done = !!ts.progress[id + '-c-' + c.id];
        var nm = plain(ar() && c.ar ? c.ar : c.name);
        return '<div class="hm-sem-row' + (done ? ' is-done' : '') + '">' +
          '<span class="hm-sem-name">' + esc(nm) + '<small>' + (parseFloat(c.creditHours) || 0) + 'H</small></span>' +
          '<button type="button" class="hm-sem-tick" data-hm-tick="' + esc(c.id) + '" aria-pressed="' + done + '" aria-label="' +
            esc((done ? L('Passed: ', 'منجز: ') : L('Mark passed: ', 'علّمه منجز: ')) + nm) + '">' +
            (done ? ic('check', 14) + '<span>' + esc(L('passed', 'منجز')) + '</span>' : '<span class="hm-sem-circle"></span>') +
          '</button></div>';
      }).join('') +
      (window.AAUP_TIMETABLE ? window.AAUP_TIMETABLE.promptHtml(id) : '') +
      (window.AAUP_SEMESTER ? window.AAUP_SEMESTER.promptHtml(id) : '') +
      '</section>';
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
          (window.AAUP_DATES ? window.AAUP_DATES.homeHtml(id) : '') +
          (window.AAUP_TIMETABLE ? window.AAUP_TIMETABLE.todayHtml(id) : '') +
          pinnedHtml(id) +
          thisSemesterHtml(id) +
          '<span class="hm-label hm-label-desk">' + esc(L('Everything in AAUPath', 'كل إشي في AAUPath')) + '</span>' +
          '<div class="hm-grid">' + arrangedFeatures().map(function(f){ return cardHtml(f, id, s); }).join('') + '</div>' +
          moreRowHtml() +
          '<button type="button" class="hm-arrange-link" data-hm-arrange>' + ic('menu', 14) + esc(L('Arrange Home', 'رتّب الرئيسية')) + '</button>' +
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
      if(!found(q, c.en + ' ' + c.ar + ' ' + c.code) && !(q.length >= 4 && S.fuzzyContains(q, norm(c.en)))) return false;
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
      var hit = found(q, f.en + ' ' + f.ar) || (f.words || []).some(function(w){ w = norm(w); return q.indexOf(w) >= 0 || w.indexOf(q) === 0; });
      if(hit) out.push({ kind: L('Feature', 'ميزة'), title: L(f.en, f.ar), sub: f.dEn ? L(f.dEn, f.dAr) : '', go: 'f:' + f.key });
    });
    if(contacts && contacts !== 'error' && contacts.contacts){
      contacts.contacts.forEach(function(c){
        if(c.category !== 'instructor') return;
        var chay = c.name + ' ' + (c.courses || []).join(' ');
        if(found(q, chay)){
          out.push({ kind: L('Professor', 'محاضر'), title: c.name, sub: (c.courses || []).join(' \u00b7 '), go: 'p:' + c.name });
        }
      });
    }
    out = out.concat(courseResults(q));
    var all = plans();
    Object.keys(all).forEach(function(id){
      var p = all[id];
      if(!p || !p.majorName) return;
      if(found(q, planNameBoth(p))){
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
    if(!q){
      openGroups = {};
      // An empty box that has focus shows what you searched before.
      var rec = recent();
      if(document.activeElement && document.activeElement.id === 'hmSearch' && rec.length){
        box.innerHTML = '<div class="hm-group"><div class="hm-group-h">' + esc(L('Recent', 'بحثت عنه مؤخرًا')) + '</div>' +
          rec.map(function(r){
            return '<div class="hm-recent"><button type="button" class="hm-res" data-hm-q="' + esc(r) + '">' + ic('clock', 16) +
              '<span class="hm-res-body"><b>' + esc(r) + '</b></span></button>' +
              '<button type="button" class="hm-recent-x" data-hm-forget="' + esc(r) + '" aria-label="' + esc(L('Remove', 'احذف')) + '">' + ic('close', 14) + '</button></div>';
          }).join('') + '</div>';
        box.hidden = false;
      } else { box.hidden = true; box.innerHTML = ''; }
      return;
    }
    var rs = results();
    var answer = answerHtml();
    var groups = {};
    rs.forEach(function(r){ var k = r.go.slice(0, 2); (groups[k] = groups[k] || []).push(r); });
    box.innerHTML = answer + GROUP_ORDER.filter(function(k){ return groups[k]; }).map(function(k){
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
      ((!rs.length && !answer) || looksLikeQuestion(q)
        ? '<button type="button" class="hm-res hm-res-ask" data-hm-res="ask">' + ic('chatdots', 17) +
          esc(rs.length || answer ? L('Ask AAUPath: “' + q + '”', 'اسأل AAUPath: «' + q + '»')
                                  : L('Nothing matches that. Ask AAUPath instead', 'ما في نتيجة. اسأل AAUPath بدالها')) + '</button>'
        : '');
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

  // The last few things searched for, newest first, remembered on this device.
  var RECENT_KEY = 'aaup_recent_search';
  function recent(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 6); }catch(e){ return []; } }
  function remember(q){
    q = String(q || '').trim();
    if(q.length < 2) return;
    var list = recent().filter(function(x){ return x.toLowerCase() !== q.toLowerCase(); });
    list.unshift(q);
    try{ localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); }catch(e){}
  }
  function forget(q){
    try{ localStorage.setItem(RECENT_KEY, JSON.stringify(recent().filter(function(x){ return x !== q; }))); }catch(e){}
  }

  function runResult(code){
    remember(state.q);
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
        // Grey rows in the shape of the list that is coming, not a line of text.
        : (window.__skeletonHTML ? window.__skeletonHTML('line', 6, ar()) :
           '<p class="hm-none">' + esc(L('Loading the list of majors\u2026', 'عم نحمّل قائمة التخصصات\u2026')) + '</p>');
    }
    if(q){
      var hits = Object.keys(all).filter(function(id){ return all[id] && all[id].majorName && found(q, planNameBoth(all[id])); });
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
      else if(t.closest('[data-hm-arrange]')){ openArrange(); }
      else if(t.closest('[data-hm-more-open]')){ openMore(); }
      else if((b = t.closest('[data-hm-pin]'))){
        var pidPlan = selected();
        if(pidPlan && window.AAUP_IMPORTED){ ensurePlan(pidPlan); window.AAUP_IMPORTED.openCourseModal(pidPlan, b.getAttribute('data-hm-pin')); }
      }
      else if((b = t.closest('[data-hm-tick]'))){
        var tid = selected();
        if(tid && window.AAUP_IMPORTED){ ensurePlan(tid); window.AAUP_IMPORTED.toggle(tid, b.getAttribute('data-hm-tick')); render(); }
      }
      else if((b = t.closest('[data-hm-forget]'))){ forget(b.getAttribute('data-hm-forget')); var si = document.getElementById('hmSearch'); if(si) si.focus(); renderResults(); }
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
      if(e.target && e.target.id === 'hmSearch') renderResults();
    });
    // Recent searches close again when the box loses focus to anything
    // outside the list.
    host.addEventListener('focusout', function(e){
      if(!e.target || e.target.id !== 'hmSearch' || state.q.trim()) return;
      setTimeout(function(){
        var box = document.getElementById('hmResults'), a = document.activeElement;
        if(box && !state.q.trim() && !(a && (a.id === 'hmSearch' || box.contains(a)))){ box.hidden = true; box.innerHTML = ''; }
      }, 180);
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

  window.AAUP_TASK_HOME = { show: show, render: render, openSheet: openSheet, go: go, visible: visible, thisSemester: thisSemester };
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
