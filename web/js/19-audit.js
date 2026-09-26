// ==========================
// DEGREE AUDIT
// ==========================
(function(){
  var CATEGORY_FALLBACK = {
    skills: { en: 'University Req.', ar: 'متطلب جامعي' },
    core:   { en: 'Specialization Req.', ar: 'متطلب تخصص' },
    math:   { en: 'College Req.', ar: 'متطلب كلية' },
    dept:   { en: 'Specialization Elec.', ar: 'اختياري تخصص' },
    eng:    { en: 'University Req.', ar: 'متطلب جامعي' },
    uni:    { en: 'University Elec.', ar: 'اختياري جامعي' },
    free:   { en: 'Free Elec.', ar: 'اختياري حر' }
  };
  var CATEGORY_ORDER = ['skills','core','math','dept','eng','uni','free'];

  // cs's own legend calls the dept category "Specialized elective" instead
  // of "Department elective" — read whatever label this plan's legend
  // already uses instead of hardcoding one label for every plan.
  function labelFor(prefix, cat){
    var chip = document.querySelector('#' + prefix + '-legend .item .chip.' + cat);
    var span = chip && chip.parentElement.querySelector('.i18n');
    if(span && span.dataset){
      return { en: span.dataset.en || span.textContent.trim(), ar: span.dataset.ar || CATEGORY_FALLBACK[cat].ar };
    }
    return CATEGORY_FALLBACK[cat];
  }

  function computeAudit(prefix){
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var progress = window.__getProgress ? window.__getProgress() : {};
    var statuses = window.AAUP_GPA.loadStatuses();
    var grades = window.AAUP_GPA.loadGrades();
    var required = window.__DEPT_REQUIRED ? window.__DEPT_REQUIRED[prefix] : null;
    var page = document.getElementById('page-' + prefix);
    var courses = page ? Array.prototype.slice.call(page.querySelectorAll('.course[id]:not(.course-removed)')) : [];

    var byCat = {};
    CATEGORY_ORDER.forEach(function(c){ byCat[c] = { total: 0, completed: 0, inProgress: 0, planned: 0 }; });

    // Elective credit unit + pool size, same derivation as the My Progress panel.
    var deptCrCounts = {};
    courses.forEach(function(el){
      if(!el.classList.contains('dept')) return;
      var parts = window.__splitCourseId(el.id);
      var meta = parts && info[parts.slug];
      if(!meta) return;
      if(window.__isSupersededByRetake && parts && window.__isSupersededByRetake(prefix, parts.slug)) return;
      var cr0 = parseFloat(meta.cr) || 0;
      deptCrCounts[cr0] = (deptCrCounts[cr0] || 0) + 1;
    });
    var deptCreditUnit = 3, bestCount = 0;
    Object.keys(deptCrCounts).forEach(function(k){
      if(deptCrCounts[k] > bestCount){ bestCount = deptCrCounts[k]; deptCreditUnit = parseFloat(k); }
    });
    // How much the specialization elective pool is actually worth. Three
    // sources, best first:
    //
    //   1. requirementHours.specElec — the university's published figure, on
    //      plans built from a real catalogue plan.
    //   2. DEPT_REQUIRED — the hand-maintained per-plan count.
    //   3. the number of DISTINCT credit-hour values in the pool, a stand-in
    //      for the number of required courses.
    //
    // (3) is the reason this screen and My Path disagreed. It collapses to 1
    // whenever every slot in a pool costs the same, which is the normal case:
    // GIS and Multimedia each draw six 3-hour slots for an 18-hour
    // requirement and were audited as though only 3 hours were owed, 15 hours
    // short of the degree. The comment on DEPT_REQUIRED has always said so;
    // there was simply nothing better to fall back to until now.
    var planReq = (window.__PLAN_DATA[prefix] || {}).requirementHours || {};
    var deptNeededCredits, deptNeededCount;
    if(typeof planReq.specElec === 'number'){
      deptNeededCredits = planReq.specElec;
      deptNeededCount = deptCreditUnit > 0 ? Math.round(deptNeededCredits / deptCreditUnit) : 0;
    } else {
      deptNeededCount = (typeof required === 'number') ? required : Object.keys(deptCrCounts).length;
      deptNeededCredits = deptNeededCount * deptCreditUnit;
    }

    var seenNum = {};
    var catBucket = {};        // display category -> requirement bucket -> hours drawn
    courses.forEach(function(el){
      if(el.classList.contains('dept')) return; // dept handled as a pool, below
      var parts = window.__splitCourseId(el.id);
      if(!parts) return;
      if(window.__isSupersededByRetake && window.__isSupersededByRetake(prefix, parts.slug)) return;
      var meta = info[parts.slug];
      if(!meta) return;
      var pid = window.AAUP_GPA.primaryId(prefix, parts.slug);
      if(pid !== el.id) return;
      // Same "-" placeholder caveat as elsewhere: never dedupe generic
      // elective slots on it, only on their own unique slug.
      var dedupeKey = (meta.num && meta.num !== '-') ? meta.num : parts.slug;
      if(seenNum[dedupeKey]) return;
      seenNum[dedupeKey] = true;

      var cat = null;
      for(var i = 0; i < CATEGORY_ORDER.length; i++){
        if(el.classList.contains(CATEGORY_ORDER[i])){ cat = CATEGORY_ORDER[i]; break; }
      }
      if(!cat) return;

      var cr = parseFloat(meta.cr) || 0;
      // Checked "done" tracks whether it was taken — an F grade means it
      // wasn't passed, so it shouldn't count as a satisfied requirement
      // even if the box is ticked.
      var isDone = !!progress[pid] && !window.AAUP_GPA.isNonPassing(grades[pid]);
      var status = statuses[pid];

      byCat[cat].total += cr;
      // Which requirement bucket this course's hours belong to, kept per
      // category so the published figures can be shared out correctly below.
      // A single display category can feed TWO buckets: supportCourses and
      // colgReq are both drawn in 'math', and nothing about the card says
      // which is which.
      if(meta.req){
        catBucket[cat] = catBucket[cat] || {};
        catBucket[cat][meta.req] = (catBucket[cat][meta.req] || 0) + cr;
      }
      if(isDone){ byCat[cat].completed += cr; }
      else if(status === 'in_progress'){ byCat[cat].inProgress += cr; }
      else if(status === 'planned'){ byCat[cat].planned += cr; }
    });

    // Dept/elective pool: Required is the target hours (not the whole pool
    // on offer), Completed is capped at that target — same math as the My
    // Progress panel's elective section.
    var deptCompletedCount = 0, deptCompletedCredits = 0;
    courses.forEach(function(el){
      if(!el.classList.contains('dept') || !progress[el.id]) return;
      var parts = window.__splitCourseId(el.id);
      var meta = parts && info[parts.slug];
      if(!meta) return;
      if(window.__isSupersededByRetake && parts && window.__isSupersededByRetake(prefix, parts.slug)) return;
      var pidHere = window.AAUP_GPA.primaryId(prefix, parts.slug);
      if(window.AAUP_GPA.isNonPassing(grades[pidHere])) return; // F/FA/W — taken but not passed, doesn't satisfy the requirement
      deptCompletedCount++;
      deptCompletedCredits += parseFloat(meta.cr) || 0;
    });
    var deptStillNeeded = Math.max(0, deptNeededCount - Math.min(deptCompletedCount, deptNeededCount));
    var deptInProgCount = 0, deptPlannedCount = 0;
    courses.forEach(function(el){
      if(!el.classList.contains('dept') || !!progress[el.id]) return;
      if(deptInProgCount + deptPlannedCount >= deptStillNeeded) return;
      var partsHere = window.__splitCourseId(el.id);
      if(window.__isSupersededByRetake && partsHere && window.__isSupersededByRetake(prefix, partsHere.slug)) return;
      var status = statuses[el.id];
      if(status === 'in_progress'){ deptInProgCount++; }
      else if(status === 'planned'){ deptPlannedCount++; }
    });
    byCat.dept = {
      total: deptNeededCredits,
      completed: Math.min(deptCompletedCredits, deptNeededCredits),
      inProgress: deptInProgCount * deptCreditUnit,
      planned: deptPlannedCount * deptCreditUnit
    };

    // Required, where the university published a figure. This screen groups by
    // the plan's LEGEND categories while My Path groups by the university's
    // requirement buckets, and for the same reason as the dept pool above, the
    // sum of the cards in a group is not what the group is worth: an advisory
    // plan can schedule a course the requirement tables never list, and a plan
    // can be short a slot. Left alone, this screen and My Path printed
    // different degree totals for ten plans - the exact failure this file's
    // dept-pool handling was written to stop, one row over.
    //
    // The split is done from each course's OWN bucket, not from a category ->
    // bucket table. A table cannot work: 'math' carries both colgReq and
    // supportCourses, and scaling that row to colgReq's figure alone dropped
    // supportCourses outright - eight degrees lost 10 to 24 hours.
    if(Object.keys(planReq).length){
      var drawnPerBucket = {};
      Object.keys(catBucket).forEach(function(cat){
        Object.keys(catBucket[cat]).forEach(function(bkt){
          drawnPerBucket[bkt] = (drawnPerBucket[bkt] || 0) + catBucket[cat][bkt];
        });
      });
      CATEGORY_ORDER.forEach(function(cat){
        var mix = catBucket[cat];
        if(cat === 'dept' || !mix) return;      // dept is settled above
        var settled = 0, unsettled = 0, mixTotal = 0;
        Object.keys(mix).forEach(function(bkt){
          mixTotal += mix[bkt];
          if(typeof planReq[bkt] === 'number' && drawnPerBucket[bkt] > 0){
            // This row's share of the bucket's published hours, in proportion
            // to how much of that bucket it draws.
            settled += planReq[bkt] * (mix[bkt] / drawnPerBucket[bkt]);
          } else {
            unsettled += mix[bkt];              // no published figure: count as drawn
          }
        });
        // Courses with no bucket at all. In a plan with published figures these
        // are inside the published total, not on top of it - Bachelor in Law's
        // ADMINISTRATIVE LAW (1) is scheduled in the university's advisory plan
        // for a 136-hour degree while no requirement table claims it. Adding
        // its hours to a settled row made this screen say 142 where My Path
        // said 136. Where the row has no published figure to sit inside, the
        // hours are all there is, so they stay.
        var noBucket = Math.max(0, byCat[cat].total - mixTotal);
        byCat[cat].total = settled > 0 ? settled + unsettled : unsettled + noBucket;
      });
    }

    // Missing = whatever's left once Completed/In-Progress/Planned are taken
    // out of Required, in that priority order — guarantees every row sums
    // exactly back to Required, with no negative or over-counted cells.
    return CATEGORY_ORDER.map(function(cat){
      var r = byCat[cat];
      var completed = Math.min(r.completed, r.total);
      var inProgress = Math.min(r.inProgress, Math.max(0, r.total - completed));
      var planned = Math.min(r.planned, Math.max(0, r.total - completed - inProgress));
      var missing = Math.max(0, r.total - completed - inProgress - planned);
      return { cat: cat, total: r.total, completed: completed, inProgress: inProgress, planned: planned, missing: missing };
    }).filter(function(r){ return r.total > 0; });
  }

  // Phone-only (see .audit-rings in app.css) — the same six rows the table
  // below states in full, as one glanceable ring per category instead of a
  // row you have to read across five columns of. Purely additive: the
  // table underneath still carries every number (Required/Completed/In
  // Progress/Planned/Missing) exactly as before, this is a summary layer
  // on top of it, not a replacement — nothing a student could read before
  // is unreachable now.
  function auditRingsHtml(rows, prefix, rtl){
    var R = 18, C = Math.round(2 * Math.PI * R * 100) / 100;
    return '<div class="audit-rings">' + rows.map(function(r){
      var lbl = labelFor(prefix, r.cat);
      var pct = r.total ? Math.min(1, r.completed / r.total) : 0;
      var offset = Math.round(C * (1 - pct) * 100) / 100;
      return '<div class="audit-ring-card">' +
        '<svg class="audit-mini-ring" viewBox="0 0 44 44">' +
          '<circle class="track" cx="22" cy="22" r="' + R + '"/>' +
          '<circle class="val" cx="22" cy="22" r="' + R + '" style="stroke:var(--' + r.cat + ');" ' +
            'stroke-dasharray="' + C + '" stroke-dashoffset="' + offset + '"/>' +
        '</svg>' +
        '<div class="ar-lbl">' + (rtl ? lbl.ar : lbl.en) + '</div>' +
        '<div class="ar-frac">' + r.completed + '/' + r.total + 'H</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderAuditTable(prefix, rtl){
    var rows = computeAudit(prefix);
    var totalReq = 0, totalC = 0, totalIP = 0, totalP = 0, totalM = 0;
    var thead = rtl
      ? ['الفئة', 'المطلوب', 'مكتمل', 'قيد الإنجاز', 'القادم', 'ناقص']
      : ['Category', 'Required', 'Completed', 'In Progress', 'Planned Next', 'Missing'];
    var html = '<table class="audit-table' + (rtl ? ' rtl' : '') + '"><thead><tr>' +
      thead.map(function(h){ return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function(r){
      var lbl = labelFor(prefix, r.cat);
      totalReq += r.total; totalC += r.completed; totalIP += r.inProgress; totalP += r.planned; totalM += r.missing;
      html += '<tr>' +
        '<td class="cat-name"><span class="audit-cat-dot" style="background:var(--' + r.cat + ')"></span>' + (rtl ? lbl.ar : lbl.en) + '</td>' +
        '<td>' + r.total + 'H</td>' +
        '<td class="col-completed' + (r.completed ? '' : ' zero') + '">' + r.completed + 'H</td>' +
        '<td class="col-inprogress' + (r.inProgress ? '' : ' zero') + '">' + r.inProgress + 'H</td>' +
        '<td class="col-planned' + (r.planned ? '' : ' zero') + '">' + r.planned + 'H</td>' +
        '<td class="col-missing' + (r.missing ? '' : ' zero') + '">' + r.missing + 'H</td>' +
        '</tr>';
    });
    html += '</tbody><tfoot><tr style="font-weight:800;">' +
      '<td>' + (rtl ? 'الإجمالي' : 'Total') + '</td><td>' + totalReq + 'H</td>' +
      '<td class="col-completed">' + totalC + 'H</td><td class="col-inprogress">' + totalIP + 'H</td>' +
      '<td class="col-planned">' + totalP + 'H</td><td class="col-missing">' + totalM + 'H</td>' +
      '</tr></tfoot></table>';
    // Six columns of category data don't fit a phone width even with the
    // header text wrapping to two lines — the table used to just spill past
    // the modal's own edge, widening the whole page (and, with it, throwing
    // off the GPA Studio panels' own swipe-snap sizing above, since their
    // 100% width then resolved against that now-too-wide page). Its own
    // scroll container keeps the overflow local to this table.
    return auditRingsHtml(rows, prefix, rtl) + '<div class="audit-table-wrap">' + html + '</div>';
  }

  function renderGpaDashboard(prefix, rtl){
    var cum = window.AAUP_GPA.gpaFor(prefix, null);
    var major = window.AAUP_GPA.gpaFor(prefix, function(el){
      return el.classList.contains('core') || el.classList.contains('dept');
    });
    var standing = window.AAUP_GPA.standingFor(cum.gpa);
    var fmt = function(g){ return g === null ? '—' : g.toFixed(2); };
    return '<div class="gpa-dashboard">' +
      '<div class="gpa-card"><div class="gc-num">' + fmt(cum.gpa) + '</div><div class="gc-label">' + (rtl ? 'المعدل التراكمي' : 'Cumulative GPA') + '</div></div>' +
      '<div class="gpa-card"><div class="gc-num">' + fmt(major.gpa) + '</div><div class="gc-label">' + (rtl ? 'معدل التخصص' : 'Major GPA') + '</div></div>' +
      '<div class="gpa-card"><div class="gc-num" style="font-size:14px;padding-top:3px;">' +
        '<span class="standing-badge ' + standing.cls + '">' + (rtl ? standing.ar : standing.label) + '</span></div>' +
        '<div class="gc-label">' + (rtl ? 'الوضع الأكاديمي' : 'Academic Standing') + '</div></div>' +
      '</div>';
  }

  // The audit and What-if are both about one number: where the GPA is, and
  // where it would be. What-if used to be a menu row of its own; it is now
  // this screen's other mode, drawn into the same body by AAUP_WHATIF.mount.
  // Grades is one place for everything about grades: the GPA and every
  // grade (My grades), what would change it (What if), and what the degree
  // still needs (Requirements). 'now' stays the key for My grades so older
  // callers that open this screen on it still land in the right place.
  var mode = 'now';

  function modeBarHtml(rtl){
    var tabs = [
      ['now', rtl ? 'علاماتي' : 'My grades'],
      window.AAUP_WHATIF && window.AAUP_WHATIF.mount ? ['whatif', rtl ? 'ماذا لو' : 'What if'] : null,
      ['req', rtl ? 'المتطلبات' : 'Requirements']
    ].filter(Boolean);
    return '<div class="au-modes" role="group">' + tabs.map(function(pair){
      var on = mode === pair[0];
      return '<button type="button" class="au-mode' + (on ? ' au-mode-on' : '') +
        '" data-au-mode="' + pair[0] + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        window.__escapeHtml(pair[1]) + '</button>';
    }).join('') + '</div>';
  }

  // ============================================================
  // 58 · YOUR LOAD AGAINST THE ADVISORY PLAN
  //
  // The university publishes its own semester-by-semester sequence for most of
  // these plans and the app has never once compared against it. Two bars per
  // term — what the plan scheduled, and what the student has actually
  // finished in that term — show at a glance whether someone is front-loading,
  // coasting, or about to walk into a 21-hour wall. It needs no data that is
  // not already here.
  //
  // "Your" hours are the courses marked done that the plan places in that
  // term. A course taken out of sequence therefore shows up against the term
  // the plan expected it in, not the term it was really taken — the app does
  // not record the latter, and inventing it would be worse than the honest
  // approximation. The caption says as much.
  function advisoryHtml(prefix, rtl){
    var plans = window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans();
    var plan = plans && plans[prefix];
    if(!plan || !plan.structure || !Array.isArray(plan.structure.years)) return '';
    var progress = window.__getProgress ? window.__getProgress() : {};
    var terms = [];
    plan.structure.years.forEach(function(y, i){
      ['s1', 's2'].concat(y.hasSummer ? ['s3'] : []).forEach(function(sem){
        var here = (plan.courses || []).filter(function(c){
          return c.yearId === y.id && c.semester === sem;
        });
        if(!here.length) return;
        var planned = 0, mine = 0;
        here.forEach(function(c){
          var h = parseFloat(c.creditHours) || 0;
          planned += h;
          if(progress[prefix + '-c-' + c.id]) mine += h;
        });
        // "Y1a" needs decoding; "1.1" does not, and it reads the same in
        // both languages, which matters because the bars are only ~26px wide
        // on a phone. The full wording lives in the tooltip.
        var mark = sem === 's3' ? '\u2600' : sem === 's1' ? '1' : '2';
        var full = rtl
          ? 'السنة ' + (i + 1) + ' · ' + (sem === 's3' ? 'صيفي' : sem === 's1' ? 'الفصل الأول' : 'الفصل الثاني')
          : 'Year ' + (i + 1) + ' · ' + (sem === 's3' ? 'Summer' : sem === 's1' ? 'first semester' : 'second semester');
        terms.push({ label: (i + 1) + '.' + mark, full: full, planned: planned, mine: mine });
      });
    });
    if(terms.length < 2) return '';
    var peak = terms.reduce(function(m, t){ return Math.max(m, t.planned, t.mine); }, 1);
    var bars = terms.map(function(t){
      var pct = function(v){ return Math.round((v / peak) * 100); };
      var tip = t.full + ' — ' + (rtl
        ? 'أنجزت ' + t.mine + ' من ' + t.planned + ' ساعة'
        : 'you finished ' + t.mine + ' of the ' + t.planned + ' hours scheduled');
      return '<div class="adv-term" title="' + window.__escapeHtml(tip) + '">' +
        '<div class="adv-pair">' +
          '<span class="adv-mine" style="height:' + pct(t.mine) + '%"></span>' +
          '<span class="adv-plan" style="height:' + pct(t.planned) + '%"></span>' +
        '</div><span class="adv-lab">' + window.__escapeHtml(t.label) + '</span></div>';
    }).join('');
    return '<div class="adv-block">' +
      '<h3 style="margin-bottom:6px;">' +
        (rtl ? 'حِملك مقابل الخطة الإرشادية' : 'Your load against the advisory plan') + '</h3>' +
      '<p class="adv-key">' +
        '<span class="adv-swatch adv-swatch-mine"></span>' + (rtl ? 'أنجزت' : 'you finished') +
        '<span class="adv-swatch adv-swatch-plan"></span>' + (rtl ? 'الخطة' : 'the plan schedules') +
      '</p>' +
      '<div class="adv-chart">' + bars + '</div>' +
      '<p class="form-note">' + (rtl
        ? 'المساق المُنجز يُحتسب على الفصل الذي تضعه فيه الخطة، لا الفصل الذي أخذته فيه فعلًا.'
        : 'A finished course counts against the term the plan puts it in, not the term you actually took it.') +
      '</p></div>';
  }

  function open(prefix, startMode){
    var body = document.getElementById('auditModalBody');
    var overlay = document.getElementById('auditModalOverlay');
    if(!body || !overlay) return;
    // This same open() is what a grade chip calls to rebuild the screen after
    // a save, so "was the overlay already open?" is the only thing that
    // separates a fresh visit from a redraw. The GPA list's "changed" marks
    // belong to one sitting; resetting them on every redraw would clear them
    // the instant they were earned.
    if(!overlay.classList.contains('open') &&
       window.AAUP_GPA_STUDIO && window.AAUP_GPA_STUDIO.resetChanged){
      window.AAUP_GPA_STUDIO.resetChanged();
    }
    if(startMode === 'now' || startMode === 'whatif' || startMode === 'req'){ mode = startMode; }
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    // The sentence that used to sit here explained which screen set a grade
    // and which screen edited one. It was true, and it only had to exist
    // because the two screens did different things: the course popup was the
    // only place a FIRST grade could be entered, and the table below only
    // edited grades that already existed. They do the same thing now
    // (js/51-gpa-studio.js lists every finished course, graded or not), so
    // there is nothing left to explain and the table's own cells are the
    // answer.
    var anyGrades = !window.AAUP_GPA_STUDIO || !window.AAUP_GPA_STUDIO.hasGrades ||
                    window.AAUP_GPA_STUDIO.hasGrades(prefix);

    // The dial-and-table layout (js/51-gpa-studio.js) replaces the old flat
    // row of three cards outright rather than sitting next to it — showing
    // the cumulative number twice, in two different-looking widgets on the
    // same screen, is not what was approved and reads as unfinished. If
    // that module is missing for any reason, the original three-card
    // summary is the fallback, not a blank space.
    var head = '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('clipboard', 20) +
      (rtl ? 'العلامات' : 'Grades') + '</h2>' + modeBarHtml(rtl);

    if(mode === 'whatif'){
      body.innerHTML = head + '<div id="auditWhatIfBody"></div>';
      overlay.classList.add('open');
      bindModes(prefix);
      window.AAUP_WHATIF.mount(prefix, 'auditWhatIfBody');
      return;
    }

    if(mode === 'req'){
      body.innerHTML = head + advisoryHtml(prefix, rtl) + renderAuditTable(prefix, rtl);
      overlay.classList.add('open');
      bindModes(prefix);
      markScrollable(body);
      return;
    }

    // My grades. The reach-a-target slider is part of the studio's layout;
    // the second target tool that used to follow it here asked the same
    // question of the same hours, so it is not drawn twice.
    body.innerHTML = head +
      (window.AAUP_GPA_STUDIO ? window.AAUP_GPA_STUDIO.layout(prefix, rtl) : renderGpaDashboard(prefix, rtl)) +
      (anyGrades ? renderSemesterGpas(prefix, rtl) : '');
    overlay.classList.add('open');
    bindModes(prefix);
    markScrollable(body);
    if(window.AAUP_GPA_STUDIO) window.AAUP_GPA_STUDIO.bind(prefix, rtl);
  }

  // The table has always scrolled sideways — .audit-table-wrap carries
  // overflow-x:auto — but nothing on screen said so, so on a phone the last
  // two columns simply sat past the edge and the table read as broken rather
  // than as scrollable. The CSS draws a fade and a chevron on the trailing
  // edge; these two classes tell it whether there is anything to scroll to
  // and whether you have already got there.
  function markScrollable(body){
    body.querySelectorAll('.audit-table-wrap').forEach(function(wrap){
      var sync = function(){
        // scrollLeft runs negative in an RTL container, so compare distances.
        var max = wrap.scrollWidth - wrap.clientWidth;
        var at = Math.abs(wrap.scrollLeft);
        wrap.classList.toggle('can-scroll', max > 4);
        wrap.classList.toggle('at-end', max <= 4 || at >= max - 4);
      };
      wrap.addEventListener('scroll', sync, { passive: true });
      // The dialog is mid-open, so the table has no measured width yet.
      requestAnimationFrame(sync);
      setTimeout(sync, 220);
    });
  }

  function bindModes(prefix){
    var body = document.getElementById('auditModalBody');
    if(!body) return;
    body.querySelectorAll('[data-au-mode]').forEach(function(b){
      b.addEventListener('click', function(){
        var m = b.getAttribute('data-au-mode');
        if(m === mode) return;
        mode = m;
        open(prefix);
      });
    });
  }

  // Mirrors a real transcript's structure: each semester's own GPA (which
  // keeps every attempt made that semester, including F's later retaken),
  // alongside the cumulative above (which excludes replaced attempts).
  // A transcript is the shape this information already has: one row a term,
  // hours and GPA, with the cumulative underneath. It was a list of two-part
  // rows before, which is the same numbers arranged so they could not be
  // read down a column.
  //
  // The numbers are this app's, computed from what the student ticked and
  // the grades they entered — not a record from the registrar, and the
  // table says so rather than looking like one.
  function renderSemesterGpas(prefix, rtl){
    if(!window.AAUP_GPA.semesterGpas) return '';
    var sems = window.AAUP_GPA.semesterGpas(prefix);
    if(!sems.length) return '';
    var cum = window.AAUP_GPA.gpaFor(prefix) || {};
    var totalCr = sems.reduce(function(a, s){ return a + s.credits; }, 0);
    var rows = sems.map(function(s){
      return '<tr><td>' + window.__escapeHtml(rtl ? s.ar : s.label) + '</td>' +
        '<td class="tr-num">' + s.credits + '</td>' +
        '<td class="tr-num">' + s.gpa.toFixed(2) + '</td></tr>';
    }).join('');
    return '<h3 style="margin-bottom:6px;">' + (rtl ? 'كشف العلامات' : 'Your record') + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' +
      (rtl
        ? 'أرقامك أنت — محسوبة مما أدخلته، مش كشف من دائرة التسجيل.'
        : 'Your numbers, computed from what you entered — not the registrar\u2019s record.') +
      '</p>' +
      '<div class="tr-wrap"><table class="tr-table">' +
      '<thead><tr>' +
        '<th>' + (rtl ? 'الفصل' : 'Term') + '</th>' +
        '<th class="tr-num">' + (rtl ? 'ساعات' : 'Hours') + '</th>' +
        '<th class="tr-num">' + (rtl ? 'المعدل' : 'GPA') + '</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr>' +
        '<td>' + (rtl ? 'التراكمي' : 'Cumulative') + '</td>' +
        '<td class="tr-num">' + totalCr + '</td>' +
        '<td class="tr-num">' + (cum.gpa != null ? cum.gpa.toFixed(2) : '\u2014') + '</td>' +
      '</tr></tfoot>' +
      '</table></div>' +
      // Why the last row can be higher than every row above it. Kept, because
      // it is the one thing about these numbers that looks like a mistake —
      // but folded, because it is read once.
      '<details class="tr-why"><summary>' +
      (rtl ? 'ليش التراكمي أعلى من كل فصل؟' : 'Why is the cumulative higher than every term?') +
      '</summary><p>' +
      (rtl
        ? 'معدل الفصل بيشمل كل المحاولات في ذاك الفصل (علامة F بتضل بفصلها). التراكمي فوق بيستبدل علامة المساق المعاد بعلامة الإعادة.'
        : 'A term\u2019s GPA keeps every attempt made that term \u2014 an F stays in its term. The cumulative replaces a repeated course\u2019s old grade with the retake\u2019s.') +
      '</p></details>';
  }

  function bind(){
    var overlay = document.getElementById('auditModalOverlay');
    var closeBtn = document.getElementById('auditModalClose');
    if(!overlay) return;
    var close = function(){ overlay.classList.remove('open'); };
    if(closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    var card = overlay.querySelector('.modal-card');
    if(card) card.addEventListener('click', function(e){ e.stopPropagation(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
  }
  if(document.readyState === 'complete'){ bind(); }
  else { window.addEventListener('load', bind); }

  window.AAUP_AUDIT = { open: open, computeAudit: computeAudit, labelFor: labelFor };
})();
