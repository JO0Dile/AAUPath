/* =====================================================================
   SEARCH (shared)
   Search, cross-highlighting, and the floating course popup.
   Reads the COURSE_INFO / PREREQS data that each plan's own script
   registers via window.__registerPlanData(). Nothing here touches the
   existing per-plan drawing/hover/modal logic — it only adds classes
   with new names (search-*) and a separate popup element.
   ===================================================================== */
(function(){

  function normalize(s){
    return (s || '').toString().trim().toLowerCase()
      .replace(/[\u064B-\u0652\u0670\u0640]/g,'')      // Arabic diacritics/tatweel
      .replace(/[\u0623\u0625\u0622\u0671]/g,'\u0627') // alef variants -> ا
      .replace(/\u0649/g,'\u064A')                     // alef maksura -> ya
      .replace(/\s+/g,' ');
  }

  function escapeHTML(s){
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  function isRtl(prefix){
    var page = document.getElementById('page-' + prefix);
    // Ask the app-wide setting when there is no plan on screen. The class
    // only exists on a rendered plan page, so search opened from the picker
    // used to answer "English" however the switch was set.
    if(page) return page.classList.contains('rtl-mode');
    return !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
  }

  // ---- typo tolerance: a fallback only, never the primary match. Exact
  // substring matching (below) stays first and untouched — this only kicks
  // in when it finds nothing, so a correctly-typed query behaves exactly as
  // it always has. Compares the query against each word of the text with a
  // classic edit-distance, tolerant threshold scaling with query length so
  // "cs" doesn't fuzzy-match half the catalogue.
  function levenshtein(a, b){
    if(a === b) return 0;
    var al = a.length, bl = b.length;
    if(!al) return bl;
    if(!bl) return al;
    var prev = new Array(bl + 1);
    for(var j = 0; j <= bl; j++) prev[j] = j;
    for(var i = 1; i <= al; i++){
      var cur = [i];
      for(var jj = 1; jj <= bl; jj++){
        var cost = a.charAt(i - 1) === b.charAt(jj - 1) ? 0 : 1;
        cur[jj] = Math.min(prev[jj] + 1, cur[jj - 1] + 1, prev[jj - 1] + cost);
      }
      prev = cur;
    }
    return prev[bl];
  }
  function fuzzyContains(q, text){
    if(q.length < 3) return false;
    var threshold = q.length <= 5 ? 1 : (q.length <= 9 ? 2 : 3);
    var words = text.split(/\s+/);
    for(var i = 0; i < words.length; i++){
      var w = words[i];
      if(!w || Math.abs(w.length - q.length) > threshold + 2) continue;
      if(levenshtein(q, w) <= threshold) return true;
    }
    return false;
  }

  // ---- why did this match? ------------------------------------------
  // A result used to be a name, an Arabic name and a code with nothing
  // saying which of the three the query actually hit — so searching a course
  // number returned rows whose visible text contained none of it, and a
  // typo-tolerant hit was indistinguishable from an exact one.
  //
  // The match is marked in the text it was found in, and anything the
  // marking cannot explain on its own gets a short label.
  var REASON_LABEL = { code: 'code', ar: 'Arabic name', fuzzy: 'closest match' };

  function reasonFor(item, q){
    if(item.code && item.code.toLowerCase().indexOf(q) !== -1) return 'code';
    if(normalize(item.en).indexOf(q) !== -1) return 'name';
    if(item.ar && normalize(item.ar).indexOf(q) !== -1) return 'ar';
    return 'fuzzy';
  }

  // Marks the query inside the raw text. Deliberately searches the raw
  // lowercased string rather than the normalised one: normalise() strips
  // Arabic diacritics and folds alef variants, so an index taken from it
  // does not line up with the characters actually being displayed. When the
  // query only matches after normalising, the mark is skipped and the label
  // carries the explanation instead — a wrong highlight is worse than none.
  function markMatch(raw, rawQuery){
    var text = raw == null ? '' : String(raw);
    var needle = (rawQuery || '').trim().toLowerCase();
    if(!needle) return escapeHTML(text);
    var at = text.toLowerCase().indexOf(needle);
    if(at === -1) return escapeHTML(text);
    return escapeHTML(text.slice(0, at)) +
      '<mark class="sh-mark">' + escapeHTML(text.slice(at, at + needle.length)) + '</mark>' +
      escapeHTML(text.slice(at + needle.length));
  }

  /* ---------------- generic search-box wiring ---------------- */
  // Only the two states worth a word in a list of results: a course you have
  // already passed, and one you cannot register for yet. "Open" is the normal
  // case and says nothing.
  var STATE_LABEL = { done: 'passed', locked: 'locked' };

  function renderDropdown(dropdownEl, results, opts){
    dropdownEl.innerHTML = '';
    if(!results.length){
      var empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = opts.emptyText || 'No matches';
      dropdownEl.appendChild(empty);
      dropdownEl.classList.add('open');
      return;
    }
    var rawQuery = opts.rawQuery || '';
    results.forEach(function(r){
      var hit = document.createElement('div');
      hit.className = 'search-hit';
      var en = document.createElement('div');
      en.className = 'sh-en';
      en.innerHTML = markMatch(r.en, rawQuery);
      hit.appendChild(en);
      // Both names on every row is the same course said twice: the student
      // reads one of these languages, and the app knows which. The other name
      // appears only when it is the reason the row is here at all — you
      // searched in Arabic and this matched — where it is the answer rather
      // than a duplicate.
      if(r.ar && r.reason === 'ar'){
        var ar = document.createElement('div');
        ar.className = 'sh-ar';
        ar.innerHTML = markMatch(r.ar, rawQuery);
        hit.appendChild(ar);
      }
      if(r.code || r.reason || r.where){
        var meta = document.createElement('div');
        meta.className = 'sh-meta';
        if(r.code){
          var codeEl = document.createElement('span');
          codeEl.className = 'sh-code';
          codeEl.innerHTML = markMatch(r.code, rawQuery);
          meta.appendChild(codeEl);
        }
        if(r.where){
          var whereEl = document.createElement('span');
          whereEl.className = 'sh-where';
          whereEl.textContent = r.where;
          meta.appendChild(whereEl);
        }
        if(r.state && STATE_LABEL[r.state]){
          var stateEl = document.createElement('span');
          stateEl.className = 'sh-state sh-state-' + r.state;
          stateEl.textContent = STATE_LABEL[r.state];
          meta.appendChild(stateEl);
        }
        // 'name' needs no label: the mark in the name above already says it.
        if(REASON_LABEL[r.reason]){
          var why = document.createElement('span');
          why.className = 'sh-why sh-why-' + r.reason;
          why.textContent = REASON_LABEL[r.reason];
          meta.appendChild(why);
        }
        hit.appendChild(meta);
      }
      hit.addEventListener('mousedown', function(e){
        e.preventDefault();
        opts.onSelect(r);
      });
      dropdownEl.appendChild(hit);
    });
    dropdownEl.classList.add('open');
  }

  function attachSearch(opts){
    var input = opts.input, box = opts.box, clearBtn = opts.clear, dropdown = opts.dropdown;
    var activeIndex = -1, currentResults = [];

    function runSearch(){
      var q = normalize(input.value);
      box.classList.toggle('has-value', input.value.length > 0);
      if(!q){ dropdown.classList.remove('open'); currentResults = []; return; }
      var all = opts.getIndex();
      currentResults = all.filter(function(item){
        return normalize(item.en).indexOf(q) !== -1 ||
               normalize(item.ar).indexOf(q) !== -1 ||
               (item.code && item.code.toLowerCase().indexOf(q) !== -1);
      });
      // Nothing matched exactly — try a typo-tolerant pass before giving up.
      if(!currentResults.length){
        currentResults = all.filter(function(item){
          return fuzzyContains(q, normalize(item.en)) || fuzzyContains(q, normalize(item.ar));
        });
      }
      // Shallow copies, not the index entries themselves: getIndex() hands
      // back cached objects that outlive this search, and stamping a reason
      // onto them would leave every past query's answer sitting on the index.
      currentResults = currentResults.slice(0, 10).map(function(item){
        var copy = {};
        Object.keys(item).forEach(function(k){ copy[k] = item[k]; });
        copy.reason = reasonFor(item, q);
        return copy;
      });
      activeIndex = -1;
      renderDropdown(dropdown, currentResults, {
        emptyText: opts.emptyText,
        rawQuery: input.value,
        onSelect: function(r){
          input.value = r.en;
          dropdown.classList.remove('open');
          box.classList.remove('has-value');
          opts.onSelect(r);
        }
      });
    }

    input.addEventListener('input', runSearch);
    input.addEventListener('focus', function(){ if(input.value) runSearch(); });
    input.addEventListener('keydown', function(e){
      var hits = dropdown.querySelectorAll('.search-hit');
      if(e.key === 'ArrowDown'){
        if(!hits.length) return;
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, hits.length - 1);
        hits.forEach(function(h,i){ h.classList.toggle('active-hit', i === activeIndex); });
        hits[activeIndex].scrollIntoView({block:'nearest'});
      } else if(e.key === 'ArrowUp'){
        if(!hits.length) return;
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        hits.forEach(function(h,i){ h.classList.toggle('active-hit', i === activeIndex); });
        hits[activeIndex].scrollIntoView({block:'nearest'});
      } else if(e.key === 'Enter'){
        e.preventDefault();
        var pick = (activeIndex >= 0 && currentResults[activeIndex]) ? currentResults[activeIndex] : currentResults[0];
        if(pick){
          input.value = pick.en;
          dropdown.classList.remove('open');
          box.classList.remove('has-value');
          opts.onSelect(pick);
        }
      } else if(e.key === 'Escape'){
        dropdown.classList.remove('open');
      }
    });
    document.addEventListener('click', function(e){
      if(!box.contains(e.target) && !dropdown.contains(e.target)){
        dropdown.classList.remove('open');
      }
    });
    if(clearBtn){
      clearBtn.addEventListener('click', function(){
        input.value = '';
        box.classList.remove('has-value');
        dropdown.classList.remove('open');
        input.focus();
      });
    }
  }

  /* ---------------- every course in every plan ---------------- */
  // Used by the home screen's search box (js/90-task-home.js).
  //
  // Seventy-seven plans ship with the app and all of their courses are
  // already on the device. "Who teaches Cryptography, and in which year?"
  // was answerable offline the whole time and there was nowhere to ask it:
  // the home search matched major names only, so typing a course name
  // returned "No matching major found".
  //
  // Built once and cached, because it is roughly four thousand entries and
  // the search runs on every keystroke. The cache key carries each plan's
  // version and course count, so editing a plan rebuilds it and nothing
  // else does.
  var courseIdxCache = null, courseIdxKey = '';

  function allPlanCourses(){
    var plans = window.AAUP_IMPORTED ? (window.AAUP_IMPORTED.loadImportedPlans() || {}) : {};
    var ids = Object.keys(plans);
    var key = ids.map(function(id){
      var p = plans[id] || {};
      return id + ':' + (p.version || 0) + ':' + ((p.courses || []).length);
    }).join('|');
    if(courseIdxCache && courseIdxKey === key) return courseIdxCache;

    var rtl = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    // The plan the student is actually on goes first, so its courses win the
    // ten result slots ahead of the same course in someone else's major.
    var selected = window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.getSelected
      ? window.AAUP_DASHBOARD.getSelected() : null;
    ids.sort(function(a, b){
      if(a === selected) return -1;
      if(b === selected) return 1;
      return 0;
    });

    var out = [];
    ids.forEach(function(id){
      var p = plans[id] || {};
      var mn = p.majorName || {};
      var planName = ((rtl ? (mn.ar && mn.ar.big) : (mn.en && mn.en.big)) ||
                      (mn.en && mn.en.big) || id);
      (p.courses || []).forEach(function(c){
        if(!c || !c.id) return;
        var where = [
          planName,
          c.yearId ? String(c.yearId).toUpperCase() : '',
          c.semester ? String(c.semester).toUpperCase() : ''
        ].filter(Boolean).join(' \u00b7 ');
        out.push({
          page: id, slug: c.id, imported: true, isCourse: true,
          en: c.name || c.id, ar: c.ar || '',
          code: c.courseNumber || '',
          where: where
        });
      });
    });
    courseIdxCache = out;
    courseIdxKey = key;
    return out;
  }

  // Open the plan, then land on the course inside it. The plan renders
  // asynchronously, so the card is waited for rather than assumed — and
  // given up on after a second rather than polling forever.
  //
  // It opens the plan without making it the student's own: looking up
  // Cryptography in someone else's major must not quietly swap which major
  // the home screen, GPA and progress are about.
  function openCourseInPlan(planId, slug){
    if(!(window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.openStudyPlan)) return;
    window.AAUP_DASHBOARD.openStudyPlan(planId);
    var tries = 0;
    (function land(){
      var el = document.getElementById(planId + '-c-' + slug);
      if(el && window.__selectCourse){ window.__selectCourse(planId, slug); return; }
      if(tries++ > 20) return;
      setTimeout(land, 50);
    })();
  }
  window.AAUP_SEARCH = { allCourses: allPlanCourses, openCourse: openCourseInPlan, normalize: normalize, fuzzyContains: fuzzyContains };

  /* ---------------- per-plan course search ---------------- */
  function buildCourseIndex(prefix){
    var data = window.__PLAN_DATA[prefix];
    if(!data) return;
    var nodes = document.querySelectorAll('#page-' + prefix + ' .course[id]');
    var idx = [];
    nodes.forEach(function(el){
      var nameEl = el.querySelector('.name');
      if(!nameEl) return;
      var slug = el.id.replace(prefix + '-c-', '');
      var info = data.courseInfo[slug];
      var en = (nameEl.dataset.en || nameEl.textContent || '').trim();
      // data-ar is read first because a plan the student has edited carries
      // its newest name in the DOM. It is almost never actually there — no
      // renderer writes that attribute — which meant every entry's ar was
      // '' and searching a course by its Arabic name matched nothing, on
      // every plan, however the query was typed. courseInfo has the name
      // all along; the index simply never asked it.
      // ...but only when it is genuinely a second name. An imported plan
      // stores ar as `c.ar || c.name`, so a plan with no Arabic names has
      // ar === the English name throughout, and taking it verbatim printed
      // every result's name twice in the dropdown.
      var infoAr = info && info.ar && info.ar !== en ? info.ar : '';
      var ar = nameEl.getAttribute('data-ar') || infoAr || '';
      // Where the card sits and how it stands, both read off the card itself
      // (js/28-imported.js stamps data-where). A result that says only the
      // name makes you tap it to find out whether it is this year's problem
      // or a third-year one.
      var state = el.classList.contains('completed') ? 'done'
        : el.classList.contains('available') ? 'open' : 'locked';
      idx.push({ slug: slug, id: el.id, en: en, ar: ar, code: info ? info.num : '',
                 where: el.getAttribute('data-where') || '', state: state });
    });
    data.index = idx;
  }

  function courseLabel(prefix, slug){
    var data = window.__PLAN_DATA[prefix];
    var item = data && data.index && data.index.filter(function(i){ return i.slug === slug; })[0];
    if(!item) return slug;
    return (isRtl(prefix) && item.ar) ? item.ar : item.en;
  }

  function initCourseSearch(prefix){
    var input = document.getElementById(prefix + '-courseSearchInput');
    var box = document.getElementById(prefix + '-courseSearchBox');
    var clear = document.getElementById(prefix + '-courseSearchClear');
    var dropdown = document.getElementById(prefix + '-courseSearchDropdown');
    if(!input) return;
    buildCourseIndex(prefix);
    attachSearch({
      input: input, box: box, clear: clear, dropdown: dropdown,
      getIndex: function(){ return (window.__PLAN_DATA[prefix] && window.__PLAN_DATA[prefix].index) || []; },
      emptyText: 'No matching course found / لا يوجد مساق مطابق',
      onSelect: function(r){
        input.value = '';
        box.classList.remove('has-value');
        // Searching a course now opens its prerequisite map (js/54-prereq-
        // graph.js) — the approved mockup for what a search result looks
        // like — instead of the old scroll-to-and-highlight-on-the-page
        // behavior. selectCourse() itself is untouched and still exposed
        // as window.__selectCourse for other callers (What's Next) that
        // want that original behavior, not this one.
        if(window.AAUP_PREREQ_GRAPH){ window.AAUP_PREREQ_GRAPH.open(prefix, r.slug); }
        else { selectCourse(prefix, r.slug); }
      }
    });
  }

  function updateSearchPlaceholder(prefix){
    var input = document.getElementById(prefix + '-courseSearchInput');
    if(!input) return;
    input.placeholder = isRtl(prefix)
      ? (input.dataset.phAr || input.placeholder)
      : (input.dataset.phEn || input.placeholder);
  }

  /* ---------------- cross-highlighting on the plan page ---------------- */
  var currentHighlightPrefix = null;

  // An icon, not an emoji — same rule the rest of the app follows, and an
  // emoji here rendered at whatever size and colour the platform felt like.
  function addBadge(el, iconKey){
    var b = document.createElement('span');
    b.className = 'search-badge';
    if(window.AAUP_ICONS){ b.innerHTML = window.AAUP_ICONS.preview(iconKey, 12); }
    else { b.textContent = iconKey === 'tick' ? '\u2713' : '\u25CB'; }
    el.appendChild(b);
  }

  function clearHighlights(prefix){
    if(!prefix) return;
    var page = document.getElementById('page-' + prefix);
    if(!page) return;
    page.querySelectorAll('.course.search-selected, .course.search-prereq, .course.search-unlock').forEach(function(el){
      el.classList.remove('search-selected','search-prereq','search-unlock');
      var b = el.querySelector('.search-badge');
      if(b) b.remove();
    });
    var svg = document.getElementById(prefix + '-connectorSvg');
    if(svg){
      svg.querySelectorAll('path.edge').forEach(function(p){
        p.classList.remove('search-active','search-dim');
        p.style.strokeDasharray = '';
        p.style.strokeDashoffset = '';
      });
    }
  }

  function selectCourse(prefix, slug){
    clearHighlights(currentHighlightPrefix);
    currentHighlightPrefix = prefix;

    var el = document.getElementById(prefix + '-c-' + slug);
    if(!el) return;

    // Years start folded, so the course a search just found is usually
    // inside a closed one. Open it before scrolling, or the page scrolls to
    // a collapsed bar and the student is told nothing was found.
    if(window.__revealYearFor) window.__revealYearFor(prefix, el);
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('search-selected');

    var data = window.__PLAN_DATA[prefix] || {};
    var needs = (data.needsMap && data.needsMap[slug]) || [];
    var unlocks = (data.unlocksMap && data.unlocksMap[slug]) || [];

    needs.forEach(function(s){
      var e = document.getElementById(prefix + '-c-' + s);
      if(e){ e.classList.add('search-prereq'); addBadge(e, 'tick'); }
    });
    unlocks.forEach(function(s){
      var e = document.getElementById(prefix + '-c-' + s);
      if(e){ e.classList.add('search-unlock'); addBadge(e, 'unlock'); }
    });

    var svg = document.getElementById(prefix + '-connectorSvg');
    if(svg){
      var id = prefix + '-c-' + slug;
      var allPaths = Array.prototype.slice.call(svg.querySelectorAll('path.edge'));
      var relatedPaths = allPaths.filter(function(p){
        return p.getAttribute('data-from') === id || p.getAttribute('data-to') === id;
      });
      // Same "sketch" draw-in technique as the hover trace: measure real
      // path length first so the transition has an exact starting point.
      relatedPaths.forEach(function(p){
        var len; try{ len = p.getTotalLength(); }catch(e){ len = 2000; }
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
      });
      void svg.getBoundingClientRect();
      requestAnimationFrame(function(){
        allPaths.forEach(function(p){
          var related = relatedPaths.indexOf(p) !== -1;
          p.classList.toggle('search-active', related);
          p.classList.toggle('search-dim', !related);
          // Same specificity fix as the hover trace: the target value has
          // to be set inline too, or the class's stroke-dashoffset:0 is
          // silently beaten by the inline starting value set above.
          if(related){ p.style.strokeDashoffset = 0; }
        });
      });
    }

    openFloatingPopup(prefix, slug);
  }
  // Exposed so other features (e.g. the "What Can I Take Next" sidebar list)
  // can trigger the exact same scroll + highlight + popup behavior as a
  // manual search selection, instead of re-implementing it.
  window.__selectCourse = selectCourse;
  // Exposed so imported/custom plans reuse the exact same search box +
  // dropdown + keyboard navigation the built-in majors already have,
  // instead of a second implementation.
  window.__buildCourseIndex = buildCourseIndex;
  window.__attachSearch = attachSearch;

  /* ---------------- floating draggable popup ---------------- */
  var popupEl, popupHead, popupTitle, popupBody, popupCloseBtn;
  var POPUP_POS_KEY = 'aaup_popupPos';
  function loadPopupPos(){
    try{
      var v = JSON.parse(localStorage.getItem(POPUP_POS_KEY));
      return (v && typeof v.left === 'string' && typeof v.top === 'string') ? v : null;
    }catch(e){ return null; }
  }
  function savePopupPos(pos){
    try{ localStorage.setItem(POPUP_POS_KEY, JSON.stringify(pos)); }catch(e){}
  }
  var lastPopupPos = loadPopupPos();

  function listHTML(prefix, slugs){
    return '<ul>' + slugs.map(function(s){
      return '<li>' + escapeHTML(courseLabel(prefix, s)) + '</li>';
    }).join('') + '</ul>';
  }

  function whyNeedsText(prefix, slug, needs, rtl){
    var courseName = courseLabel(prefix, slug);
    var needNames = needs.map(function(s){ return courseLabel(prefix, s); }).join(rtl ? '، ' : ', ');
    return rtl
      ? ('يبني مساق «' + courseName + '» على المفاهيم والمهارات التي تُكتسب في ' + needNames + '، لذلك يجب إنهاء هذه المساقات أولًا لضمان الاستعداد الكافي لمتابعة محتواه بنجاح.')
      : ('"' + courseName + '" builds directly on the concepts and skills covered in ' + needNames + ', so those courses must be completed first to make sure you have the right foundation.');
  }

  function whyUnlocksText(prefix, slug, unlocks, rtl){
    var courseName = courseLabel(prefix, slug);
    var unlockNames = unlocks.map(function(s){ return courseLabel(prefix, s); }).join(rtl ? '، ' : ', ');
    return rtl
      ? ('يمنحك مساق «' + courseName + '» الأساس اللازم للانتقال إلى ' + unlockNames + '، حيث تُبنى تلك المساقات على ما يتم تعلمه هنا.')
      : ('"' + courseName + '" gives you the foundation you need to move on to ' + unlockNames + ', which build on what you learn here.');
  }

  function consequenceText(prefix, slug, unlocks, rtl){
    var courseName = courseLabel(prefix, slug);
    if(unlocks.length){
      var unlockNames = unlocks.map(function(s){ return courseLabel(prefix, s); }).join(rtl ? '، ' : ', ');
      return rtl
        ? ('إذا لم تنجح في مساق «' + courseName + '»، فلن تتمكن من التسجيل في ' + unlockNames + ' في الفصل التالي لأنها تتطلبه كمتطلب سابق — وهذا قد يؤخر خطتك الدراسية فصلاً دراسياً كاملاً أو أكثر. لهذا السبب من المهم جداً إعادته في الفصل الصيفي: فالإعادة الصيفية تتيح لك اجتياز المتطلب بسرعة والعودة إلى مسارك الطبيعي في الفصل التالي، بدلاً من خسارة فصل دراسي كامل بانتظار الطرح النظامي التالي للمساق.')
        : ('If you don\u2019t pass "' + courseName + '", you won\u2019t be able to register for ' + unlockNames + ' next semester, since they list it as a prerequisite — which can push your whole plan back by a semester or more. That\u2019s exactly why it\u2019s important to retake it in the summer semester: a summer retake clears the prerequisite quickly so you\u2019re back on track for the following fall/spring, instead of losing a full semester waiting for the next regular offering.');
    }
    return rtl
      ? ('يبقى مساق «' + courseName + '» متطلبًا أساسيًا لإكمال ساعات التخرج، لذا فإن الرسوب فيه يعني ضرورة إعادته. تأجيله إلى الفصل النظامي التالي (خريف أو ربيع) يضيف عبئًا إضافيًا على جدول دراسي مزدحم أصلاً وقد يؤخر موعد تخرجك. أما إعادته في الفصل الصيفي فتتيح لك إنهاءه مبكرًا دون التأثير على باقي مساقاتك، والحفاظ على مسارك الدراسي دون تأخير.')
      : ('"' + courseName + '" is still a required course for your graduation credit hours, so failing it means retaking it before those requirements are complete. Leaving it for the next regular fall/spring semester adds extra load to an already full schedule and can delay your graduation date. Retaking it in summer clears it out of the way early, without crowding your other courses, and keeps the rest of your plan on schedule.');
  }

  function buildPopupHTML(prefix, slug){
    var data = window.__PLAN_DATA[prefix] || {};
    var rtl = isRtl(prefix);
    var needs = (data.needsMap && data.needsMap[slug]) || [];
    var unlocks = (data.unlocksMap && data.unlocksMap[slug]) || [];

    var L = rtl ? {
      needs:'المتطلبات السابقة (تحتاج إلى)', unlocks:'يفتح المجال أمام',
      whyNeeds:'لماذا تحتاج إلى هذه المتطلبات', whyUnlocks:'كيف يؤهلك هذا المساق للمساقات التالية',
      none:'لا توجد متطلبات سابقة لهذا المساق.',
      noneUnlocks:'هذا المساق لا يفتح مساقات لاحقة مباشرة ضمن المخطط.',
      consequence:'ماذا لو لم تنجح في هذا المساق؟'
    } : {
      needs:'Prerequisites (Needs)', unlocks:'Unlocks',
      whyNeeds:'Why you need these prerequisites', whyUnlocks:'Why this course unlocks the following courses',
      none:'This course has no prerequisites.',
      noneUnlocks:'This course does not directly unlock further courses in the plan.',
      consequence:'If you don\u2019t pass this course'
    };

    var html = '';
    html += '<h4><span class="badge-ic">' + window.AAUP_ICONS.preview('check', 16) + '</span>' + L.needs + '</h4>';
    html += needs.length ? listHTML(prefix, needs) : ('<div class="fp-empty">' + L.none + '</div>');
    if(needs.length){
      html += '<h4>' + L.whyNeeds + '</h4>';
      html += '<div class="fp-why">' + escapeHTML(whyNeedsText(prefix, slug, needs, rtl)) + '</div>';
    }

    html += '<h4><span class="badge-ic">' + window.AAUP_ICONS.preview('unlock', 16) + '</span>' + L.unlocks + '</h4>';
    html += unlocks.length ? listHTML(prefix, unlocks) : ('<div class="fp-empty">' + L.noneUnlocks + '</div>');
    if(unlocks.length){
      html += '<h4>' + L.whyUnlocks + '</h4>';
      html += '<div class="fp-why">' + escapeHTML(whyUnlocksText(prefix, slug, unlocks, rtl)) + '</div>';
    }

    html += '<h4><span class="badge-ic">' + window.AAUP_ICONS.preview('warning', 16) + '</span>' + L.consequence + '</h4>';
    html += '<div class="fp-warn">' + escapeHTML(consequenceText(prefix, slug, unlocks, rtl)) + '</div>';

    return html;
  }

  function refreshPopupContent(prefix, slug){
    var rtl = isRtl(prefix);
    popupEl.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    popupTitle.textContent = (rtl ? 'المساق: ' : 'Course: ') + courseLabel(prefix, slug);
    popupBody.innerHTML = buildPopupHTML(prefix, slug);
  }

  function positionPopup(){
    if(lastPopupPos){
      popupEl.style.left = lastPopupPos.left;
      popupEl.style.top = lastPopupPos.top;
      popupEl.style.right = 'auto';
      // Mobile's default placement pins the popup with `bottom` (see the
      // max-width:640px rule); once it's been dragged even once, top/left
      // drive its position instead, and leaving the old `bottom` in place
      // too would fight them for the box's height.
      popupEl.style.bottom = 'auto';
    }
  }

  function openFloatingPopup(prefix, slug){
    if(!popupEl) return;
    positionPopup();
    refreshPopupContent(prefix, slug);
    popupEl.classList.remove('minimized');
    popupEl.style.display = 'block';
    popupEl.dataset.prefix = prefix;
    popupEl.dataset.slug = slug;
  }

  function closeFloatingPopup(){
    if(!popupEl || popupEl.style.display === 'none') return;
    popupEl.style.display = 'none';
    clearHighlights(currentHighlightPrefix);
    currentHighlightPrefix = null;
  }

  function initFloatingPopup(){
    popupEl = document.getElementById('floatPopup');
    popupHead = document.getElementById('floatPopupHead');
    popupTitle = document.getElementById('floatPopupTitle');
    popupBody = document.getElementById('floatPopupBody');
    popupCloseBtn = document.getElementById('floatPopupClose');
    var popupMinBtn = document.getElementById('floatPopupMin');
    if(!popupEl) return;

    popupCloseBtn.addEventListener('click', closeFloatingPopup);
    if(popupMinBtn){
      popupMinBtn.addEventListener('click', function(){
        popupEl.classList.toggle('minimized');
      });
    }

    var dragging = false, startX, startY, startLeft, startTop;
    popupHead.addEventListener('pointerdown', function(e){
      if(e.target.closest('.float-popup-close, .float-popup-min')) return;
      dragging = true;
      var rect = popupEl.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      popupEl.style.right = 'auto';
      popupEl.style.bottom = 'auto';
      popupEl.style.left = startLeft + 'px';
      popupEl.style.top = startTop + 'px';
      try{ popupHead.setPointerCapture(e.pointerId); }catch(err){}
    });
    popupHead.addEventListener('pointermove', function(e){
      if(!dragging) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      var newLeft = Math.max(4, Math.min(window.innerWidth - 60, startLeft + dx));
      var newTop = Math.max(4, Math.min(window.innerHeight - 40, startTop + dy));
      popupEl.style.left = newLeft + 'px';
      popupEl.style.top = newTop + 'px';
    });
    function endDrag(){
      if(!dragging) return;
      dragging = false;
      lastPopupPos = { left: popupEl.style.left, top: popupEl.style.top };
      savePopupPos(lastPopupPos);
    }
    popupHead.addEventListener('pointerup', endDrag);
    popupHead.addEventListener('pointercancel', endDrag);
  }

  /* ---------------- wire into existing showPage / toggleLang ---------------- */
  var _origShowPage = window.showPage;
  window.showPage = function(id){
    if(popupEl && popupEl.style.display !== 'none' && popupEl.dataset.prefix !== id){
      closeFloatingPopup();
    }
    _origShowPage(id);
  };

  var _origToggleLang = window.toggleLang;
  window.toggleLang = function(prefix){
    _origToggleLang(prefix);
    updateSearchPlaceholder(prefix);
    if(popupEl && popupEl.style.display !== 'none' && popupEl.dataset.prefix === prefix){
      refreshPopupContent(prefix, popupEl.dataset.slug);
    }
  };

  function initAll(){
    initFloatingPopup();
    Object.keys(window.__PLAN_DATA || {}).forEach(initCourseSearch);
  }

  if(document.readyState === 'complete'){ initAll(); }
  else { window.addEventListener('load', initAll); }

})();
