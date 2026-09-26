// ==========================
// WHEN DO I GRADUATE? — a dashboard card under the three stat tiles.
//
// Two different things can be the reason a degree takes as long as it
// does: not enough hours per semester, or a prerequisite chain that is
// simply that many semesters deep no matter how many hours you carry.
// Dragging the load slider only moves the first one. This card computes
// both and says out loud which one is actually deciding the date —
// "Ethics in AI → Graduation Project is 4 terms deep whatever load you
// carry" is not a guess, it is the longest remaining path through the
// plan's own prerequisite graph.
//
// The calendar date is honestly an ESTIMATE: this app has no idea what
// term you actually enrolled in, so it counts your own finished semesters
// against the plan's structure to find where "now" sits, then projects
// forward assuming an ordinary Fall/Spring cadence starting today. Said so
// on screen, not implied.
// ==========================
(function(){
  'use strict';

  var LOAD_KEY = 'aaup_gradLoad';
  var DEFAULT_LOAD = 15;

  function loadFor(prefix){
    try{
      var v = parseInt(localStorage.getItem(LOAD_KEY + '_' + prefix), 10);
      return (v >= 9 && v <= 21) ? v : DEFAULT_LOAD;
    }catch(e){ return DEFAULT_LOAD; }
  }
  function saveLoad(prefix, v){
    try{ localStorage.setItem(LOAD_KEY + '_' + prefix, String(v)); }catch(e){}
  }

  function esc(s){
    var v = String(s == null ? '' : s);
    return window.__cleanText ? window.__cleanText(v) : (window.__escapeHtml ? window.__escapeHtml(v) : v);
  }

  // ---- chain depth: the longest remaining path through the prereq graph -
  // depth 0 = open right now. Everything else is one more than the deepest
  // not-yet-done prerequisite it is actually still waiting on.
  function chainDepths(prefix){
    var data = window.__PLAN_DATA[prefix] || {};
    var needsMap = data.needsMap || {};
    var progress = window.__getProgress ? window.__getProgress() : {};
    var page = document.getElementById('page-' + prefix);
    if(!page) return { depths: {}, notDone: [] };

    var openSet = {};
    (window.__openCourses ? window.__openCourses(prefix) : []).forEach(function(el){
      var parts = window.__splitCourseId(el.id);
      if(parts) openSet[parts.slug] = true;
    });

    var notDone = [];
    var seen = {};
    page.querySelectorAll('.course[id]:not(.course-removed)').forEach(function(el){
      var parts = window.__splitCourseId(el.id);
      if(!parts || seen[parts.slug]) return;
      seen[parts.slug] = true;
      if(!progress[el.id]) notDone.push(parts.slug);
    });

    var memo = {}, visiting = {};
    function depthOf(slug){
      if(memo.hasOwnProperty(slug)) return memo[slug];
      if(openSet[slug]) return (memo[slug] = 0);
      if(visiting[slug]) return 0;   // a cycle in the data — never trust it, never hang on it
      visiting[slug] = true;
      var needs = needsMap[slug] || [];
      var best = 0;
      needs.forEach(function(need){
        if(progress[prefix + '-c-' + need]) return;   // already satisfied, adds nothing
        var d = 1 + depthOf(need);
        if(d > best) best = d;
      });
      visiting[slug] = false;
      return (memo[slug] = best);
    }
    var depths = {};
    notDone.forEach(function(slug){ depths[slug] = depthOf(slug); });
    return { depths: depths, notDone: notDone };
  }

  function bottleneckChain(prefix, depths){
    var data = window.__PLAN_DATA[prefix] || {};
    var needsMap = data.needsMap || {};
    var info = data.courseInfo || {};
    var progress = window.__getProgress ? window.__getProgress() : {};
    var deepestSlug = null, maxD = -1;
    Object.keys(depths).forEach(function(s){ if(depths[s] > maxD){ maxD = depths[s]; deepestSlug = s; } });
    if(!deepestSlug || maxD <= 0) return { depth: maxD, names: [] };

    // Walk backward from the deepest course through whichever not-done need
    // actually carried its depth, to name the chain that explains the number.
    var chain = [deepestSlug];
    var cur = deepestSlug, guard = 0;
    while(guard++ < 40){
      var needs = (needsMap[cur] || []).filter(function(n){ return !progress[prefix + '-c-' + n]; });
      var next = null, bestD = -1;
      needs.forEach(function(n){
        var d = depths.hasOwnProperty(n) ? depths[n] : 0;
        if(d > bestD){ bestD = d; next = n; }
      });
      if(!next || bestD < 0) break;
      chain.push(next);
      cur = next;
      if(bestD === 0) break;
    }
    chain.reverse();   // now earliest-first, deepest course last
    var names = chain.map(function(s){
      var meta = info[s];
      return meta ? meta.name : s;
    });
    return { depth: maxD, names: names };
  }

  // ---- an honest calendar guess -------------------------------------------
  // Not derived from any real enrollment date (this app doesn't have one) —
  // just "assume a normal Fall/Spring pace starting from today."
  function currentTerm(){
    var d = new Date(), m = d.getMonth();
    if(m >= 8) return { term: 'Fall', year: d.getFullYear() };
    if(m <= 5) return { term: 'Spring', year: d.getFullYear() };
    return { term: 'Fall', year: d.getFullYear() };   // Jul/Aug — the upcoming Fall is the honest anchor
  }
  function stepForward(term, n){
    var t = term.term, y = term.year;
    for(var i = 0; i < n; i++){
      if(t === 'Fall'){ t = 'Spring'; y += 1; }
      else { t = 'Fall'; }
    }
    return { term: t, year: y };
  }
  function termLabel(t, rtl){
    var name = rtl ? (t.term === 'Fall' ? 'الخريف' : 'الربيع') : t.term;
    return name + ' ' + t.year;
  }

  var TX = {
    title: { en: 'When do I graduate?', ar: 'متى أتخرّج؟' },
    // The paragraph that used to open this card explained that two things
    // decide the date — your load, and how long the prerequisite chain takes
    // — and that the longer of the two wins. The slider under the headline
    // demonstrates exactly that in one drag, and the note under it already
    // names WHICH of the two is setting this particular date. So the general
    // statement is gone and the specific one stayed.
    load: { en: 'Load per semester', ar: 'الحمل لكل فصل' },
    finish: { en: 'Projected finish', ar: 'الإنهاء المتوقع' },
    sems: { en: '{n} more semester', ar: '{n} فصل إضافي' },
    semsPl: { en: '{n} more semesters', ar: '{n} فصول إضافية' },
    hereNow: { en: 'you are here', ar: 'أنت هنا' },
    caveat: { en: 'An estimate: this app does not know your real enrollment date — it assumes a normal Fall/Spring pace starting today.',
              ar: 'تقدير: التطبيق ما بيعرف تاريخ تسجيلك الحقيقي — بيفترض إيقاع خريف/ربيع عادي ابتداءً من اليوم.' },
    bound: { en: 'Prerequisites, not your load: {chain} takes {n} semesters on its own.',
             ar: 'المتطلبات، مش حملك: {chain} لحاله بياخذ {n} فصول.' },
    pace: { en: 'Your load sets this date — above {load}H you finish sooner.',
            ar: 'حملك هو اللي يحدد التاريخ — فوق {load} ساعة بتخلص أبكر.' },
    done: { en: 'Nothing left to plan for — every course is done.', ar: 'ما بقي إشي تخطط له — كل المساقات منجزة.' },
    years1: { en: '(≈1 year)', ar: '(≈سنة)' },
    yearsN: { en: '(≈{n} years)', ar: '(≈{n} سنوات)' },
    saveImg: { en: 'Save as image', ar: 'احفظ كصورة' },
    youFinish: { en: 'You finish in {term}', ar: 'بتتخرّج {term}' },
    atLoad: { en: 'at {load} hours a semester', ar: 'على {load} ساعة بالفصل' },
    how: { en: 'How is this worked out?', ar: 'كيف انحسبت؟' }
  };
  function t(k, r){ return r ? TX[k].ar : TX[k].en; }

  // "8 more semesters" takes a beat of mental math to land as "4 years" —
  // spelling it out is what actually answers the caption's own question.
  // Half-year rounding (7 semesters -> "3.5 years") rather than rounding
  // away the odd semester, which would quietly disagree with the number
  // right next to it.
  function yearsHint(semesters, rtl){
    if(semesters <= 0) return '';
    var years = semesters / 2;
    if(years === 1) return t('years1', rtl);
    var label = (years % 1 === 0) ? String(years) : years.toFixed(1);
    return t('yearsN', rtl).replace('{n}', label);
  }

  // The projection on its own, so the home screen can show the same answer
  // this card gives without drawing the card. null when the plan is not on
  // the page yet or has nothing left to take.
  function project(prefix){
    if(!document.getElementById('page-' + prefix)) return null;
    var cd = chainDepths(prefix);
    if(!cd.notDone.length) return null;
    var bottleneck = bottleneckChain(prefix, cd.depths);
    var load = loadFor(prefix);

    var rows = window.AAUP_AUDIT ? window.AAUP_AUDIT.computeAudit(prefix) : [];
    var totalCr = 0, doneCr = 0;
    rows.forEach(function(r){ totalCr += r.total; doneCr += r.completed; });
    var remainingCr = Math.max(0, totalCr - doneCr);

    // hoursSemesters counts terms starting with the NEXT one you register
    // for — "5 more semesters" means five terms beginning now, which is how
    // an advisor would actually answer the question. Chain depth is on a
    // different clock: depth 0 means "open right now", i.e. doable in that
    // very first upcoming term, so it needs the +1 to land in the same
    // "how many terms from today" units hoursSemesters is already in —
    // without it, a 1-deep chain would wrongly read as needing 0 more terms.
    var hoursSemesters = remainingCr > 0 ? Math.ceil(remainingCr / load) : 0;
    var chainSemesters = cd.notDone.length ? bottleneck.depth + 1 : 0;
    var semesters = Math.max(chainSemesters, hoursSemesters);
    var chainBinding = chainSemesters > hoursSemesters;

    var finish = stepForward(currentTerm(), semesters);
    return { bottleneck: bottleneck, load: load, semesters: semesters, chainBinding: chainBinding, finish: finish };
  }

  function estimate(prefix, rtl){
    var pr = project(prefix);
    if(!pr) return null;
    return {
      term: termLabel(pr.finish, rtl),
      left: pr.semesters === 1 ? t('sems', rtl).replace('{n}', 1) : t('semsPl', rtl).replace('{n}', pr.semesters),
      semesters: pr.semesters
    };
  }

  // Dragging the slider redraws the card; the working stays open while it does.
  var howOpen = false;

  function render(prefix, hostId){
    var host = document.getElementById(hostId);
    if(!host) return;
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var page = document.getElementById('page-' + prefix);
    if(!page){ host.innerHTML = ''; return; }

    var pr = project(prefix);
    if(!pr){
      host.innerHTML = '<p class="grad-msg">' + t('done', rtl) + '</p>';
      return;
    }
    var bottleneck = pr.bottleneck, load = pr.load, semesters = pr.semesters,
        chainBinding = pr.chainBinding, finish = pr.finish;

    // Index 0 is "now"; index `semesters` is the real finish. Six dots is
    // the most that fit — a long remaining chain shows the first five steps
    // and stops there rather than drawing a dot that lands PAST the real
    // finish and calling that one "the end" instead.
    var dotsHtml = '';
    var DOT_COUNT = Math.min(6, semesters + 1);
    for(var i = 0; i < DOT_COUNT; i++){
      var termAt = i === 0 ? currentTerm() : stepForward(currentTerm(), i);
      var isNow = i === 0, isEnd = i === semesters;
      var cls = isNow ? ' grad-dot-now' : (isEnd ? ' grad-dot-end' : '');
      // Only the two ends are labelled. Six "Spring 2027 / Fall 2027 /
      // Spring 2028…" labels across a phone's width ran into one another
      // and read as a single word; the terms between here and the finish
      // are the regular Fall/Spring sequence the two ends already imply.
      var label = isNow ? t('hereNow', rtl) : (isEnd ? termLabel(termAt, rtl) : '');
      dotsHtml += '<span class="grad-dot' + cls + '">' +
        '<span class="grad-dot-mark"></span>' +
        '<span class="grad-dot-label">' + label + '</span>' +
        '</span>';
    }

    // Prerequisite leads to dependent, in reading order — "Ethics in AI ->
    // Graduation Project", not the breadcrumb-style "<-" the prereq-graph
    // walkthrough uses elsewhere for the opposite direction (root cause
    // first). bottleneck.names is already earliest-first after the reverse
    // above, so slicing the last two and joining forward is correct as-is.
    var arrow = rtl ? ' ← ' : ' → ';
    var chainSlice = bottleneck.names.slice(-2).map(esc);
    if(rtl) chainSlice = chainSlice.slice().reverse();
    var chainNames = chainSlice.join(arrow);

    // The answer first, then the one control that changes it. The old order
    // put a paragraph and a slider above the date the card exists to give.
    // Rule 2: the answer, then the working one tap away. The date and the
    // load it assumes are the answer; the slider, the steps and the caveats
    // are how it was worked out, folded underneath.
    host.innerHTML =
      '<div class="grad-answer">' +
        '<b>' + t('youFinish', rtl).replace('{term}', termLabel(finish, rtl)) + '</b>' +
        '<span>' + t('atLoad', rtl).replace('{load}', load) + ' · ' +
          (semesters === 1 ? t('sems', rtl).replace('{n}', semesters) : t('semsPl', rtl).replace('{n}', semesters)) +
          ' <span class="grad-years-hint">' + yearsHint(semesters, rtl) + '</span></span>' +
      '</div>' +
      '<details class="grad-how" id="' + hostId + 'How"' + (howOpen ? ' open' : '') + '><summary>' + t('how', rtl) + '</summary>' +
      '<div class="grad-head">' +
        '<span class="grad-load-label">' + t('load', rtl) + '</span>' +
        '<span class="grad-load-val" id="' + hostId + 'LoadVal">' + load + 'H</span>' +
      '</div>' +
      '<input type="range" id="' + hostId + 'Slider" class="grad-slider" min="9" max="21" step="1" value="' + load + '">' +
      '<div class="grad-dots">' + dotsHtml + '</div>' +
      (chainBinding
        ? '<p class="grad-note grad-note-bound">' + t('bound', rtl)
            .replace('{load}', load).replace('{term}', termLabel(finish, rtl))
            .replace('{chain}', chainNames).replace('{n}', bottleneck.depth) + '</p>'
        : (semesters > 0
            ? '<p class="grad-note grad-note-pace">' + t('pace', rtl).replace('{load}', load) + '</p>'
            : '')) +
      '<p class="grad-caveat">' + t('caveat', rtl) + '</p>' +
      '</details>' +
      '<button type="button" class="grad-save-img" id="' + hostId + 'SaveImg">' + window.AAUP_ICONS.preview('download', 14) + t('saveImg', rtl) + '</button>';

    var how = document.getElementById(hostId + 'How');
    if(how) how.addEventListener('toggle', function(){ howOpen = how.open; });
    var slider = document.getElementById(hostId + 'Slider');
    if(slider){
      slider.addEventListener('input', function(){
        saveLoad(prefix, parseInt(slider.value, 10));
        render(prefix, hostId);
      });
    }
    var saveBtn = document.getElementById(hostId + 'SaveImg');
    if(saveBtn){
      saveBtn.addEventListener('click', function(){
        var page = document.getElementById('page-' + prefix);
        var nameEl = page && page.querySelector('.title-block .en');
        var planTitle = nameEl ? nameEl.textContent.trim() : prefix;
        window.__downloadCardImage({
          title: t('title', rtl),
          subtitle: planTitle,
          rows: [
            { label: t('finish', rtl), value: termLabel(finish, rtl), accent: true },
            { label: rtl ? 'الفصول المتبقية' : 'Semesters left', value: semesters + ' ' + (rtl ? '' : yearsHint(semesters, rtl)) },
            { label: t('load', rtl), value: load + 'H' }
          ],
          filename: 'graduation-' + prefix
        });
      });
    }
  }

  // Change Major measures "how much longer would this take" with the same
  // load this estimate runs on, rather than picking a second number.
  window.AAUP_GRADUATION = { render: render, estimate: estimate, loadFor: loadFor, title: function(rtl){ return t('title', rtl); } };
})();
