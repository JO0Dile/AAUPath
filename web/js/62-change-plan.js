// ==========================
// CHANGE MAJOR — what actually happens to your progress if you switch.
//
// "Switch Plan" already existed and did exactly one thing: throw you back at
// the picker. The question a student actually has before switching is not
// "where is the list" — it is "do I lose everything?". So this screen answers
// that first, for every plan the app holds, before anything changes:
//
//   - how many of your finished courses exist in that plan too (matched on
//     the catalogue number, which is what makes a course the same course)
//   - how many credit hours that is, and how far into that degree it puts you
//   - which finished courses would NOT carry, named, so the number is
//     checkable rather than trusted
//   - how much of that plan you would still have left
//
// Then, if you switch, it can tick those matching courses off in the new plan
// and bring their grades with them — the "adding courses" half of the ask.
// Nothing is deleted either way: your old plan's progress stays exactly where
// it is, so switching back costs nothing.
//
// Everything here is computed from data already on the device (the plans the
// catalogue loaded, plus your own progress and grades). No network, and no
// claim about what the university's own transfer rules are — the screen says
// plainly that the registrar decides, not this app.
// ==========================
(function(){
  'use strict';

  var TX = {
    title:    { en: 'Change Major', ar: 'تغيير التخصص' },
    lead:     { en: 'See what happens to your progress before you switch. Nothing changes until you press the button at the end — and your current plan is kept either way, so you can switch back.',
                ar: 'شوف شو بصير بتقدّمك قبل ما تبدّل. ما بتغيّر إشي إلا لما تضغط الزر بالآخر — وخطتك الحالية بتضل محفوظة، فبتقدر ترجعلها.' },
    // Two sentences saying one thing, next to a screen whose own numbers
    // already frame it as an estimate. Same claim, half the words.
    caveat:   { en: 'Matched by course number. The registrar decides.',
                ar: 'المطابقة حسب رقم المساق. القرار للتسجيل.' },
    current:  { en: 'You are on', ar: 'خطتك الحالية' },
    pick:     { en: 'Switch to', ar: 'التبديل إلى' },
    transfers:{ en: 'carries over', ar: 'بينتقل معك' },
    noPlan:   { en: 'no published plan yet', ar: 'ما في خطة منشورة بعد' },
    ofYours:  { en: 'of your {n}H', ar: 'من أصل {n} ساعة' },
    wouldBe:  { en: 'You would be', ar: 'رح تكون' },
    doneOf:   { en: 'done', ar: 'مُنجز' },
    nowAt:    { en: 'now {n}%', ar: 'حاليًا {n}٪' },
    left:     { en: 'still to take', ar: 'باقي عليك' },
    lost:     { en: 'you would lose', ar: 'رح تخسرها' },
    semester: { en: 'semester', ar: 'فصل' },
    semesters:{ en: 'semesters', ar: 'فصول' },
    atLoad:   { en: 'at {n}H a term', ar: 'على {n} ساعة بالفصل' },
    notDone:  { en: 'courses there you have not done', ar: 'مساق هناك ما أنجزته' },
    gap:      { en: 'That plan is published as {official}H, but the course list recorded here adds up to {sum}H — most of the difference is an elective pool you only take part of. Hours left are counted off the published total.',
                ar: 'هذه الخطة منشورة بـ {official} ساعة، بينما مجموع المساقات المسجّلة هنا {sum} ساعة — أغلب الفرق مجموعة اختيارية بتاخد منها جزء فقط. الساعات المتبقية محسوبة من المجموع المنشور.' },
    carries:  { en: 'Carries over', ar: 'بينتقل' },
    doesnt:   { en: 'Does not carry', ar: 'ما بينتقل' },
    notThere: { en: 'not in that plan', ar: 'مش موجود بهذه الخطة' },
    // Not "does not carry" — the app never got far enough to know. It is a
    // question for the registrar, and that is what the group is called.
    askReg:   { en: 'Ask the registrar', ar: 'اسأل التسجيل' },
    noNumber: { en: 'no course number to match on',
                ar: 'ما إله رقم مساق للمطابقة' },
    carryBox: { en: 'Tick these courses off in the new plan (and bring their grades)',
                ar: 'علّم هالمساقات كمُنجزة بالخطة الجديدة (مع علاماتها)' },
    go:       { en: 'Switch to this plan', ar: 'بدّل لهذه الخطة' },
    back:     { en: '← All majors', ar: '→ كل التخصصات' },
    none:     { en: 'No other plan on this device has its courses loaded yet.',
                ar: 'ما في خطة ثانية على الجهاز محمّلة مساقاتها بعد.' },
    nothingDone: { en: 'Nothing marked as done yet, so nothing carries over.',
                ar: 'ما علّمت أي مساق كمُنجز، فما في إشي ينتقل — بس بتقدر تشوف حجم كل خطة.' },
    switched: { en: 'Switched. {n} course(s) ticked off in your new plan.',
                ar: 'تم التبديل. {n} مساق معلّم كمُنجز بخطتك الجديدة.' }
  };
  function t(k, r){ return r ? TX[k].ar : TX[k].en; }
  // Plan JSON can hold names that are already HTML-encoded ("Elementary
  // Probability &amp; Statistics"). __cleanText decodes once and re-escapes
  // once, so the ampersand shows as an ampersand and injection is still
  // impossible; plain __escapeHtml would print the entity itself.
  function esc(s){
    var v = String(s == null ? '' : s);
    if(window.__cleanText) return window.__cleanText(v);
    return window.__escapeHtml ? window.__escapeHtml(v) : v;
  }

  var viewing = null;   // the plan id whose detail is on screen, or null

  function plans(){
    return (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()) || {};
  }
  function planName(p, rtl){
    var parts = window.AAUP_IMPORTED && window.AAUP_IMPORTED.nameParts
      ? window.AAUP_IMPORTED.nameParts(rtl ? (p.majorName || {}).ar : (p.majorName || {}).en) : null;
    var name = parts ? parts.big : '';
    if(!name && p.majorName && p.majorName.en){
      var en = window.AAUP_IMPORTED.nameParts(p.majorName.en);
      name = en.big;
    }
    return name || p.id;
  }
  function collegeName(p, rtl){
    var c = p.college || {};
    return (rtl ? c.ar : c.en) || c.en || '';
  }

  // The number that makes two courses the same course. Elective slots carry
  // no real one, and must never be matched on their slug ("uni-elective-1"
  // means something different in every plan).
  function numberOf(c){
    var n = String(c.courseNumber || c.id || '').trim();
    return /^[0-9]{4,}$/.test(n) ? n : '';
  }
  function creditsOf(c){ return parseFloat(c.creditHours) || 0; }

  // Total hours a plan is worth: its published figure when it has one,
  // otherwise the sum of its courses counted once per catalogue number
  // (a lecture and its lab share one, and are one registration).
  function courseSum(p){
    var seen = {}, sum = 0;
    (p.courses || []).forEach(function(c){
      var n = numberOf(c);
      var key = n || ('slug:' + c.id);
      if(seen[key]) return;
      seen[key] = true;
      sum += creditsOf(c);
    });
    return sum;
  }
  function planHours(p){
    var official = parseFloat(p.degreeHours);
    if(official && isFinite(official) && official > 0) return official;
    return courseSum(p);
  }

  function progressOf(){ return (window.__getProgress && window.__getProgress()) || {}; }

  // What the student has finished in the plan they are on now.
  function doneIn(planId){
    var p = plans()[planId];
    if(!p) return [];
    var progress = progressOf();
    var seen = {}, out = [];
    (p.courses || []).forEach(function(c){
      if(!progress[planId + '-c-' + c.id]) return;
      var n = numberOf(c);
      var key = n || ('slug:' + c.id);
      if(seen[key]) return;      // lecture+lab counted once
      seen[key] = true;
      out.push({ slug: c.id, num: n, name: c.name || c.ar || c.id, ar: c.ar || '', cr: creditsOf(c) });
    });
    return out;
  }

  function compare(fromId, toId){
    var to = plans()[toId] || {};
    var index = {};
    (to.courses || []).forEach(function(c){
      var n = numberOf(c);
      if(n && !index[n]) index[n] = c;
    });
    var done = doneIn(fromId);
    // Three outcomes, not two. A course with a catalogue number that the
    // target plan does not list genuinely does not carry — that is a match
    // that was attempted and failed. An elective SLOT has no catalogue
    // number to attempt a match with ("Free Elective (1)" means something
    // different in every plan), so filing it under "Does not carry" claimed
    // a result the app never obtained. Those go in their own group, and out
    // of the hours counted as lost.
    var keeps = [], loses = [], unmatchable = [];
    done.forEach(function(d){
      if(!d.num){ unmatchable.push(d); return; }
      var match = index[d.num];
      if(match) keeps.push({ from: d, to: match });
      else loses.push(d);
    });
    var keptCr = keeps.reduce(function(s, k){ return s + creditsOf(k.to); }, 0);
    var doneCr = done.reduce(function(s, d){ return s + d.cr; }, 0);
    var total = planHours(to);
    var matchedNums = {};
    keeps.forEach(function(k){ matchedNums[numberOf(k.to)] = true; });
    var stillSeen = {}, stillCount = 0;
    (to.courses || []).forEach(function(c){
      var n = numberOf(c);
      var key = n || ('slug:' + c.id);
      if(n && matchedNums[n]) return;
      if(stillSeen[key]) return;
      stillSeen[key] = true;
      stillCount++;
    });
    // Hours left come off the DEGREE total, not off the course list. Several
    // plans list an elective pool far bigger than the number of electives a
    // student actually takes — AI & Medical Sciences lists 153H of courses
    // against a published 129H degree — so adding up every unmatched course
    // would tell a student they owe 24 hours nobody has to take.
    var stillCr = Math.max(0, Math.round((total - keptCr) * 10) / 10);
    // Hours you have passed that this plan has no course for. The list was
    // already here under "Does not carry"; the figure a student is actually
    // weighing was not.
    var lostCr = loses.reduce(function(sum, d){ return sum + (d.cr || 0); }, 0);
    var unknownCr = unmatchable.reduce(function(sum, d){ return sum + (d.cr || 0); }, 0);
    return {
      keeps: keeps, loses: loses, unmatchable: unmatchable,
      unknownCr: Math.round(unknownCr * 10) / 10,
      keptCr: keptCr, doneCr: doneCr, total: total, lostCr: Math.round(lostCr * 10) / 10,
      pct: total ? Math.round((keptCr / total) * 100) : 0,
      stillCount: stillCount, stillCr: stillCr,
      official: !!(parseFloat(to.degreeHours) > 0), listSum: courseSum(to)
    };
  }

  // What moving costs in time, at the same course load the graduation
  // estimate on the dashboard is already using — not a new assumption, and
  // the same arithmetic both plans are measured with. Whole semesters,
  // because that is the unit a university registers in.
  function extraSemesters(fromId, toStillCr){
    var load = (window.AAUP_GRADUATION && window.AAUP_GRADUATION.loadFor)
      ? window.AAUP_GRADUATION.loadFor(fromId) : 15;
    if(!(load > 0)) return null;
    var from = plans()[fromId] || {};
    var fromTotal = planHours(from);
    var fromDone = doneIn(fromId).reduce(function(sum, d){ return sum + d.cr; }, 0);
    var fromLeft = Math.max(0, fromTotal - fromDone);
    return Math.ceil(toStillCr / load) - Math.ceil(fromLeft / load);
  }

  function currentPct(fromId){
    var total = planHours(plans()[fromId] || {});
    var doneCr = doneIn(fromId).reduce(function(s, d){ return s + d.cr; }, 0);
    return total ? Math.round((doneCr / total) * 100) : 0;
  }

  // ---- the list of majors -------------------------------------------------
  function listHtml(fromId, rtl){
    var all = plans();
    var rows = Object.keys(all).filter(function(id){
      return id !== fromId && (all[id].courses || []).length;
    }).map(function(id){
      return { id: id, plan: all[id], cmp: compare(fromId, id) };
    }).sort(function(a, b){
      if(b.cmp.keptCr !== a.cmp.keptCr) return b.cmp.keptCr - a.cmp.keptCr;
      return planName(a.plan, rtl).localeCompare(planName(b.plan, rtl));
    });

    var empty = Object.keys(all).filter(function(id){
      return id !== fromId && !(all[id].courses || []).length;
    });

    if(!rows.length){
      return '<p class="sb-empty">' + t('none', rtl) + '</p>';
    }
    return '<div class="cp-list">' + rows.map(function(r){
      var maxCr = rows[0].cmp.keptCr || 1;
      var bar = Math.max(3, Math.round((r.cmp.keptCr / maxCr) * 100));
      return '<button type="button" class="cp-row" data-cp-plan="' + esc(r.id) + '">' +
        '<span class="cp-row-icon">' + window.AAUP_ICONS.markup(r.plan, { size: 22 }) + '</span>' +
        '<span class="cp-row-main">' +
          '<span class="cp-row-name">' + esc(planName(r.plan, rtl)) + '</span>' +
          '<span class="cp-row-col">' + esc(collegeName(r.plan, rtl)) + '</span>' +
          '<span class="cp-bar"><span class="cp-bar-fill" style="width:' + bar + '%;"></span></span>' +
        '</span>' +
        '<span class="cp-row-num"><b>' + window.__hrs(r.cmp.keptCr) + '</b><small>' + t('transfers', rtl) + '</small></span>' +
        '</button>';
    }).join('') + '</div>' +
    (empty.length ? '<p class="form-note">' + empty.length + ' ' +
      (rtl ? 'تخصص ثاني ' : 'other major(s) — ') + t('noPlan', rtl) + '.</p>' : '');
  }

  function courseLine(name, cr, note, rtl){
    return '<li><span>' + esc(name) + '</span><span class="cp-li-cr">' + window.__hrs(cr) + '</span>' +
      (note ? '<span class="cp-li-note">' + esc(note) + '</span>' : '') + '</li>';
  }

  function detailHtml(fromId, toId, rtl){
    var all = plans();
    var to = all[toId];
    var c = compare(fromId, toId);
    var nowPct = currentPct(fromId);
    var extra = extraSemesters(fromId, c.stillCr);
    var load = (window.AAUP_GRADUATION && window.AAUP_GRADUATION.loadFor)
      ? window.AAUP_GRADUATION.loadFor(fromId) : 15;

    return '<button type="button" class="cp-back" id="cpBack">' + t('back', rtl) + '</button>' +
      '<div class="cp-head">' +
        '<span class="cp-head-icon">' + window.AAUP_ICONS.markup(to, { size: 30 }) + '</span>' +
        '<div><h3>' + esc(planName(to, rtl)) + '</h3>' +
        '<p>' + esc(collegeName(to, rtl)) + ' · ' + window.__hrs(c.total) + '</p></div>' +
      '</div>' +
      '<div class="cp-nums">' +
        '<div class="cp-num"><b>' + window.__hrs(c.keptCr) + '</b><span>' + t('transfers', rtl) + ' · ' +
          t('ofYours', rtl).replace('{n}', c.doneCr) + '</span></div>' +
        '<div class="cp-num"><b>' + window.__hrs(c.lostCr) + '</b><span>' + t('lost', rtl) + '</span></div>' +
        '<div class="cp-num"><b>' + c.pct + '%</b><span>' + t('wouldBe', rtl) + ' ' + t('doneOf', rtl) +
          ' · ' + t('nowAt', rtl).replace('{n}', nowPct) + '</span></div>' +
        '<div class="cp-num"><b>' + window.__hrs(c.stillCr) + '</b><span>' + t('left', rtl) + ' · ' +
          c.stillCount + ' ' + t('notDone', rtl) + '</span></div>' +
        (extra === null ? '' :
          '<div class="cp-num"><b>' + (extra > 0 ? '+' : '') + extra + '</b><span>' +
            (extra === 1 || extra === -1 ? t('semester', rtl) : t('semesters', rtl)) + ' · ' +
            t('atLoad', rtl).replace('{n}', load) + '</span></div>') +
      '</div>' +
      // Same honesty the roadmap already applies: when our course list does
      // not add up to the published degree, say so instead of quietly
      // presenting one of the two numbers as the truth.
      (c.official && Math.abs(c.listSum - c.total) >= 0.5
        ? '<p class="form-note">' + t('gap', rtl)
            .replace('{official}', c.total).replace('{sum}', Math.round(c.listSum)) + '</p>'
        : '') +
      (c.keeps.length ? '<details class="cp-det" open><summary>' + window.AAUP_ICONS.preview('check', 14) + t('carries', rtl) + ' (' + c.keeps.length + ')</summary>' +
        '<ul class="cp-ul">' + c.keeps.map(function(k){
          return courseLine(rtl ? (k.to.ar || k.to.name) : (k.to.name || k.to.ar), creditsOf(k.to), '', rtl);
        }).join('') + '</ul></details>' : '') +
      (c.loses.length ? '<details class="cp-det"><summary>' + window.AAUP_ICONS.preview('close', 14) + t('doesnt', rtl) + ' (' + c.loses.length + ')</summary>' +
        '<ul class="cp-ul cp-ul-lose">' + c.loses.map(function(d){
          return courseLine(rtl ? (d.ar || d.name) : d.name, d.cr, t('notThere', rtl), rtl);
        }).join('') + '</ul></details>' : '') +
      (c.unmatchable.length ? '<details class="cp-det cp-det-ask"><summary>' + window.AAUP_ICONS.preview('help', 14) + t('askReg', rtl) + ' (' + c.unmatchable.length + ')</summary>' +
        '<ul class="cp-ul cp-ul-ask">' + c.unmatchable.map(function(d){
          return courseLine(rtl ? (d.ar || d.name) : d.name, d.cr, t('noNumber', rtl), rtl);
        }).join('') + '</ul></details>' : '') +
      '<label class="cp-carry"><input type="checkbox" id="cpCarry" checked> ' +
        t('carryBox', rtl) + '</label>' +
      '<p class="form-note">' + t('caveat', rtl) + '</p>' +
      '<div class="cp-actions">' +
        '<button type="button" class="home-btn cp-go" id="cpGo" data-cp-target="' + esc(toId) + '">' + window.AAUP_ICONS.preview('shuffle', 14) +
          t('go', rtl) + '</button>' +
      '</div>';
  }

  function render(fromId){
    var rtl = window.__isRtl ? window.__isRtl(fromId) : false;
    var body = document.getElementById('changePlanBody');
    if(!body) return;
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    var from = plans()[fromId] || {};
    var head = (window.__backBarHTML ? window.__backBarHTML('', 'changePlanOverlay', rtl) : '') +
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('shuffle', 20) + t('title', rtl) + '</h2>' +
      '<p class="form-note" style="margin-top:0;">' + t('lead', rtl) + '</p>' +
      '<div class="cp-current"><span>' + t('current', rtl) + '</span><b>' +
        esc(planName(from, rtl)) + '</b><span>' + doneIn(fromId).reduce(function(s, d){ return s + d.cr; }, 0) +
        'H ' + (rtl ? 'مُنجز' : 'done') + '</span></div>' +
      (doneIn(fromId).length ? '' : '<p class="form-note">' + t('nothingDone', rtl) + '</p>');

    body.innerHTML = head + '<div id="cpHost">' +
      (viewing ? detailHtml(fromId, viewing, rtl) : listHtml(fromId, rtl)) + '</div>';
    bindBody(fromId, rtl);
  }

  function bindBody(fromId, rtl){
    var host = document.getElementById('cpHost');
    if(!host) return;
    host.querySelectorAll('[data-cp-plan]').forEach(function(btn){
      btn.addEventListener('click', function(){
        viewing = btn.getAttribute('data-cp-plan');
        render(fromId);
        var card = document.querySelector('#changePlanOverlay .modal-body');
        if(card) card.scrollTop = 0;
      });
    });
    var back = document.getElementById('cpBack');
    if(back) back.addEventListener('click', function(){ viewing = null; render(fromId); });
    var go = document.getElementById('cpGo');
    if(go) go.addEventListener('click', function(){
      var toId = go.getAttribute('data-cp-target');
      var carry = document.getElementById('cpCarry');
      switchTo(fromId, toId, !!(carry && carry.checked), rtl);
    });
  }

  // ---- the switch itself --------------------------------------------------
  // Writes the new plan's progress keys and copies the matching grades. The
  // old plan's keys are left untouched on purpose: switching majors in this
  // app must never be the thing that loses a student four years of ticks.
  function carryOver(fromId, toId){
    var c = compare(fromId, toId);
    var progress = progressOf();
    var grades = (window.AAUP_GPA && window.AAUP_GPA.loadGrades && window.AAUP_GPA.loadGrades()) || {};
    var gradesChanged = false;
    var n = 0;
    c.keeps.forEach(function(k){
      var key = toId + '-c-' + k.to.id;
      if(!progress[key]){ progress[key] = true; n++; }
      var oldGrade = grades[fromId + '-c-' + k.from.slug];
      if(oldGrade && !grades[toId + '-c-' + k.to.id]){
        grades[toId + '-c-' + k.to.id] = oldGrade;
        gradesChanged = true;
      }
    });
    if(window.__saveProgress) window.__saveProgress();
    if(gradesChanged && window.AAUP_GPA && window.AAUP_GPA.saveGrades) window.AAUP_GPA.saveGrades(grades);
    return n;
  }

  function switchTo(fromId, toId, carry, rtl){
    var n = carry ? carryOver(fromId, toId) : 0;
    var overlay = document.getElementById('changePlanOverlay');
    if(overlay) overlay.classList.remove('open');
    viewing = null;
    if(window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.selectAndOpen){
      window.AAUP_DASHBOARD.selectAndOpen(toId);
    }
    if(carry && window.__showToast){
      window.__showToast(t('switched', rtl).replace('{n}', n));
    }
  }

  function open(prefix){
    var overlay = document.getElementById('changePlanOverlay');
    if(!overlay) return;
    viewing = null;
    render(prefix);
    overlay.classList.add('open');
  }

  function bind(){
    var overlay = document.getElementById('changePlanOverlay');
    if(!overlay) return;
    var close = function(){ overlay.classList.remove('open'); };
    var closeBtn = document.getElementById('changePlanClose');
    if(closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
    var card = overlay.querySelector('.modal-card');
    if(card) card.addEventListener('click', function(e){ e.stopPropagation(); });
  }
  if(document.readyState === 'complete'){ bind(); }
  else { window.addEventListener('load', bind); }

  window.AAUP_CHANGE_PLAN = { open: open, compare: compare, planHours: planHours };
})();
