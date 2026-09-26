// ==========================
// APP SIDEBAR
// ==========================
// A persistent left-hand nav, shown whenever a plan is selected (Dashboard
// and My Study Plan alike), hidden on the Choose Plan screen. Every item
// routes to something that already exists — this is a navigation shell,
// not a new feature surface.
(function(){
  var BUILT_IN_ICONS = { robotics: '🤖', cybersecurity: '🔒', medical: '⚕️', cs: '💻' };
  var BUILT_IN_ICON_KEYS = { robotics: 'robot', cybersecurity: 'shield', medical: 'medical', cs: 'code' };

  function isImportedPlan(prefix){
    return !!(window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()[prefix]);
  }
  // The name at the top of the sidebar, above every menu item. It always
  // read the English side, so the one heading a student sees on every screen
  // was in English while the whole menu under it was in Arabic. Falls back
  // to English for a plan with no Arabic name.
  function planName(prefix){
    var arabic = ar();
    if(isImportedPlan(prefix)){
      var p = window.AAUP_IMPORTED.loadImportedPlans()[prefix];
      var side = arabic ? (p.majorName.ar || p.majorName.en) : p.majorName.en;
      var parts = window.AAUP_IMPORTED.nameParts(side);
      if(!parts.big){ parts = window.AAUP_IMPORTED.nameParts(p.majorName.en); }
      return parts.big;
    }
    var page = document.getElementById('page-' + prefix);
    var nameEl = page && page.querySelector('.title-block ' + (arabic ? '.ar' : '.en'));
    if(!nameEl || !nameEl.textContent.trim()){
      nameEl = page && page.querySelector('.title-block .en');
    }
    return nameEl ? nameEl.textContent : prefix;
  }

  // icon is a js/04-icons.js ICONS key, not an emoji — see that file's own
  // header for why: a hand-drawn line icon and an emoji next to each other
  // read as two different apps, so once one nav surface got real icons
  // every other one showing the same items had to as well.
  //
  // group is used only by the phone "More" sheet (see moreGroupsHtml below)
  // to organize this same list into labeled sections instead of one long
  // scroll — the desktop sidebar ignores it and renders ITEMS as one flat
  // list, exactly as it always has.
  //
  // 'edit' is deliberately first. It used to be a button on the plan page
  // itself, in a row with four navigation buttons — which meant the one
  // control that changes what the page IS looked exactly like the four that
  // only move you somewhere else. It is a mode, so it belongs where modes
  // are chosen, at the top of the menu, and the plan page is left showing
  // the plan.
  var ITEMS = [
    { key: 'edit', icon: 'pen', label: 'Edit Mode', ar: 'وضع التعديل', group: null, planOnly: true,
      action: function(prefix){ if(window.AAUP_IMPORTED) window.AAUP_IMPORTED.toggleEdit(prefix); } },
    { key: 'dashboard', icon: 'chart', label: 'Dashboard', ar: 'لوحة التحكم', group: null, action: function(prefix){ window.AAUP_DASHBOARD.open(prefix); } },
    { key: 'studyplan', icon: 'planpin', label: 'My Study Plan', ar: 'خطتي الدراسية', group: 'plan', action: function(prefix){ window.AAUP_DASHBOARD.openStudyPlan(prefix); } },
    // Four rows left this list, each into the screen that was already
    // answering the same question:
    //   My Path            -> requirement chips on the plan's own filter
    //   What if… (GPA)     -> the Degree Audit's second mode
    //   Plan My Next Sem.  -> under "You are here" on the plan
    //   Overview & Print   -> Share this plan, as the third way out
    { key: 'audit', icon: 'clipboard', label: 'Degree Audit & GPA', ar: 'التدقيق والمعدل', group: 'plan', action: function(prefix){ window.AAUP_AUDIT.open(prefix); } },
    // The split below is one rule: a row about THIS plan sits in the list,
    // anything that is not mainly about the plan — other students, the
    // professors, the whole course catalogue, the app itself — sits behind
    // Advanced. Names match the home screen's cards (js/90-task-home.js), so
    // the same screen is never called two things.
    { key: 'schedule', icon: 'calendar', label: 'My Schedule', ar: 'جدولي', group: 'plan', action: function(prefix){ if(window.AAUP_CALENDAR) window.AAUP_CALENDAR.open(prefix); } },
    { key: 'achievements', icon: 'trophy', label: 'Achievements', ar: 'الإنجازات', group: 'plan', action: function(prefix){ window.AAUP_ACHIEVEMENTS.open(prefix); } },
    // The one place in the app where students talk to each other rather than
    // to their own data — so it sits with the rest of the plan's screens, not
    // hidden behind a floating button nobody presses.
    { key: 'thoughts', icon: 'speech', label: 'Student Thoughts', ar: 'أفكار الطلبة', group: 'community', advanced: true, action: function(prefix){ if(window.AAUP_THOUGHTS) window.AAUP_THOUGHTS.open(prefix); } },
    { key: 'contacts', icon: 'cap', label: 'Find a Professor', ar: 'ابحث عن محاضر', group: 'community', advanced: true, action: function(prefix){ if(window.AAUP_CONTACTS) window.AAUP_CONTACTS.open(prefix, { category: 'instructor', query: '' }); } },
    { key: 'library', icon: 'book', label: 'Browse Courses', ar: 'تصفّح المساقات', group: 'community', advanced: true, planOnly: true, action: function(prefix){ if(window.AAUP_IMPORTED) window.AAUP_IMPORTED.openLibrary(prefix); } },
    { key: 'about', icon: 'help', label: 'About', ar: 'عن التطبيق', group: 'community', advanced: true, action: function(){ if(window.AAUP_ABOUT) window.AAUP_ABOUT.open(); } },
    // These two also came off the plan header. Neither is an everyday
    // action, so they land in Advanced rather than the top list — but they
    // do land somewhere: a control that is removed from one surface and
    // added to no other is just deleted.
    // "Export Plan" and "Contribute This Plan" were two rows that both send
    // this plan somewhere — one to a file on your device, one to the person
    // who maintains the catalogue. The labels named the mechanism, not the
    // destination, so picking between them meant already knowing what each
    // one did. One row now, and it asks where. Same pattern as the plan
    // chooser above, and for the same reason.
    { key: 'send', icon: 'download', label: 'Send this plan', ar: 'إرسال هذه الخطة', group: 'plan', planOnly: true,
      action: function(prefix){ openSendChooser(prefix); } }
  ];
  var GROUP_LABELS = { plan: 'Plan', community: 'Community', account: 'Account' };
  var GROUP_LABELS_AR = { plan: 'الخطة', community: 'المجتمع', account: 'الحساب' };
  // Language is one app-wide setting (js/09-language.js). The menu was the
  // last thing still written only in English while the plan beside it was in
  // Arabic — which is most of what "one switch, everywhere" was about.
  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }

  // Edit Mode, Export and Contribute all act on an imported plan through
  // AAUP_IMPORTED. A built-in major has none of those, so the rows are not
  // offered there rather than being offered and doing nothing.
  function itemsFor(prefix){
    var imported = isImportedPlan(prefix);
    return ITEMS.filter(function(i){ return imported || !i.planOnly; });
  }
  function isEditing(prefix){
    var page = document.getElementById('page-' + prefix);
    return !!(page && page.classList.contains('editing'));
  }
  // The one row whose label depends on what the page is currently doing:
  // pressed once it says how to leave again.
  function labelFor(item, prefix){
    var arabic = ar();
    if(item.key === 'edit' && isEditing(prefix)) return arabic ? 'إنهاء التعديل' : 'Exit Edit Mode';
    return (arabic && item.ar) ? item.ar : item.label;
  }

  // "Change Major" and "Switch Plan" were two rows that both changed which
  // plan you are on. They are one row now, and it asks which — moving major
  // (what carries over, what it costs) or opening one of your own saved
  // plans — instead of making the student pick the right row for a
  // difference the labels never explained.
  // Back to "What do you need?" (js/90-task-home.js), which hides this
  // sidebar and the tab bar on its own.
  function goHome(){
    closeMobile();
    document.querySelectorAll('.modal-overlay.open').forEach(function(o){ o.classList.remove('open'); });
    if(window.AAUP_TASK_HOME){ window.AAUP_TASK_HOME.show(); }
    else if(window.showPage){ window.showPage('home'); }
  }

  function openPlanChooser(prefix){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body || !window.AAUP_CHANGE_PLAN){
      window.AAUP_DASHBOARD.choosePlan();
      return;
    }
    var saved = window.AAUP_IMPORTED ? Object.keys(window.AAUP_IMPORTED.loadImportedPlans() || {}).length : 0;
    var r = ar();
    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('shuffle', 20) + (r ? 'تغيير الخطة' : 'Change plan') + '</h2>' +
      '<div class="cp-choice"' + (r ? ' dir="rtl"' : '') + '>' +
        '<button type="button" class="cp-choice-btn" id="cpMajor">' +
          '<span class="cp-choice-icon">' + window.AAUP_ICONS.preview('compass', 20) + '</span>' +
          '<span class="cp-choice-text"><b>' + (r ? 'الانتقال لتخصص ثاني' : 'Move to another major') + '</b>' +
          '<span>' + (r ? 'شو بينحسب إلك وشو بتخسر' : 'What carries over, what it costs') + '</span></span></button>' +
        '<button type="button" class="cp-choice-btn" id="cpSwitch">' +
          '<span class="cp-choice-icon">' + window.AAUP_ICONS.preview('refresh', 20) + '</span>' +
          '<span class="cp-choice-text"><b>' + (r ? 'افتح خطة ثانية' : 'Open another plan') + '</b>' +
          '<span>' + (saved ? saved + (r ? ' محفوظة · كل التخصصات' : ' saved · all majors') : (r ? 'كل التخصصات' : 'All majors')) + '</span></span></button>' +
      '</div>';
    overlay.classList.add('open');
    var close = function(){ overlay.classList.remove('open'); };
    document.getElementById('cpMajor').addEventListener('click', function(){
      close(); window.AAUP_CHANGE_PLAN.open(prefix);
    });
    document.getElementById('cpSwitch').addEventListener('click', function(){
      close(); window.AAUP_DASHBOARD.choosePlan();
    });
  }

  // The two destinations behind the one "Send this plan" row.
  function openSendChooser(prefix){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body || !window.AAUP_IMPORTED){
      if(window.AAUP_IMPORTED) window.AAUP_IMPORTED.exportPlan(prefix);
      return;
    }
    var r = ar();
    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('download', 20) + (r ? 'إرسال هذه الخطة' : 'Send this plan') + '</h2>' +
      '<div class="cp-choice"' + (r ? ' dir="rtl"' : '') + '>' +
        '<button type="button" class="cp-choice-btn" id="spFile">' +
          '<span class="cp-choice-icon">' + window.AAUP_ICONS.preview('download', 20) + '</span>' +
          '<span class="cp-choice-text"><b>' + (r ? 'إلى ملف' : 'To a file') + '</b>' +
          '<span>' + (r ? 'ينزل على جهازك — للنسخ الاحتياطي أو للمشاركة' : 'Downloads to your device — to keep or to pass on') + '</span></span></button>' +
        '<button type="button" class="cp-choice-btn" id="spMaintainer">' +
          '<span class="cp-choice-icon">' + window.AAUP_ICONS.preview('mail', 20) + '</span>' +
          '<span class="cp-choice-text"><b>' + (r ? 'إلى القائم على التطبيق' : 'To the maintainer') + '</b>' +
          '<span>' + (r ? 'لإضافتها للخطط الجاهزة' : 'To be added to the built-in plans') + '</span></span></button>' +
      '</div>';
    overlay.classList.add('open');
    var close = function(){ overlay.classList.remove('open'); };
    document.getElementById('spFile').addEventListener('click', function(){
      close(); window.AAUP_IMPORTED.exportPlan(prefix);
    });
    document.getElementById('spMaintainer').addEventListener('click', function(){
      close(); window.AAUP_IMPORTED.submitPlan(prefix);
    });
  }

  var currentPrefix = null;
  var activeKeyNow = null;

  // ---------------------------------------------------------------------
  // ADVANCED
  //
  // Thirteen nav rows meant a student had to read past nine screens they
  // were not looking for to reach the one they were. Only five of them are
  // the everyday path — the plan, where you are on it, what you have
  // earned, and what to take next. The other six are real features that a
  // student reaches for occasionally: a GPA sandbox, badges, a printout,
  // the message wall, the phone book, and moving majors.
  //
  // They are not deleted and they are not buried in Settings, which is
  // where preferences live, not screens. They sit behind one row named
  // Advanced, next to Settings, that remembers whether it was left open.
  var ADV_KEY = 'aaup_sidebar_advanced_open';
  function advancedOpen(){
    try{ return localStorage.getItem(ADV_KEY) === '1'; }catch(e){ return false; }
  }
  function setAdvancedOpen(v){
    try{ localStorage.setItem(ADV_KEY, v ? '1' : '0'); }catch(e){}
  }
  function isAdvancedKey(key){
    var item = ITEMS.filter(function(i){ return i.key === key; })[0];
    return !!(item && item.advanced);
  }
  // A section that hides the screen you are currently on is worse than no
  // section at all, so an advanced destination forces it open.
  function advancedExpanded(activeKey){
    return advancedOpen() || (!!activeKey && isAdvancedKey(activeKey));
  }
  // The desktop flat list and the phone More sheet are both in the DOM at
  // once — CSS shows one per breakpoint — so each gets its own toggle and
  // panel, and each pair needs its own ids. Sharing one id made the document
  // invalid and, worse, left the phone toggle unbound: querySelector('#id')
  // returns the first match, which is always the desktop one.
  function advancedToggleHtml(expanded, count, variant){
    return '<button type="button" class="sb-adv-toggle' + (expanded ? ' open' : '') +
      '" id="sbAdvancedToggle-' + variant + '" aria-expanded="' + (expanded ? 'true' : 'false') +
      '" aria-controls="sbAdvancedPanel-' + variant + '">' +
      '<span class="sb-icon">' + window.AAUP_ICONS.preview('menu', 16) + '</span>' +
      '<span class="sb-adv-label">' + (ar() ? 'متقدم' : 'Advanced') + '</span>' +
      '<span class="sb-adv-count">' + count + '</span>' +
      '<span class="sb-adv-chevron" aria-hidden="true">' + window.AAUP_ICONS.preview(expanded ? 'chevronUp' : 'chevron', 15) + '</span></button>';
  }

  // Phone-only markup: the same ITEMS grouped into labeled sections with an
  // icon badge per row instead of one flat list of plain-gray icons. Built
  // alongside the desktop flat list (below), not instead of it — CSS shows
  // exactly one of the two per breakpoint (see .sb-groups/.sb-flat-list in
  // app.css), and both share the same [data-sb-key] attribute so the one
  // click handler in render() covers whichever markup is actually visible.
  function moreGroupsHtml(prefix, activeKey){
    var byGroup = { plan: [], community: [], account: [] };
    var adv = [];
    // The advanced rows leave their own groups and gather into one list, in
    // the order they were declared — Plan's extras, then Community, then
    // Change Major — so the section still reads as a sequence rather than a
    // pile of unrelated leftovers.
    var soloItems = [];
    itemsFor(prefix).forEach(function(item){
      if(item.advanced){ adv.push(item); return; }
      if(item.group && byGroup[item.group]) byGroup[item.group].push(item);
      else soloItems.push(item);
    });
    byGroup.account.push({ key: 'settings', icon: 'gear', label: 'Settings', ar: 'الإعدادات' });
    byGroup.account.push({ key: 'switch', icon: 'shuffle', label: 'Change plan', ar: 'تغيير الخطة' });

    function rowHtml(item){
      return '<button type="button" class="sb-mrow' + (item.key === activeKey ? ' active' : '') +
        (item.key === 'edit' && isEditing(prefix) ? ' sb-mrow-on' : '') + '" data-sb-key="' + item.key + '">' +
        '<span class="sb-mrow-icon">' + window.AAUP_ICONS.preview(item.icon, 17) + '</span>' +
        '<span class="sb-mrow-label">' + labelFor(item, prefix) + '</span>' +
        '<span class="sb-mrow-chevron">' + window.AAUP_ICONS.preview('chevronRight', 15) + '</span></button>';
    }
    function groupHtml(key){
      var items = byGroup[key];
      if(!items.length) return '';
      return '<div class="sb-group-label">' + (ar() ? GROUP_LABELS_AR[key] : GROUP_LABELS[key]) + '</div>' +
        '<div class="sb-group">' + items.map(rowHtml).join('') + '</div>';
    }
    // Dashboard has no group (it is the app's own Home tab, duplicated here
    // for convenience) — a standalone row above the labeled sections rather
    // than forced into one of them.
    // Edit Mode and Dashboard both sit outside the labelled sections, as one
    // ungrouped block at the very top, in the order ITEMS declares them.
    var expanded = advancedExpanded(activeKey);
    // Advanced sits directly above Account, so Settings stays the last thing
    // in the sheet and the new row is the one immediately before it.
    var advHtml = adv.length
      ? advancedToggleHtml(expanded, adv.length, 'more') +
        '<div class="sb-group sb-adv-panel" id="sbAdvancedPanel-more"' + (expanded ? '' : ' hidden') + '>' +
          adv.map(rowHtml).join('') + '</div>'
      : '';
    // The install offer sits above every group — it is an offer about the app
    // itself, not one of the places you can go in it. Its own host id so
    // js/89-install.js can empty it the moment the app is installed, without
    // this sheet having to be rebuilt.
    return '<div id="sbInstallRow">' + (window.AAUP_INSTALL ? window.AAUP_INSTALL.rowHtml() : '') + '</div>' +
      (soloItems.length ? '<div class="sb-group sb-group-solo">' + soloItems.map(rowHtml).join('') + '</div>' : '') +
      groupHtml('plan') + groupHtml('community') + advHtml + groupHtml('account');
  }

  function render(prefix, activeKey){
    var sidebar = document.getElementById('appSidebar');
    if(!sidebar) return;
    var name = planName(prefix);
    var iconEntity = isImportedPlan(prefix) ? (window.AAUP_IMPORTED.loadImportedPlans()[prefix] || {}) :
      { icon: BUILT_IN_ICONS[prefix] || '🎓', iconKey: BUILT_IN_ICON_KEYS[prefix] || '' };

    // The plan's name goes home too — it is where people click first when
    // they want out, so it does what they expect.
    var html = '<button type="button" class="sb-brand" data-sb-key="home" title="' + (ar() ? 'الرئيسية' : 'Home') + '"><span class="sb-mark">' + window.AAUP_ICONS.markup(iconEntity, { size: 20 }) + '</span><span>' + name + '</span></button>' +
      '<button type="button" class="sb-home" data-sb-key="home"><span class="sb-icon">' + window.AAUP_ICONS.preview(ar() ? 'chevronRight' : 'chevronLeft', 16) + '</span><span>' + (ar() ? 'الرئيسية' : 'Home') + '</span></button>';
    function itemHtml(item){
      return '<button type="button" class="sb-item' + (item.key === activeKey ? ' active' : '') +
        (item.key === 'edit' && isEditing(prefix) ? ' sb-item-on' : '') + '" data-sb-key="' + item.key + '">' +
        '<span class="sb-icon">' + window.AAUP_ICONS.preview(item.icon, 16) + '</span><span>' + labelFor(item, prefix) + '</span></button>';
    }
    var advItems = itemsFor(prefix).filter(function(i){ return i.advanced; });
    var advExpanded = advancedExpanded(activeKey);

    html += '<div class="sb-flat-list">';
    html += itemsFor(prefix).filter(function(i){ return !i.advanced; }).map(itemHtml).join('');
    html += '<div class="sb-spacer"></div>';
    html += '<div class="sb-switch">';
    if(advItems.length){
      html += advancedToggleHtml(advExpanded, advItems.length, 'flat') +
        '<div class="sb-adv-panel" id="sbAdvancedPanel-flat"' + (advExpanded ? '' : ' hidden') + '>' +
          advItems.map(itemHtml).join('') + '</div>';
    }
    html += '<button type="button" class="sb-item" data-sb-key="settings"><span class="sb-icon">' + window.AAUP_ICONS.preview('gear', 16) + '</span><span>' + (ar() ? 'الإعدادات' : 'Settings') + '</span></button>' +
      '<button type="button" class="sb-item" data-sb-key="switch"><span class="sb-icon">' + window.AAUP_ICONS.preview('shuffle', 16) + '</span><span>' + (ar() ? 'تغيير الخطة' : 'Change plan') + '</span></button></div>';
    html += '</div>';
    html += '<div class="sb-groups">' + moreGroupsHtml(prefix, activeKey) + '</div>';
    sidebar.innerHTML = html;

    // Toggling Advanced re-renders in place rather than re-running render(),
    // which would rebuild the whole sidebar and lose nothing but cost a
    // repaint of every row for a section that only has to open.
    sidebar.querySelectorAll('.sb-adv-toggle').forEach(function(advToggle){
      advToggle.addEventListener('click', function(){
        var open = advToggle.getAttribute('aria-expanded') !== 'true';
        setAdvancedOpen(open);
        // Both copies move together — the student's choice is one preference,
        // not one per breakpoint, and a phone that rotates into the desktop
        // layout should not find the section back in its old state.
        sidebar.querySelectorAll('.sb-adv-toggle').forEach(function(t){
          t.setAttribute('aria-expanded', open ? 'true' : 'false');
          t.classList.toggle('open', open);
          var chev = t.querySelector('.sb-adv-chevron');
          if(chev) chev.innerHTML = window.AAUP_ICONS.preview(open ? 'chevronUp' : 'chevron', 15);
        });
        sidebar.querySelectorAll('.sb-adv-panel').forEach(function(panel){
          if(open){ panel.removeAttribute('hidden'); } else { panel.setAttribute('hidden', ''); }
        });
      });
    });

    sidebar.querySelectorAll('[data-sb-key]').forEach(function(el){
      el.addEventListener('click', function(){
        var key = el.getAttribute('data-sb-key');
        // On phone, More is a drawer the student explicitly opened — if
        // whatever this click opens has its own back/close control,
        // closing THAT should return to More rather than skipping past it
        // to whatever page was open underneath before More was ever
        // tapped. Read before closeMobile() clears .open below.
        var openedFromMoreDrawer = sidebar.classList.contains('open');
        closeMobile();
        if(key === 'switch'){ openPlanChooser(prefix); return; }
        if(key === 'settings'){ openSettings(); tagOpenedFromMore(openedFromMoreDrawer); return; }
        if(key === 'home'){ goHome(); return; }
        var item = itemsFor(prefix).filter(function(i){ return i.key === key; })[0];
        if(item){
          item.action(prefix);
          // Edit Mode opens no screen — it changes the one you are on — so
          // it never becomes the "active" nav row. It re-renders instead, so
          // the row can redraw itself as Exit Edit Mode.
          if(key === 'edit'){ render(prefix, activeKey); return; }
          if(key !== 'dashboard' && key !== 'studyplan'){ setActive(key); }
          tagOpenedFromMore(openedFromMoreDrawer);
        }
      });
    });
  }

  // One-shot marker on whichever .modal-overlay just opened, consumed by
  // the observer below the first time that overlay closes again. Clears
  // any stale marker first — the same overlay id (devModalOverlay, used by
  // Settings AND several unrelated forms) can be opened later for a
  // completely different reason, and a leftover tag from a past More visit
  // must not silently reopen More on THAT close instead.
  function tagOpenedFromMore(openedFromMoreDrawer){
    if(!openedFromMoreDrawer) return;
    document.querySelectorAll('[data-more-return]').forEach(function(el){ el.removeAttribute('data-more-return'); });
    // The action above opens synchronously, so the freshly-opened overlay
    // is already in the DOM with .open by the time this runs.
    var ov = document.querySelector('.modal-overlay.open');
    if(ov) ov.setAttribute('data-more-return', '1');
  }

  // Watches every .modal-overlay for losing .open (however that happens —
  // the back bar, the ✕, Escape, tapping the backdrop all end the same
  // way: overlay.classList.remove('open')) and reopens More exactly once
  // if that overlay was tagged. A trailing-edge observer, not a click
  // interceptor, so it does not care which of the several different close
  // mechanisms this app's dialogs use.
  function watchMoreReturn(){
    var obs = new MutationObserver(function(muts){
      muts.forEach(function(m){
        var el = m.target;
        if(el.classList && el.hasAttribute('data-more-return') && !el.classList.contains('open')){
          el.removeAttribute('data-more-return');
          if(currentPrefix) toggleMobile();
        }
      });
    });
    function observe(el){ obs.observe(el, { attributes: true, attributeFilter: ['class'] }); }
    document.querySelectorAll('.modal-overlay').forEach(observe);
    new MutationObserver(function(muts){
      muts.forEach(function(m){
        Array.prototype.forEach.call(m.addedNodes, function(n){
          if(n.nodeType === 1 && n.classList && n.classList.contains('modal-overlay')){ observe(n); }
        });
      });
    }).observe(document.body, { childList: true });
  }
  if(document.readyState === 'complete'){ watchMoreReturn(); }
  else { window.addEventListener('load', watchMoreReturn); }

  function setActive(key){
    activeKeyNow = key;
    var sidebar = document.getElementById('appSidebar');
    if(!sidebar) return;
    sidebar.querySelectorAll('.sb-item').forEach(function(el){
      el.classList.toggle('active', el.getAttribute('data-sb-key') === key);
    });
  }

  function show(prefix, activeKey){
    currentPrefix = prefix;
    activeKeyNow = activeKey;
    render(prefix, activeKey);
    document.getElementById('appSidebar').style.display = 'flex';
    document.getElementById('sbToggleBtn').style.display = '';
    document.body.classList.add('has-sidebar');
    // Visibility is CSS-driven (body.has-sidebar + the phone breakpoint),
    // deliberately not an inline style here — an inline display would beat
    // that media query on desktop and force the bar to show everywhere.
    ensureTabBar();
    syncTabBar(prefix, activeKey);
  }
  function hide(){
    currentPrefix = null;
    var sidebar = document.getElementById('appSidebar');
    if(sidebar) sidebar.style.display = 'none';
    var toggle = document.getElementById('sbToggleBtn');
    if(toggle) toggle.style.display = 'none';
    document.body.classList.remove('has-sidebar');
    closeMobile();
  }
  function toggleMobile(){
    var sidebar = document.getElementById('appSidebar');
    var overlay = document.getElementById('sbOverlay');
    var opening = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', opening);
    overlay.classList.toggle('open', opening);
  }
  function closeMobile(){
    var sidebar = document.getElementById('appSidebar');
    var overlay = document.getElementById('sbOverlay');
    if(sidebar) sidebar.classList.remove('open');
    if(overlay) overlay.classList.remove('open');
  }

  // ---------------------------------------------------------------------
  // PHONE BOTTOM TAB BAR — the same navigation as the sidebar above, in the
  // shape a thumb actually wants on a phone. Not a rewrite: every tab calls
  // the exact same action a sidebar item already does (or, for "More",
  // opens the sidebar itself as a drawer) — this is a second way to reach
  // the same four most-used destinations, not a second navigation model.
  // Hidden by CSS above 720px, so desktop is untouched.
  //
  // icon is a js/04-icons.js ICONS key, same as ITEMS above — reusing
  // 'home'/'planpin' for the same two destinations the sidebar already has.
  // Home is first: it is the one place every other screen hangs off, and
  // the tab bar was the only way around a phone that had no way back to it.
  var TABS = [
    { key: 'home', icon: 'home', label: 'Home', ar: 'الرئيسية', action: function(){ goHome(); } },
    { key: 'dashboard', icon: 'chart', label: 'Dashboard', ar: 'لوحة التحكم', action: function(prefix){ window.AAUP_DASHBOARD.open(prefix); } },
    { key: 'studyplan', icon: 'planpin', label: 'Plan', ar: 'الخطة', action: function(prefix){ window.AAUP_DASHBOARD.openStudyPlan(prefix); } },
    { key: 'assistant', icon: 'chatdots', label: 'Assistant', ar: 'المساعد', action: function(){ if(window.AAUP_ASSISTANT_UI) window.AAUP_ASSISTANT_UI.open(); } },
    { key: 'more', icon: 'menu', label: 'More', ar: 'المزيد', action: function(){ toggleMobile(); } }
  ];

  function ensureTabBar(){
    var bar = document.getElementById('sbTabBar');
    if(bar) return bar;
    bar = document.createElement('div');
    bar.id = 'sbTabBar';
    bar.className = 'sb-tabbar';
    bar.innerHTML = TABS.map(function(tItem){
      return '<button type="button" class="sb-tab" data-sb-tab="' + tItem.key + '">' +
        '<span class="sb-tab-ic">' + window.AAUP_ICONS.preview(tItem.icon, 20) + (tItem.key === 'dashboard' ? '<span class="sb-tab-badge" id="sbTabProgress" hidden></span>' : '') + '</span>' +
        '<span class="sb-tab-lbl">' + (ar() ? tItem.ar : tItem.label) + '</span>' +
        '</button>';
    }).join('');
    document.body.appendChild(bar);
    bar.addEventListener('click', function(e){
      var btn = e.target.closest('[data-sb-tab]');
      if(!btn || !currentPrefix) return;
      var tItem = TABS.filter(function(x){ return x.key === btn.getAttribute('data-sb-tab'); })[0];
      if(tItem) tItem.action(currentPrefix);
    });
    return bar;
  }

  // The "mini persistent progress pill" idea, folded into the Dashboard tab
  // itself rather than added as a second floating element competing with
  // this same tab bar for the same corner of the screen — tapping it does
  // exactly what the idea asked for (jump back to the dashboard), and the
  // number is genuinely persistent since the tab bar itself always is.
  function syncTabProgress(prefix){
    var badge = document.getElementById('sbTabProgress');
    if(!badge) return;
    var rows = window.AAUP_AUDIT ? window.AAUP_AUDIT.computeAudit(prefix) : [];
    var total = 0, done = 0;
    rows.forEach(function(r){ total += r.total; done += r.completed; });
    if(total <= 0){ badge.hidden = true; return; }
    badge.textContent = Math.round((done / total) * 100) + '%';
    badge.hidden = false;
  }

  function syncTabBar(prefix, activeKey){
    var bar = ensureTabBar();
    bar.querySelectorAll('[data-sb-tab]').forEach(function(el){
      el.classList.toggle('active', el.getAttribute('data-sb-tab') === activeKey);
      // Relabel on every sync, not only on the build. ensureTabBar() returns
      // the existing bar untouched, so a tab bar built in English before the
      // student switched to Arabic would have kept its English labels for the
      // rest of the session.
      var tItem = TABS.filter(function(x){ return x.key === el.getAttribute('data-sb-tab'); })[0];
      var lbl = tItem && el.querySelector('.sb-tab-lbl');
      if(lbl) lbl.textContent = ar() ? tItem.ar : tItem.label;
    });
    syncTabProgress(prefix);
  }

  // A small settings modal consolidating theme/export/import/reset — the
  // same functions the original home-page footer buttons already call,
  // just reachable from inside a plan too instead of only from the picker.
  function openSettings(){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body) return;
    renderSettingsBody(body);
    overlay.classList.add('open');
  }

  // Grouped under four top tabs rather than one long scroll — this used to
  // be a single wall of buttons (theme, language, export/import/reset,
  // online plans, tours, cloud sync, device profiles all stacked one after
  // another) and finding any one setting meant scanning past all the
  // others. The active tab persists across re-renders within the same
  // modal session (every action here re-renders to reflect its own result,
  // e.g. toggling the theme), so acting on something never bounces the
  // student back to the first tab.
  //
  // Account and Data were two of those tabs, and they were the same
  // question asked twice: where does my progress live. Cloud Sync sat on
  // Account, Export/Import sat on Data, device profiles sat on Account, and
  // a student looking for either one had to guess which word the app had
  // filed it under. They are one tab now — My data — with the same sections
  // in the same order, cloud first and the local copies under it.
  var SETTINGS_TABS = [
    { key: 'mydata', iconKey: 'save', en: 'My data', ar: 'بياناتي' },
    { key: 'prefs', iconKey: 'palette', en: 'Preferences', ar: 'التفضيلات' },
    { key: 'help', iconKey: 'help', en: 'Help', ar: 'مساعدة' }
  ];
  var activeSettingsTab = 'mydata';

  // "Device Profiles" beside "Cloud Sync" read as two names for the same
  // thing. What it is for is a shared laptop: each person gets their own
  // plan and grades, and none of it leaves the device.
  function peopleHtml(r, current, others){
    return '<h3 class="mh set-grp-h">' + window.AAUP_ICONS.preview('person', 18) + (r ? 'الأشخاص على هذا الجهاز' : 'People on this device') + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' + (r
        ? 'جهاز مشترك؟ كل شخص إله خطته وعلاماته. ولا إشي بيطلع من الجهاز.'
        : 'Sharing a laptop? Each person gets their own plan and grades. Nothing leaves this device.') + '</p>' +
      '<p style="font-size:12.5px;">' + (r ? 'الحساب الحالي: ' : 'Current account: ') + '<b>' + window.__escapeHtml(current) + '</b></p>' +
      (others.length
        ? '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
          others.map(function(a){
            return '<span class="acct-row">' +
              '<button type="button" class="home-btn acct-switch-btn" data-acct="' + window.__escapeHtml(a) + '">' + window.AAUP_ICONS.preview('refresh', 14) + (r ? 'التبديل إلى ' : 'Switch to ') + window.__escapeHtml(a) + '</button>' +
              '<button type="button" class="home-btn acct-delete-btn" data-acct="' + window.__escapeHtml(a) + '" aria-label="' + (r ? 'حذف الحساب' : 'Delete account') + '">' + window.AAUP_ICONS.preview('trash', 14) + '</button>' +
              '</span>';
          }).join('') + '</div>'
        : '') +
      '<div class="form-field-row">' +
      '<div class="form-field"><input type="text" id="newAcctName" maxlength="40" placeholder="' + (r ? 'اسم حساب جديد' : 'New account name') + '"></div>' +
      '<button type="button" class="home-btn" id="newAcctBtn" style="border-color:var(--accent);color:var(--text);align-self:flex-start;">' + window.AAUP_ICONS.preview('plus', 14) + (r ? 'إنشاء' : 'Create') + '</button>' +
      '</div>' +
      '<div id="acctMsg"></div>';
  }

  function themePickerHtml(r){
    if(!window.AAUP_THEME) return '';
    var current = window.AAUP_THEME.current();
    var themes = window.AAUP_THEME.listAll ? window.AAUP_THEME.listAll() : window.AAUP_THEME.list();
    return '<h3 class="mh" style="margin:0 0 6px;">' + window.AAUP_ICONS.preview('palette', 18) + (r ? 'السمة' : 'Theme') + '</h3>' +
      '<div class="theme-picker-grid" role="group" aria-label="' + (r ? 'السمة' : 'Theme') + '">' +
      themes.map(function(t){
        var active = t.id === current;
        return '<button type="button" class="theme-swatch' + (active ? ' theme-swatch-active' : '') +
          '" data-theme-swatch="' + t.id + '" style="--sw-bg:' + t.bg + ';--sw-accent:' + t.accent + ';" aria-pressed="' + active + '">' +
          '<span class="theme-swatch-preview"></span>' +
          '<span class="theme-swatch-label"><span>' + t.icon + ' ' + (r ? t.ar : t.en) + '</span><span class="theme-swatch-check">' + window.AAUP_ICONS.preview('check', 14) + '</span></span>' +
          '</button>';
      }).join('') +
      '</div>' +
      (window.AAUP_THEME_CUSTOM ? window.AAUP_THEME_CUSTOM.sectionHtml(r) : '');
  }

  // How big the course cards read. Six themes shipped without any way to
  // make the text bigger, which left the plan grid at 12.5px for everyone.
  function sizePickerHtml(r){
    if(!window.AAUP_THEME || !window.AAUP_THEME.sizes) return '';
    var current = window.AAUP_THEME.currentSize();
    // Named for what it changes, so it no longer needs a line saying so.
    return '<h3 class="mh" style="margin:18px 0 6px;">' + window.AAUP_ICONS.preview('textsize', 18) +
      (r ? 'حجم بطاقات المساقات' : 'Course card size') + '</h3>' +
      '<div class="size-picker" role="group" aria-label="' + (r ? 'حجم النص' : 'Reading size') + '">' +
      window.AAUP_THEME.sizes().map(function(sz){
        var active = sz.id === current;
        return '<button type="button" class="size-pick' + (active ? ' size-pick-active' : '') +
          '" data-size-pick="' + sz.id + '" aria-pressed="' + active + '">' +
          '<span style="font-size:' + Math.round(11 * sz.scale) + 'px;">Aa</span>' +
          '<span>' + (r ? sz.ar : sz.en) + '</span></button>';
      }).join('') +
      '</div>';
  }

  function prefsTabHtml(r, selectedPlan, isRtlNow){
    // The English placement is asked once, on the way in, and cannot be
    // skipped there (js/77-english-level.js). This is the way to correct it
    // — a one-shot question with no way back would be a trap, and a student
    // who mis-taps it would be looking at the wrong degree total forever.
    var engLabel = window.AAUP_ENGLISH ? window.AAUP_ENGLISH.label(r) : '';
    var engRow = (selectedPlan && window.AAUP_ENGLISH && engLabel)
      ? '<h3 class="mh" style="margin:18px 0 6px;">' + window.AAUP_ICONS.preview('language', 18) +
          (r ? 'مستوى الإنجليزي' : 'English level') + '</h3>' +
        '<p class="form-note" style="margin-top:0;">' + (r
          ? 'المستويات اللي تحت مستواك بتطلع من خطتك. المجموع المنشور ما بيتغيّر.'
          : 'Levels below yours leave your plan. The published total is unchanged.') + '</p>' +
        '<p style="font-size:12.5px;margin:6px 0 8px;">' + (r ? 'مستواك: ' : 'Placed at: ') +
          '<b>' + window.__escapeHtml(engLabel) + '</b></p>' +
        '<div class="form-actions" style="justify-content:flex-start;">' +
        '<button type="button" class="home-btn" id="setEnglishBtn">' + window.AAUP_ICONS.preview('pen', 14) +
          (r ? 'تغيير' : 'Change') + '</button></div>'
      : '';
    return themePickerHtml(r) + sizePickerHtml(r) +
      '<div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap;margin-top:14px;">' +
      (selectedPlan ? '<button type="button" class="home-btn" id="setLangBtn">' + window.AAUP_ICONS.preview('globe', 14) + (isRtlNow ? 'English' : 'العربية') + '</button>' : '') +
      '</div>' + engRow;
  }

  // Save and restore sit together, with the automatic restore points
  // (js/84-autobackup.js) inside the same box — they are all the same
  // question: how do I get my data back.
  function backupHtml(r){
    return '<h3 class="mh set-grp-h">' + window.AAUP_ICONS.preview('save', 18) + (r ? 'نسخة احتياطية' : 'Backup') + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' + (r
        ? 'احفظ كل إشي بملف، أو رجّع ملف محفوظ.'
        : 'Save everything to a file, or bring a saved file back.') + '</p>' +
      '<div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap;margin-top:6px;">' +
      '<button type="button" class="home-btn" id="setExportBtn">' + window.AAUP_ICONS.preview('upload', 14) + (r ? 'احفظ نسخة' : 'Save a backup') + '</button>' +
      '<button type="button" class="home-btn" id="setImportBtn">' + window.AAUP_ICONS.preview('download', 14) + (r ? 'استرجع من ملف' : 'Restore from file') + '</button>' +
      '</div>' +
      (window.AAUP_AUTOBACKUP ? window.AAUP_AUTOBACKUP.sectionHtml(r) : '');
  }

  // Last, alone, and red — it used to sit in the same row as Export and
  // Import, styled the same, one mis-tap from wiping everything. The button
  // opens a box that asks for the word RESET before anything is erased.
  function dangerHtml(r){
    return '<h3 class="mh set-grp-h">' + window.AAUP_ICONS.preview('warning', 18) + (r ? 'منطقة الخطر' : 'Danger zone') + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' + (r
        ? 'بيمسح كل خطة وعلامة وملاحظة على هذا الجهاز. ما في تراجع.'
        : 'Deletes every plan, grade and note on this device. It can’t be undone.') + '</p>' +
      '<div id="setResetArea"><button type="button" class="home-btn set-danger-btn" id="setResetBtn">' +
        window.AAUP_ICONS.preview('trash', 14) + (r ? 'مسح كل البيانات…' : 'Reset all data…') + '</button></div>';
  }

  function dataTabHtml(r, devUnlocked){
    return (window.APP_PLANS_FEED_URL ? (
        '<h3 class="mh" style="margin:18px 0 6px;">' + window.AAUP_ICONS.preview('globe', 18) + (r ? 'الخطط عبر الإنترنت' : 'Online Plans') + '</h3>' +
        '<p class="form-note" style="margin-top:0;">' + (r ? 'الخطط الرسمية الجديدة والمحدَّثة. تعديلاتك ما بتنمسح.' : 'New and updated official plans. Your own edits are never overwritten.') + '</p>' +
        '<div class="form-actions" style="justify-content:flex-start;">' +
        '<button type="button" class="home-btn" id="setSyncBtn">' + window.AAUP_ICONS.preview('refresh', 14) + (r ? 'التحقق من التحديثات' : 'Check for updates') + '</button>' +
        '</div>' +
        '<p class="form-note" id="setSyncStatus" style="margin-top:4px;">' + (window.AAUP_SYNC ? window.AAUP_SYNC.lastSyncLabel() : '') + '</p>'
      ) : '') +
      // Which server the wall talks to is a self-hosting/testing knob, not
      // a normal setting — the app already ships pointed at the real one,
      // so an ordinary student pasting a URL here can only ever break their
      // own wall (or point it somewhere they didn't mean to). Same
      // Developer Mode gate as the tour-replay button below already uses.
      (devUnlocked && window.AAUP_THOUGHTS && window.AAUP_THOUGHTS.settingsSectionHtml
        ? window.AAUP_THOUGHTS.settingsSectionHtml(r) : '') +
      (window.AAUP_CONTRIBUTE && window.AAUP_CONTRIBUTE.settingsSectionHtml
        ? window.AAUP_CONTRIBUTE.settingsSectionHtml(r) : '') +
      (window.AAUP_ORPHANS ? window.AAUP_ORPHANS.sectionHtml(r) : '');
  }

  // The tips (js/32-tutorial.js) used to be five guided tours, so this was
  // five buttons — each of which had to NAVIGATE you to its screen before it
  // could replay anything, and each with a ✓/○ so the list doubled as a map
  // of a sequence. There is no sequence now: a tip is one sentence that
  // appears where it applies. So there is one button, it clears every tip's
  // seen-flag, and they come back on their own as you reach each screen.
  function helpTabHtml(r){
    // The install row is FIRST and is always here, in every state. The offers
    // on Home and in the More sheet vanish once the app is installed; someone
    // who later removes it from their home screen needs a way back that does
    // not depend on a browser event which will not fire a second time.
    return (window.AAUP_INSTALL ? window.AAUP_INSTALL.settingsHtml() : '') +
      '<hr class="settings-rule">' +
      '<p class="form-note" style="margin-top:0;">' + (r
      ? 'التلميحات بتطلع مرة وحدة بس عند أول مرة توصل كل شاشة. فيك ترجّعهم كلهم من هون.'
      : 'Tips appear once, the first time you reach each screen. This brings all of them back.') + '</p>' +
      '<div class="form-actions" style="justify-content:flex-start;">' +
      '<button type="button" class="home-btn" id="setTipsResetBtn">' +
      (r ? 'أظهر التلميحات من جديد' : 'Show the tips again') + '</button>' +
      '</div>';
  }

  function renderSettingsBody(body){
    var accounts = window.AAUP_ACCOUNTS ? window.AAUP_ACCOUNTS.listAccounts() : [];
    var current = window.AAUP_ACCOUNTS ? window.AAUP_ACCOUNTS.currentAccount() : 'Default';
    var others = accounts.filter(function(a){ return a !== current; });
    var selectedPlan = window.AAUP_DASHBOARD ? window.AAUP_DASHBOARD.getSelected() : null;
    var isRtlNow = selectedPlan && window.__isRtl ? window.__isRtl(selectedPlan) : false;
    // Developer Mode's own unlock state is deliberately kept in memory only
    // (see AAUP_DEV's `authenticated` var) — re-locking on every reload is
    // the point. The dev-edit buttons it reveals are the one visible trace
    // of "unlocked this session" already on the page, so reuse that instead
    // of tracking a second flag just for gating this tour's replay button.
    var devEditBtn = document.querySelector('[data-dev-edit-btn]');
    var devUnlocked = !!(devEditBtn && devEditBtn.style.display !== 'none');

    // Settings is reachable from within a plan (its language) or from the
    // picker; follow the selected plan's language when there is one, English
    // otherwise. Everything user-facing below is bilingual.
    var r = isRtlNow;
    body.setAttribute('dir', r ? 'rtl' : 'ltr');

    var tabContent = activeSettingsTab === 'prefs' ? prefsTabHtml(r, selectedPlan, isRtlNow)
      : activeSettingsTab === 'help' ? helpTabHtml(r)
      // Both halves of the old Account and Data tabs, in one scroll: where
      // your progress lives online, then the copies of it on this device.
      // Grouped by what you came to do: sync, backup, the people who share
      // this device, the rest, and — last, on its own — erase everything.
      : ('<div class="set-grp">' + (window.AAUP_CLOUD ? window.AAUP_CLOUD.sectionHtml(r) : '') + '</div>' +
         '<div class="set-grp">' + backupHtml(r) + '</div>' +
         '<div class="set-grp">' + peopleHtml(r, current, others) + '</div>' +
         dataTabHtml(r, devUnlocked) +
         '<div class="set-grp set-grp-danger">' + dangerHtml(r) + '</div>');

    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('gear', 20) + (r ? 'الإعدادات' : 'Settings') + '</h2>' +
      '<div class="settings-tabbar">' +
      SETTINGS_TABS.map(function(t){
        return '<div class="settings-tab' + (t.key === activeSettingsTab ? ' active' : '') + '" data-settings-tab="' + t.key + '">' +
          '<span class="settings-tab-icon">' + window.AAUP_ICONS.preview(t.iconKey, 16) + '</span><span>' + (r ? t.ar : t.en) + '</span></div>';
      }).join('') +
      '</div>' +
      '<div id="settingsTabContent">' + tabContent + '</div>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="setClose">' + (r ? 'إغلاق' : 'Close') + '</button></div>' +
      '<p class="form-note" style="text-align:center;opacity:.6;">v' + (window.APP_VERSION || '?') + ' · ' + (r ? 'مشروع طلابي مفتوح' : 'an open student project') + '</p>';

    document.getElementById('setClose').addEventListener('click', function(){ document.getElementById('devModalOverlay').classList.remove('open'); });
    body.querySelectorAll('[data-settings-tab]').forEach(function(tabEl){
      tabEl.addEventListener('click', function(){
        activeSettingsTab = tabEl.getAttribute('data-settings-tab');
        renderSettingsBody(body);
      });
    });
    if(window.AAUP_AUTOBACKUP){ window.AAUP_AUTOBACKUP.bind(body); }
    if(window.AAUP_ORPHANS){
      window.AAUP_ORPHANS.bindSection(body, function(){ renderSettingsBody(body); });
    }
    if(window.AAUP_CLOUD){
      window.AAUP_CLOUD.bindSection(body);
    }
    if(window.AAUP_THEME_CUSTOM){
      window.AAUP_THEME_CUSTOM.bindSection(body, function(){ renderSettingsBody(body); });
    }
    if(window.AAUP_THOUGHTS && window.AAUP_THOUGHTS.bindSettingsSection){
      window.AAUP_THOUGHTS.bindSettingsSection(body, selectedPlan);
    }
    if(window.AAUP_CONTRIBUTE && window.AAUP_CONTRIBUTE.bindSettingsSection){
      window.AAUP_CONTRIBUTE.bindSettingsSection(body);
    }
    body.querySelectorAll('[data-theme-swatch]').forEach(function(el){
      el.addEventListener('click', function(){
        if(window.AAUP_THEME) window.AAUP_THEME.setTheme(el.getAttribute('data-theme-swatch'));
      });
    });
    body.querySelectorAll('[data-size-pick]').forEach(function(el){
      el.addEventListener('click', function(){
        if(window.AAUP_THEME && window.AAUP_THEME.setSize){
          window.AAUP_THEME.setSize(el.getAttribute('data-size-pick'));
          renderSettingsBody(body);   // repaint so the chosen size shows as picked
        }
      });
    });
    if(document.getElementById('setLangBtn')){
      document.getElementById('setLangBtn').addEventListener('click', function(){
        var isImported = !!(window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()[selectedPlan]);
        if(isImported){ window.AAUP_IMPORTED.toggleLang(selectedPlan); }
        else if(window.toggleLang){ window.toggleLang(selectedPlan); }
        renderSettingsBody(body); // refresh so the button label reflects the new state
      });
    }
    if(document.getElementById('setEnglishBtn')){
      document.getElementById('setEnglishBtn').addEventListener('click', function(){
        // Close Settings first: the placement question deliberately has no
        // way out but its four options, and it must not open behind a dialog
        // whose ✕ would then be the only thing on top of it.
        var ov = document.getElementById('devModalOverlay');
        if(ov) ov.classList.remove('open');
        if(window.AAUP_ENGLISH) window.AAUP_ENGLISH.change(selectedPlan);
      });
    }
    if(document.getElementById('setExportBtn')){
      document.getElementById('setExportBtn').addEventListener('click', function(){ if(window.AAUP_DATA) window.AAUP_DATA.exportData(); });
    }
    if(document.getElementById('setImportBtn')){
      document.getElementById('setImportBtn').addEventListener('click', function(){ if(window.AAUP_DATA) window.AAUP_DATA.triggerImport(); });
    }
    if(document.getElementById('setResetBtn')){
      document.getElementById('setResetBtn').addEventListener('click', function(){
        var area = document.getElementById('setResetArea');
        if(!area || !window.AAUP_DATA) return;
        area.innerHTML =
          '<label class="set-danger-lbl" for="setResetWord">' + (r ? 'اكتب RESET للتأكيد' : 'Type RESET to confirm') + '</label>' +
          '<div class="set-danger-row"><input type="text" id="setResetWord" autocomplete="off" autocapitalize="characters" spellcheck="false" dir="ltr">' +
          '<button type="button" class="home-btn set-danger-btn" id="setResetGo" disabled>' + (r ? 'امسح كل إشي' : 'Erase everything') + '</button>' +
          '<button type="button" class="home-btn" id="setResetCancel">' + (r ? 'إلغاء' : 'Cancel') + '</button></div>';
        var word = document.getElementById('setResetWord');
        var go = document.getElementById('setResetGo');
        word.focus();
        word.addEventListener('input', function(){ go.disabled = word.value.trim().toUpperCase() !== 'RESET'; });
        go.addEventListener('click', function(){ if(!go.disabled) window.AAUP_DATA.resetAllNow(); });
        document.getElementById('setResetCancel').addEventListener('click', function(){ renderSettingsBody(body); });
      });
    }
    if(document.getElementById('setSyncBtn')){
      document.getElementById('setSyncBtn').addEventListener('click', function(){
        var btn = document.getElementById('setSyncBtn');
        btn.disabled = true; btn.textContent = r ? 'جارٍ التحقق…' : 'Checking…';
        window.AAUP_SYNC.checkForUpdates(true).then(function(){
          renderSettingsBody(body);
        });
      });
    }
    if(document.getElementById('setTipsResetBtn')){
      document.getElementById('setTipsResetBtn').addEventListener('click', function(){
        document.getElementById('devModalOverlay').classList.remove('open');
        // No id: clear every tip, arrival and moment alike. They reappear as
        // the student reaches each screen, which is the whole point of them —
        // so this does not need to navigate anywhere to have an effect.
        if(window.AAUP_TUTORIAL){ window.AAUP_TUTORIAL.replay(); }
        if(window.__showToast){
          window.__showToast(window.AAUP_LANG && window.AAUP_LANG.isAr()
            ? 'رجعت التلميحات — رح تطلع لما توصل كل شاشة.'
            : 'Tips are back — they will appear as you reach each screen.');
        }
      });
    }

    document.querySelectorAll('.acct-switch-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        if(!window.AAUP_ACCOUNTS) return;
        var msg = document.getElementById('acctMsg');
        var result = window.AAUP_ACCOUNTS.switchTo(btn.getAttribute('data-acct'));
        if(!result.ok){ msg.innerHTML = '<p class="dev-error-msg">' + result.error + '</p>'; }
        // On success, switchTo() reloads the page — nothing further to do here.
      });
    });
    document.querySelectorAll('.acct-delete-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        if(!window.AAUP_ACCOUNTS) return;
        var acct = btn.getAttribute('data-acct');
        var msg = document.getElementById('acctMsg');
        // Deleting an account throws away everything it holds and there is no
        // undo, so the warning names the account and points at the export
        // first — the same escape hatch the switch failure suggests.
        var warn = r
          ? ('حذف الحساب «' + acct + '» نهائيًا؟ سيُحذف كل تقدّمه وعلاماته وخططه، ولا يمكن التراجع. صدّر نسخة احتياطية أولًا إن كنت غير متأكد.')
          : ('Permanently delete the account “' + acct + '”? All of its progress, grades and plans go with it, and this cannot be undone. Export a backup first if you’re unsure.');
        window.__showConfirmDialog(warn, function(){
          var result = window.AAUP_ACCOUNTS.deleteAccount(acct);
          if(!result.ok){ msg.innerHTML = '<p class="dev-error-msg">' + result.error + '</p>'; return; }
          renderSettingsBody(body);
          if(window.__showToast){ window.__showToast(r ? '🗑 تم حذف الحساب.' : '🗑 Account deleted.'); }
        }, r);
      });
    });
    if(document.getElementById('newAcctBtn')){
      document.getElementById('newAcctBtn').addEventListener('click', function(){
        if(!window.AAUP_ACCOUNTS) return;
        var name = document.getElementById('newAcctName').value;
        var msg = document.getElementById('acctMsg');
        var result = window.AAUP_ACCOUNTS.createAccount(name);
        if(!result.ok){ msg.innerHTML = '<p class="dev-error-msg">' + result.error + '</p>'; }
      });
    }
  }

  // Catches direct navigation to a real major page that doesn't go through
  // the Dashboard (e.g. "Edit Mode" from the home card) so the sidebar
  // still appears with the right context, and hides it if the picker is
  // shown with nothing selected.
  var _origShowPage = window.showPage;
  if(typeof _origShowPage === 'function'){
    window.showPage = function(id){
      var result = _origShowPage(id);
      if(id !== 'home' && id !== '__imported__'){
        show(id, 'studyplan');
      } else if(id === 'home' && !(window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected())){
        hide();
      }
      return result;
    };
  }

  // #devModalOverlay is the one overlay several unrelated features share —
  // Settings, the Course Library, the new-plan and course forms. Each of them
  // renders its own body into it and wires its own Close button, so none of
  // them owned the keyboard path and Escape did nothing in any of them. One
  // handler on the shared element covers every current and future user of it.
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var overlay = document.getElementById('devModalOverlay');
    if(overlay && overlay.classList.contains('open')) overlay.classList.remove('open');
  });

  // Redraws the menu in place — used when the app-wide language flips
  // (js/09-language.js), since every row here is written in one of them.
  function refresh(){
    if(currentPrefix) render(currentPrefix, activeKeyNow);
  }

  window.AAUP_SIDEBAR = { show: show, hide: hide, setActive: setActive, toggleMobile: toggleMobile, closeMobile: closeMobile, openSettings: openSettings, refresh: refresh, openPlanChooser: openPlanChooser };
  // Called from js/28-imported.js's own post-render hook chain (same one
  // js/69-phone-header.js's refresh already sits in) so the tab bar's
  // progress badge updates the moment a course gets checked, not only the
  // next time the sidebar itself is (re)shown.
  window.__refreshTabBarProgress = function(prefix){ if(currentPrefix === prefix) syncTabProgress(prefix); };
})();
