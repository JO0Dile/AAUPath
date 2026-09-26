// ==========================
// PLAN MY NEXT SEMESTER — the semester builder.
//
// Fully offline: it uses only the prerequisite graph already on the page,
// the credit hours in the plan data, and the student's own ratings of
// courses they have actually taken. Nothing is invented for a course they
// have not sat.
//
// This started life as a read-only list: here are eight courses, good luck.
// A student picking a semester is choosing BETWEEN courses, so the screen
// now lets them do that — tap a course in or out, watch the credit meter
// move, see what each choice unlocks, and get told when the load stops
// being a sensible one. The suggestion is still there: it is what the tray
// starts out holding.
//
// The 12 / 15–18 numbers are this app's own guide, not a rule read out of
// any official regulation — the screen says so rather than implying the
// university has approved them.
// ==========================
(function(){
  var TARGET_MAX = 18;                     // what the suggestion fills up to
  var FULL_TIME = 12;                      // below this the meter warns
  var METER_MAX = 21;                      // the meter's right-hand end
  var CATS = ['core', 'math', 'dept', 'eng', 'uni', 'free', 'skills'];
  var CAT_LABEL = {
    skills: { en: 'University Req.', ar: 'متطلب جامعي' },
    core:   { en: 'Specialization Req.', ar: 'متطلب تخصص' },
    math:   { en: 'College Req.', ar: 'متطلب كلية' },
    dept:   { en: 'Specialization Elec.', ar: 'اختياري تخصص' },
    eng:    { en: 'University Req.', ar: 'متطلب جامعي' },
    uni:    { en: 'University Elec.', ar: 'اختياري جامعي' },
    free:   { en: 'Free Elec.', ar: 'اختياري حر' }
  };

  var PICK_KEY = 'aaup_semesterPick';   // { prefix: [slug, ...] }
  var picks = null;                      // lazy-loaded copy of the above
  var search = '';                       // the pool filter box
  var openPrefix = null;

  function categoryOf(el){
    for(var i = 0; i < CATS.length; i++){ if(el.classList.contains(CATS[i])) return CATS[i]; }
    return null;
  }

  // Course names can arrive already HTML-encoded from a plan's JSON, so
  // decode once and re-escape once rather than printing "&amp;" at a student.
  function esc(s){
    var v = String(s == null ? '' : s);
    if(window.__cleanText) return window.__cleanText(v);
    return window.__escapeHtml ? window.__escapeHtml(v) : v;
  }

  // ---- what the student has found hard before -----------------------------
  // Averaged over their OWN ratings, per category. A category they have
  // never rated stays unknown and is never guessed at.
  function hardCategories(prefix){
    var page = document.getElementById('page-' + prefix);
    var out = {};
    if(!page || !window.AAUP_PERSONAL || !window.AAUP_GPA) return out;
    var ratings = window.AAUP_PERSONAL.loadRatings();
    var progress = window.__getProgress();
    var tally = {};
    page.querySelectorAll('.course[id]:not(.course-removed)').forEach(function(el){
      if(!progress[el.id]) return;
      var cat = categoryOf(el);
      if(!cat) return;
      var parts = window.__splitCourseId(el.id);
      var r = ratings[window.AAUP_GPA.primaryId(prefix, parts.slug)];
      if(!r || (!r.workload && !r.difficulty)) return;
      tally[cat] = tally[cat] || { hard: 0, total: 0 };
      tally[cat].total++;
      if(r.workload === 'Hard' || (r.difficulty || 0) >= 4) tally[cat].hard++;
    });
    Object.keys(tally).forEach(function(cat){
      out[cat] = tally[cat].total > 0 && (tally[cat].hard / tally[cat].total) >= 0.5;
    });
    return out;
  }

  // ---- the pool -----------------------------------------------------------
  // Every course open to the student right now: unlocked, not yet passed,
  // and counted once per catalogue number so a lecture+lab pair is one
  // choice worth its hours once rather than two worth double.
  function poolFor(prefix){
    var page = document.getElementById('page-' + prefix);
    var data = window.__PLAN_DATA[prefix] || {};
    var info = data.courseInfo || {};
    var needsMap = data.needsMap || {};
    var unlocksMap = data.unlocksMap || {};
    var open = page ? window.__openCourses(prefix) : [];
    if(window.__dedupeForCredit) open = window.__dedupeForCredit(prefix, open);
    var hard = hardCategories(prefix);

    return open.map(function(el){
      var parts = window.__splitCourseId(el.id);
      var meta = info[parts.slug] || {};
      var unlocks = unlocksMap[parts.slug] || [];
      var cat = categoryOf(el);
      return {
        el: el, slug: parts.slug, id: el.id,
        // Only a real catalogue number. Generic elective slots carry their
        // own slug there ("uni-elective-1"), which means nothing to a
        // student reading a course row.
        num: /^[0-9]/.test(String(meta.num || '')) ? meta.num : '',
        cr: parseFloat(meta.cr) || 0,
        cat: cat,
        unlocks: unlocks, unlocksCount: unlocks.length,
        needs: needsMap[parts.slug] || [],
        likelyHard: !!(cat && hard[cat])
      };
    }).sort(function(a, b){
      if(b.unlocksCount !== a.unlocksCount) return b.unlocksCount - a.unlocksCount;
      return a.cr - b.cr;
    });
  }

  function courseName(prefix, slug, rtl){
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var meta = info[slug];
    return meta ? (rtl ? (meta.ar || meta.name) : (meta.name || meta.ar)) : slug;
  }

  // ---- why this course is in the suggestion -------------------------------
  // Read straight off the two things recommend() actually ranks by: how many
  // later courses a pass in this one opens, and its credit hours (the tie
  // break, and what decides whether it still fits under the cap). The tray
  // listed a name and an hour count and nothing else, so the app's own
  // suggestion arrived with no argument for itself — a student could see
  // what it picked but not why, which is the part worth disagreeing with.
  function reasonFor(c, rtl){
    if(c.unlocksCount > 0){
      return rtl
        ? 'يفتح ' + c.unlocksCount + (c.unlocksCount === 1 ? ' مساق لاحق' : ' مساقات لاحقة')
        : 'opens ' + c.unlocksCount + (c.unlocksCount === 1 ? ' later course' : ' later courses');
    }
    return rtl ? 'يملأ الساعات المتبقية' : 'fills the remaining hours';
  }
  function cautionFor(c, rtl){
    if(!c.likelyHard) return '';
    return rtl ? 'من فئة قيّمتها صعبة سابقًا' : 'in a category you rated Hard before';
  }

  // ---- the suggestion (also used by the dashboard) ------------------------
  function recommend(prefix){
    var candidates = poolFor(prefix);
    var chosen = [], totalCr = 0;
    candidates.forEach(function(c){
      if(totalCr >= TARGET_MAX) return;
      if(totalCr + c.cr <= TARGET_MAX){ chosen.push(c); totalCr += c.cr; }
    });
    var hardCount = 0;
    chosen.forEach(function(c){ if(c.likelyHard) hardCount++; });
    return { chosen: chosen, totalCr: totalCr, hardCount: hardCount, poolSize: candidates.length };
  }

  // ---- what the student has picked ---------------------------------------
  function loadPicks(){
    if(picks) return picks;
    try{ picks = JSON.parse(localStorage.getItem(PICK_KEY) || '{}') || {}; }
    catch(e){ picks = {}; }
    return picks;
  }
  function savePicks(){
    try{ localStorage.setItem(PICK_KEY, JSON.stringify(loadPicks())); }catch(e){}
  }
  // The tray starts out holding the suggestion — a blank screen would make
  // the student do the work the app is supposed to have already done — but
  // once they touch it, their own selection is what persists.
  function pickedFor(prefix, pool){
    var all = loadPicks();
    if(!Object.prototype.hasOwnProperty.call(all, prefix)){
      all[prefix] = recommend(prefix).chosen.map(function(c){ return c.slug; });
      savePicks();
    }
    var live = {};
    pool.forEach(function(c){ live[c.slug] = true; });
    // Anything picked in an earlier session that is no longer open (passed
    // it, or the plan changed) quietly drops out rather than counting hours
    // for a course that is not there.
    return all[prefix].filter(function(s){ return live[s]; });
  }
  function setPicked(prefix, list){
    loadPicks()[prefix] = list.slice();
    savePicks();
  }

  function totalsFor(pool, chosenSlugs){
    var byCat = {}, cr = 0, hard = 0;
    var index = {};
    pool.forEach(function(c){ index[c.slug] = c; });
    chosenSlugs.forEach(function(s){
      var c = index[s]; if(!c) return;
      cr += c.cr;
      if(c.cat) byCat[c.cat] = (byCat[c.cat] || 0) + c.cr;
      if(c.likelyHard) hard++;
    });
    return { cr: cr, count: chosenSlugs.length, byCat: byCat, hard: hard, index: index };
  }

  // ---- rendering ----------------------------------------------------------
  function meterHtml(t, rtl){
    var pct = Math.max(0, Math.min(100, (t.cr / METER_MAX) * 100));
    var state = t.cr === 0 ? 'empty' : t.cr < FULL_TIME ? 'low' : t.cr <= TARGET_MAX ? 'good' : 'over';
    var note = t.cr === 0
      ? (rtl ? 'ما اخترت شي بعد' : 'nothing picked yet')
      : t.cr < FULL_TIME
        ? (rtl ? 'أقل من ' + FULL_TIME + ' ساعة' : 'under ' + FULL_TIME + 'H')
        : t.cr <= TARGET_MAX
          ? (rtl ? 'حمل فصل معقول' : 'a normal full load')
          : (rtl ? 'أعلى من ' + TARGET_MAX + ' ساعة' : 'over ' + TARGET_MAX + 'H');
    return '<div class="sb-meter sb-meter-' + state + '">' +
      '<div class="sb-meter-top">' +
        '<span class="sb-meter-num">' + t.cr + 'H</span>' +
        '<span class="sb-meter-note">' + t.count + ' ' +
          (rtl ? 'مساق' : (t.count === 1 ? 'course' : 'courses')) + ' · ' + note + '</span>' +
      '</div>' +
      '<div class="sb-meter-bar" role="img" aria-label="' + t.cr +
        (rtl ? ' ساعة معتمدة' : ' credit hours') + '">' +
        '<span class="sb-meter-fill" style="width:' + pct.toFixed(1) + '%;"></span>' +
        '<span class="sb-meter-tick" style="inset-inline-start:' + ((FULL_TIME / METER_MAX) * 100).toFixed(1) + '%;"></span>' +
        '<span class="sb-meter-tick" style="inset-inline-start:' + ((TARGET_MAX / METER_MAX) * 100).toFixed(1) + '%;"></span>' +
      '</div>' +
      '<div class="sb-meter-scale"><span>0</span><span>' + FULL_TIME + 'H</span><span>' + TARGET_MAX + 'H</span></div>' +
      '</div>';
  }

  function rowHtml(prefix, c, isOn, rtl){
    var label = CAT_LABEL[c.cat] ? (rtl ? CAT_LABEL[c.cat].ar : CAT_LABEL[c.cat].en) : '';
    return '<button type="button" class="sb-row' + (isOn ? ' sb-row-on' : '') + '" data-sb-slug="' +
        esc(c.slug) + '" aria-pressed="' + isOn + '">' +
      '<span class="sb-row-tick">' + window.AAUP_ICONS.preview(isOn ? 'check' : 'plus', 14) + '</span>' +
      '<span class="sb-row-main">' +
        '<span class="sb-row-name">' + esc(courseName(prefix, c.slug, rtl)) + '</span>' +
        '<span class="sb-row-meta">' +
          (c.num ? '<span>' + esc(c.num) + '</span>' : '') +
          (label ? '<span class="sb-chip sb-chip-' + c.cat + '">' + esc(label) + '</span>' : '') +
          (c.unlocksCount ? '<span class="sb-chip sb-chip-unlock">' + window.AAUP_ICONS.preview('unlock', 12) + ' ' +
            (rtl ? 'يفتح ' + c.unlocksCount : 'unlocks ' + c.unlocksCount) + '</span>' : '') +
          (c.likelyHard ? '<span class="sb-chip sb-chip-hard">' +
            (rtl ? 'صعب عليك سابقًا' : 'hard for you before') + '</span>' : '') +
        '</span>' +
      '</span>' +
      '<span class="sb-row-cr">' + c.cr + 'H</span>' +
      '</button>';
  }

  function trayHtml(prefix, pool, chosen, t, rtl){
    if(!chosen.length){
      return '<p class="sb-empty">' + (rtl
        ? 'الدرج فاضي — اختر مساقات من القائمة.'
        : 'Empty — tap courses on the left to build a semester.') + '</p>';
    }
    return chosen.map(function(s){
      var c = t.index[s];
      var caution = cautionFor(c, rtl);
      return '<div class="sb-tray-item">' +
        '<div class="sb-tray-main">' +
          '<span class="sb-tray-name">' + esc(courseName(prefix, s, rtl)) + '</span>' +
          '<span class="sb-tray-why">' + esc(reasonFor(c, rtl)) + '</span>' +
          (caution ? '<span class="sb-tray-caution">' + esc(caution) + '</span>' : '') +
        '</div>' +
        '<span class="sb-tray-cr">' + c.cr + 'H</span>' +
        '<button type="button" class="sb-tray-x" data-sb-remove="' + esc(s) + '" aria-label="' +
          (rtl ? 'إزالة' : 'Remove') + ' ' + esc(courseName(prefix, s, rtl)) + '">' + window.AAUP_ICONS.preview('close', 12) + '</button>' +
        '</div>';
    }).join('');
  }

  function warningsHtml(t, rtl){
    var out = [];
    if(t.cr > TARGET_MAX){
      out.push((rtl
        ? 'هذا أعلى من ' + TARGET_MAX + ' ساعة — راجع مرشدك قبل التسجيل.'
        : 'That is over ' + TARGET_MAX + 'H — check with your advisor before registering.'));
    } else if(t.cr > 0 && t.cr < FULL_TIME){
      out.push((rtl
        ? 'أقل من ' + FULL_TIME + ' ساعة. تأكد من شروط الدوام الكامل عند التسجيل.'
        : 'Under ' + FULL_TIME + 'H. Check what your registration counts as full-time.'));
    }
    if(t.hard > 2){
      out.push((rtl
        ? 'فيه ' + t.hard + ' مساقات من فئات قيّمتها صعبة سابقًا — فكّر تبدّل واحد.'
        : t.hard + ' of these are in categories you rated Hard before — consider swapping one.'));
    }
    if(!out.length) return '';
    return '<div class="sb-warn">' + out.map(function(w){
      return '<p>' + window.AAUP_ICONS.preview('warning', 13) + w + '</p>';
    }).join('') + '</div>';
  }

  function breakdownHtml(t, rtl){
    var keys = Object.keys(t.byCat);
    if(!keys.length) return '';
    return '<div class="sb-breakdown">' + keys.map(function(cat){
      var label = CAT_LABEL[cat] ? (rtl ? CAT_LABEL[cat].ar : CAT_LABEL[cat].en) : cat;
      return '<span class="sb-bd"><span class="sb-bd-chip sb-chip-' + cat + '"></span>' +
        esc(label) + ' <b>' + t.byCat[cat] + 'H</b></span>';
    }).join('') + '</div>';
  }

  function poolRowsHtml(prefix, pool, chosenSet, rtl){
    var q = search.trim().toLowerCase();
    var rows = pool.filter(function(c){
      if(!q) return true;
      return (courseName(prefix, c.slug, rtl) + ' ' + courseName(prefix, c.slug, !rtl) + ' ' + c.num)
        .toLowerCase().indexOf(q) !== -1;
    });
    if(!rows.length){
      return '<p class="sb-empty">' + (rtl ? 'ما في نتائج.' : 'Nothing matches that.') + '</p>';
    }
    return rows.map(function(c){ return rowHtml(prefix, c, !!chosenSet[c.slug], rtl); }).join('');
  }

  function render(prefix){
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var pool = poolFor(prefix);
    var chosen = pickedFor(prefix, pool);
    var chosenSet = {};
    chosen.forEach(function(s){ chosenSet[s] = true; });
    var t = totalsFor(pool, chosen);

    // No title in the back bar: the <h2> underneath already says it, and
    // printing the same words twice in a row reads like a mistake.
    var head = (window.__backBarHTML ? window.__backBarHTML('', 'advisorModalOverlay', rtl) : '') +
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('brain', 20) + (rtl ? 'خطط لفصلي القادم' : 'Plan My Next Semester') + '</h2>';

    if(!pool.length){
      return head + '<p class="ex-note">' + (rtl
        ? 'لا توجد مساقات متاحة الآن — أكمل بعض المتطلبات السابقة أولًا.'
        : 'Nothing is unlocked yet — complete a few prerequisites first.') + '</p>';
    }

    return head +
      '<p class="form-note sb-lead">' + (rtl
        ? 'ابدأ من اقتراح التطبيق، وبدّل فيه زي ما بدك. الأرقام (12 / 15–18 ساعة) دليل هذا التطبيق نفسه، مش قاعدة رسمية — أكّدها مع مرشدك.'
        : 'Start from the app’s suggestion and change it however you like. The 12 and 15–18H numbers are this app’s own guide, not an official rule — confirm them with your advisor.') + '</p>' +
      // A zero-height marker directly above the meter. When it scrolls out of
      // the modal's own scroll box the meter is stuck, which is the only
      // reliable way to know: position:sticky fires no event of its own.
      '<div id="sbStickSentinel" aria-hidden="true"></div>' +
      '<div id="sbMeterHost">' + meterHtml(t, rtl) + '</div>' +
      '<div class="sb-cols">' +
        '<section class="sb-pool">' +
          '<div class="sb-pool-head">' +
            '<h3>' + (rtl ? 'متاح لك الآن' : 'Open to you now') + ' <span class="sb-count">' + pool.length + '</span></h3>' +
            '<input type="search" id="sbSearch" class="sb-search" placeholder="' +
              (rtl ? 'ابحث…' : 'Search…') + '" value="' + esc(search) + '">' +
          '</div>' +
          '<div class="sb-rows" id="sbRows">' + poolRowsHtml(prefix, pool, chosenSet, rtl) + '</div>' +
        '</section>' +
        '<aside class="sb-tray">' +
          '<h3>' + (rtl ? 'فصلي' : 'My semester') + '</h3>' +
          '<div class="sb-tray-list" id="sbTray">' + trayHtml(prefix, pool, chosen, t, rtl) + '</div>' +
          '<div id="sbExtra">' + breakdownHtml(t, rtl) + warningsHtml(t, rtl) + '</div>' +
          '<div class="sb-actions">' +
            '<button type="button" class="home-btn" id="sbReset">' + window.AAUP_ICONS.preview('undo', 14) +
              (rtl ? 'ارجع للاقتراح' : 'Use the suggestion') + '</button>' +
            // Starting over meant un-picking a dozen courses one at a time.
            '<button type="button" class="home-btn" id="sbClear">' + window.AAUP_ICONS.preview('trash', 14) +
              (rtl ? 'امسح الكل' : 'Clear all') + '</button>' +
            '<button type="button" class="home-btn" id="sbCopy">' + window.AAUP_ICONS.preview('copy', 14) +
              (rtl ? 'انسخ القائمة' : 'Copy list') + '</button>' +
          '</div>' +
          '<p class="form-note" id="sbCopyMsg" aria-live="polite"></p>' +
        '</aside>' +
      '</div>';
  }

  // Only the parts that actually change are repainted, so the search box
  // keeps its text and its cursor while the student taps courses in and out.
  function refresh(prefix){
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var pool = poolFor(prefix);
    var chosen = pickedFor(prefix, pool);
    var chosenSet = {};
    chosen.forEach(function(s){ chosenSet[s] = true; });
    var t = totalsFor(pool, chosen);
    var meter = document.getElementById('sbMeterHost');
    var tray = document.getElementById('sbTray');
    var extra = document.getElementById('sbExtra');
    if(meter) meter.innerHTML = meterHtml(t, rtl);
    if(tray) tray.innerHTML = trayHtml(prefix, pool, chosen, t, rtl);
    if(extra) extra.innerHTML = breakdownHtml(t, rtl) + warningsHtml(t, rtl);
    document.querySelectorAll('#sbRows [data-sb-slug]').forEach(function(el){
      var on = !!chosenSet[el.getAttribute('data-sb-slug')];
      el.classList.toggle('sb-row-on', on);
      el.setAttribute('aria-pressed', String(on));
      var tick = el.querySelector('.sb-row-tick');
      if(tick) tick.textContent = on ? '✓' : '＋';
    });
    bindTray(prefix);
  }

  function toggle(prefix, slug){
    var pool = poolFor(prefix);
    var chosen = pickedFor(prefix, pool);
    var at = chosen.indexOf(slug);
    if(at === -1) chosen.push(slug); else chosen.splice(at, 1);
    setPicked(prefix, chosen);
    refresh(prefix);
  }

  var stickObserver = null;
  function bindStickyMeter(){
    if(stickObserver){ stickObserver.disconnect(); stickObserver = null; }
    var sentinel = document.getElementById('sbStickSentinel');
    var host = document.getElementById('sbMeterHost');
    if(!sentinel || !host || typeof window.IntersectionObserver !== "function") return;
    var scroller = host.closest('.modal-body') || null;
    stickObserver = new window.IntersectionObserver(function(entries){
      var meterEl = host.querySelector('.sb-meter');
      if(!meterEl) return;
      meterEl.classList.toggle('sb-meter-stuck', !entries[0].isIntersecting);
    }, { root: scroller, threshold: 0 });
    stickObserver.observe(sentinel);
  }

  function bindTray(prefix){
    document.querySelectorAll('[data-sb-remove]').forEach(function(btn){
      if(btn.__sbBound) return;
      btn.__sbBound = true;
      btn.addEventListener('click', function(){ toggle(prefix, btn.getAttribute('data-sb-remove')); });
    });
  }

  function bindBody(prefix){
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var rows = document.getElementById('sbRows');
    if(rows){
      rows.addEventListener('click', function(e){
        var btn = e.target.closest ? e.target.closest('[data-sb-slug]') : null;
        if(btn) toggle(prefix, btn.getAttribute('data-sb-slug'));
      });
    }
    var box = document.getElementById('sbSearch');
    if(box){
      box.addEventListener('input', function(){
        search = box.value;
        var pool = poolFor(prefix);
        var chosenSet = {};
        pickedFor(prefix, pool).forEach(function(s){ chosenSet[s] = true; });
        if(rows) rows.innerHTML = poolRowsHtml(prefix, pool, chosenSet, rtl);
      });
    }
    var reset = document.getElementById('sbReset');
    if(reset){
      reset.addEventListener('click', function(){
        setPicked(prefix, recommend(prefix).chosen.map(function(c){ return c.slug; }));
        refresh(prefix);
      });
    }
    var clear = document.getElementById('sbClear');
    if(clear){
      clear.addEventListener('click', function(){
        setPicked(prefix, []);
        refresh(prefix);
      });
    }
    var copy = document.getElementById('sbCopy');
    if(copy){
      copy.addEventListener('click', function(){
        var pool = poolFor(prefix);
        var chosen = pickedFor(prefix, pool);
        var t = totalsFor(pool, chosen);
        var text = chosen.map(function(s){
          var c = t.index[s];
          return '• ' + courseName(prefix, s, rtl) + (c.num ? ' (' + c.num + ')' : '') + ' — ' + c.cr + 'H';
        }).join('\n') + '\n= ' + t.cr + 'H';
        var msg = document.getElementById('sbCopyMsg');
        var ok = function(){ if(msg) msg.textContent = rtl ? 'انتسخت ✓' : 'Copied ✓'; };
        var no = function(){ if(msg) msg.textContent = rtl ? 'ما قدرت أنسخ — علّم النص وانسخه يدويًا.' : 'Could not copy — select the text and copy it manually.'; };
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(text).then(ok, no);
        } else { no(); }
      });
    }
    bindTray(prefix);
  }

  function open(prefix){
    var body = document.getElementById('advisorModalBody');
    var overlay = document.getElementById('advisorModalOverlay');
    if(!body || !overlay) return;
    openPrefix = prefix;
    search = '';
    // The dialog follows the plan's language, not the document's — an
    // Arabic plan opened from an English shell still reads right-to-left.
    body.setAttribute('dir', (window.__isRtl && window.__isRtl(prefix)) ? 'rtl' : 'ltr');
    body.innerHTML = render(prefix);
    overlay.classList.add('open');
    bindBody(prefix);
    bindStickyMeter();
  }

  function bind(){
    var overlay = document.getElementById('advisorModalOverlay');
    var closeBtn = document.getElementById('advisorModalClose');
    if(!overlay) return;
    var close = function(){ overlay.classList.remove('open'); };
    if(closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    // Escape works on the audit and course modals, so a keyboard user
    // reasonably expects it here too. Guarded on .open so it stays inert.
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    var card = overlay.querySelector('.modal-card');
    if(card) card.addEventListener('click', function(e){ e.stopPropagation(); });
  }
  if(document.readyState === 'complete'){ bind(); }
  else { window.addEventListener('load', bind); }

  window.AAUP_ADVISOR = {
    open: open, recommend: recommend,
    // The suggestions also render inline under "You are here" on the plan
    // (js/78-you-are-here.js), which needs the same one-line argument the
    // tray puts under each row rather than inventing a second wording.
    reason: reasonFor, caution: cautionFor, name: courseName,
    // For the dashboard and anything else that wants what the student
    // actually picked rather than what the app suggested.
    picked: function(prefix){ return pickedFor(prefix, poolFor(prefix)); },
    currentPrefix: function(){ return openPrefix; }
  };
})();
