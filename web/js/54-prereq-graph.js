// ==========================
// PREREQUISITE MAP — what searching a course actually opens now
// ==========================
// Replaces the old scroll-to-and-highlight-on-the-page behavior for a
// SEARCH result specifically (js/03-search.js's window.__selectCourse and
// its floating popup are untouched — What's Next and other callers still
// use exactly that; this only changes what a manual search click does).
// Per the approved mockup: an interactive node graph of the searched
// course's real prerequisite chain, colored by real status, with a
// legend and a "what's actually left" callout computed from real data —
// not a fabricated term/calendar estimate.
//
// Clicking a node does not replace the map with a fresh one centered on
// that course — it EXPANDS the same canvas to also include that course's
// own context (its prerequisites and what it unlocks), the same way a
// mind-map grows, and scrolls so the newly-clicked course lands centered
// in view. Nothing already drawn is ever removed. This is why the module
// keeps an accumulating set of "expanded" courses across clicks instead of
// recomputing everything from one fixed anchor on every render.
(function(){
  var MAX_ANCESTOR_DEPTH = 4; // matches the mockup's visible depth; deep curricula get "closest N levels," not an unreadable wall
  // NODE_H is the height the layout maths assumes AND the height every node
  // is actually given — the two have to agree. They did not: a node with a
  // two-line name measured 85px against an assumed 66, so two nodes in the
  // same layer, pitched 66+16 apart, overlapped by three pixels. The name is
  // clamped to two lines (see .pg-node-name) precisely so this height is a
  // worst case and not a guess, and the card is now pinned to it.
  var NODE_W = 168, NODE_H = 86, COL_GAP = 52, ROW_GAP = 16, PAD = 20;
  // Phone. The wide layout puts each prerequisite layer in its own column, so
  // a three-deep chain is 648px across inside a ~358px window: the tree
  // arrives as a letterboxed strip that has to be dragged sideways, with the
  // node you are standing on clipped off the left edge. Turned on its side it
  // scrolls the way a phone already scrolls, and a chain reads top-to-bottom,
  // which is the direction a prerequisite chain is usually drawn anyway.
  var NARROW_NODE_W = 150, NARROW_COL_GAP = 14, NARROW_ROW_GAP = 40;
  function isNarrow(){
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width:720px)').matches;
  }
  function metrics(){
    return isNarrow()
      ? { w: NARROW_NODE_W, colGap: NARROW_COL_GAP, rowGap: NARROW_ROW_GAP, vertical: true }
      : { w: NODE_W, colGap: COL_GAP, rowGap: ROW_GAP, vertical: false };
  }

  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s)) : String(s); }

  // A retaken course's real outcome lives on the RETAKE's own grade, not
  // the original attempt's — the original is whatever non-passing grade
  // (F/FA/W) triggered the retake in the first place, so checking it alone
  // showed an already-passed-by-retake course as still "locked behind
  // something" or, worse, its own prerequisites as merely "unlocked"
  // instead of "passed". Same retake lookup 18-gpa.js's cumulative GPA
  // calc already uses to decide whether to exclude the original attempt.
  function effectiveGrade(prefix, slug){
    var grades = window.AAUP_GPA.loadGrades();
    var progress = window.__getProgress ? window.__getProgress() : {};
    if(window.AAUP_RETAKES && window.AAUP_RETAKES.isSuperseded(prefix, slug)){
      // Retake exists — its own grade decides the outcome, even if it has
      // none yet (still pending, not settled by the original's old failing
      // grade). Never fall through to the original's grade once a retake
      // is on record.
      var retakePid = prefix + '-c-' + window.AAUP_RETAKES.retakeSlugFor(prefix, slug);
      return progress[retakePid] ? (grades[retakePid] || '') : '';
    }
    var pid = window.AAUP_GPA.primaryId(prefix, slug);
    return progress[pid] ? (grades[pid] || '') : '';
  }

  function isPassed(prefix, slug){
    var g = effectiveGrade(prefix, slug);
    return !!g && !window.AAUP_GPA.isNonPassing(g);
  }

  function statusFor(prefix, slug){
    if(isPassed(prefix, slug)) return 'passed';
    var pid = window.AAUP_GPA.primaryId(prefix, slug);
    var statuses = window.AAUP_GPA.loadStatuses();
    if(statuses[pid] === 'in_progress') return 'in_progress';
    var needs = ((window.__PLAN_DATA[prefix] || {}).needsMap || {})[slug] || [];
    var locked = needs.some(function(n){ return !isPassed(prefix, n); });
    return locked ? 'locked' : 'unlocked';
  }

  function gradeFor(prefix, slug){
    var g = effectiveGrade(prefix, slug);
    return window.AAUP_GPA.isNonPassing(g) ? '' : g;
  }

  // Every course reachable from `roots`: each root's own prerequisites (BFS
  // backward, depth-limited — a capstone's true transitive closure can be
  // dozens of courses deep) plus its direct unlocks (one hop forward,
  // matching what the mockup shows for the searched course itself).
  // Multiple roots simply union together, which is what lets the graph grow
  // by merging in a newly-clicked node's own context.
  function collectNodes(prefix, roots){
    var data = window.__PLAN_DATA[prefix] || {};
    var needsMap = data.needsMap || {};
    var unlocksMap = data.unlocksMap || {};
    var include = {};
    var truncated = false;
    roots.forEach(function(root){
      include[root] = true;
      var depth = {}; depth[root] = 0;
      var queue = [root];
      while(queue.length){
        var cur = queue.shift();
        if(depth[cur] >= MAX_ANCESTOR_DEPTH){ truncated = truncated || (needsMap[cur] || []).length > 0; continue; }
        (needsMap[cur] || []).forEach(function(p){
          include[p] = true;
          if(depth[p] !== undefined) return;
          depth[p] = depth[cur] + 1;
          queue.push(p);
        });
      }
      (unlocksMap[root] || []).forEach(function(c){ include[c] = true; });
    });
    return { slugs: Object.keys(include), truncated: truncated };
  }

  // Column = how deep this course sits in the visible set's own prerequisite
  // chain (longest path from anything with no visible prerequisite), not a
  // hop-distance from one fixed anchor. A plain hop-count-from-the-anchor
  // scheme falls apart the moment a second root merges in — two anchors
  // disagree about what "column 1" means. Longest-path-within-the-set stays
  // coherent no matter how many roots have been merged in so far, and it's
  // the standard layered-DAG layout technique for exactly this reason.
  function layerAssign(prefix, slugs){
    var needsMap = ((window.__PLAN_DATA[prefix] || {}).needsMap) || {};
    var slugSet = {};
    slugs.forEach(function(s){ slugSet[s] = true; });
    var layer = {};
    function depthOf(s){
      if(layer[s] !== undefined) return layer[s];
      layer[s] = 0; // cycle guard: a real prereq graph has none, but never hang if data is ever malformed
      var needs = (needsMap[s] || []).filter(function(n){ return slugSet[n]; });
      var d = needs.length ? Math.max.apply(null, needs.map(depthOf)) + 1 : 0;
      layer[s] = d;
      return d;
    }
    slugs.forEach(depthOf);
    return layer;
  }

  function layout(prefix, roots){
    var collected = collectNodes(prefix, roots);
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var layer = layerAssign(prefix, collected.slugs);

    var columns = {}; // layer -> [slug], stable order so re-renders don't jitter
    collected.slugs.slice().sort().forEach(function(s){
      (columns[layer[s]] = columns[layer[s]] || []).push(s);
    });

    var levels = Object.keys(columns).map(Number).sort(function(a, b){ return a - b; });
    var m = metrics();
    var pos = {}; // slug -> {x, y}
    levels.forEach(function(level, layerIndex){
      columns[level].forEach(function(s, withinLayer){
        // Vertical: a layer is a ROW and its members sit side by side.
        // Horizontal: a layer is a COLUMN, exactly as before.
        pos[s] = m.vertical
          ? { x: PAD + withinLayer * (m.w + m.colGap), y: PAD + layerIndex * (NODE_H + m.rowGap) }
          : { x: PAD + layerIndex * (m.w + m.colGap), y: PAD + withinLayer * (NODE_H + m.rowGap) };
      });
    });

    var allSlugs = Object.keys(pos);
    var width = Math.max.apply(null, allSlugs.map(function(s){ return pos[s].x; })) + m.w + PAD;
    var height = Math.max.apply(null, allSlugs.map(function(s){ return pos[s].y; })) + NODE_H + PAD;

    // Every edge worth drawing: prerequisite -> dependent, for pairs where
    // BOTH ends made it into this bounded node set.
    var edges = [];
    allSlugs.forEach(function(s){
      var needs = ((window.__PLAN_DATA[prefix] || {}).needsMap || {})[s] || [];
      needs.forEach(function(n){ if(pos[n]){ edges.push([n, s]); } });
    });

    return { pos: pos, edges: edges, width: width, height: height, info: info,
             truncated: collected.truncated, nodeW: m.w, vertical: m.vertical };
  }

  function statusColor(st){
    return { passed: '#2ecc71', in_progress: 'var(--accent)', unlocked: '#f5a623', locked: 'var(--line)' }[st] || 'var(--line)';
  }

  function nodeHTML(prefix, slug, isSelected, rtl, t){
    var meta = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[slug] || {};
    var name = rtl && meta.ar ? meta.ar : (meta.name || slug);
    var st = statusFor(prefix, slug);
    var sub = st === 'passed' ? (t.nodePassed + (gradeFor(prefix, slug) ? ' · ' + esc(gradeFor(prefix, slug)) : ''))
      : st === 'in_progress' ? t.nodeInProgress
      : st === 'unlocked' ? t.nodeUnlocked
      : t.nodeLocked;
    // name comes from courseInfo, which every plan (built-in or imported)
    // already ran through the shared sanitizer's clean()/__cleanText before
    // it landed here — it's HTML-safe text, already escaped once. Escaping
    // it again turned a real "&" into a literal "&amp;" on screen (e.g.
    // "Elementary Probability &amp; Statistics"); num/slug/status text below
    // are NOT pre-escaped, so those still need esc().
    return '<div class="pg-node pg-node-' + st + (isSelected ? ' pg-node-selected' : '') + '" data-pg-slug="' + esc(slug) + '" tabindex="0" role="button">' +
      '<div class="pg-node-name">' + name + '</div>' +
      '<div class="pg-node-sub">' + esc(meta.num || '') + (meta.num ? ' · ' : '') + esc(sub) + '</div>' +
    '</div>';
  }

  // Leaves the prerequisite and enters the dependent on the faces that
  // actually point at each other — right/left when layers run across,
  // bottom/top when they run down. Drawing the horizontal curve on a
  // vertical layout sends every edge out of a node's side and back into the
  // side of the one directly beneath it.
  function edgePath(a, b, nodeW, vertical){
    if(vertical){
      var vx1 = a.x + nodeW / 2, vy1 = a.y + NODE_H;
      var vx2 = b.x + nodeW / 2, vy2 = b.y;
      var midY = (vy1 + vy2) / 2;
      return 'M ' + vx1 + ',' + vy1 + ' C ' + vx1 + ',' + midY + ' ' + vx2 + ',' + midY + ' ' + vx2 + ',' + vy2;
    }
    var x1 = a.x + nodeW, y1 = a.y + NODE_H / 2;
    var x2 = b.x, y2 = b.y + NODE_H / 2;
    var midX = (x1 + x2) / 2;
    return 'M ' + x1 + ',' + y1 + ' C ' + midX + ',' + y1 + ' ' + midX + ',' + y2 + ' ' + x2 + ',' + y2;
  }

  // "What's actually left" — the chain of NOT-yet-passed prerequisites
  // between the selected course and where the student really is, walked
  // backward through needsMap. Hop count and credit-hour sum are both read
  // straight off the plan's own data; nothing here is a calendar guess.
  function remainingChain(prefix, slug){
    if(isPassed(prefix, slug)) return null;
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var needsMap = (window.__PLAN_DATA[prefix] || {}).needsMap || {};
    // Longest remaining-prerequisite chain ending at slug, since that's the
    // real bottleneck — finishing the short branch of a diamond doesn't
    // unlock anything if the long branch is still outstanding.
    var memo = {};
    function longest(s){
      if(memo[s]) return memo[s];
      var needs = (needsMap[s] || []).filter(function(n){ return !isPassed(prefix, n); });
      if(!needs.length){ return (memo[s] = isPassed(prefix, s) ? [] : [s]); }
      var best = [];
      needs.forEach(function(n){
        var chain = longest(n);
        if(chain.length > best.length) best = chain;
      });
      memo[s] = best.concat(isPassed(prefix, s) ? [] : [s]);
      return memo[s];
    }
    var chain = longest(slug);
    var ch = chain.reduce(function(sum, s){ return sum + (parseFloat((info[s] || {}).cr) || 0); }, 0);
    return { chain: chain, hops: chain.length, ch: ch };
  }

  function selectedPanelHTML(prefix, slug, rtl, t){
    var meta = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[slug] || {};
    var name = rtl && meta.ar ? meta.ar : (meta.name || slug);
    var st = statusFor(prefix, slug);
    var needs = ((window.__PLAN_DATA[prefix] || {}).needsMap || {})[slug] || [];
    var needNames = needs.map(function(n){
      var nm = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[n] || {};
      return (rtl && nm.ar ? nm.ar : nm.name || n) + (isPassed(prefix, n) ? ' ✓' : '');
    });
    var body;
    if(st === 'passed'){
      body = t.alreadyDone;
    } else if(!needs.length){
      body = t.noPrereqs;
    } else {
      body = t.needsList(needNames);
    }
    var whyBtn = (st === 'locked' && window.AAUP_STORY)
      ? '<button type="button" class="pg-why-locked-btn" data-pg-why="' + esc(slug) + '">' + t.whyLocked + '</button>'
      : '';
    return '<div class="pg-selected"><div class="pg-panel-label">' + t.selectedLabel + '</div>' +
      '<h3 style="margin:2px 0 6px;">' + name + '</h3>' +
      '<p class="form-note" style="margin:0;">' + body + '</p>' + whyBtn + '</div>';
  }

  // Icon per course reflects its category (same classes the achievement
  // system already reads off each .course element), not its lock state —
  // status is conveyed by the badge pill next to the title instead, so a
  // "Calculus 1" card and a "Computer Vision" card don't look identical.
  var CATEGORY_ICONS = { core: '📘', math: '📐', dept: '💻', eng: '🔤', uni: '🏛️', free: '✨', skills: '🖥️' };
  function courseIcon(prefix, slug){
    var el = document.getElementById(prefix + '-c-' + slug);
    if(el){
      var cats = Object.keys(CATEGORY_ICONS);
      for(var i = 0; i < cats.length; i++){ if(el.classList.contains(cats[i])) return CATEGORY_ICONS[cats[i]]; }
    }
    return '';
  }

  function statusBadgeHtml(status, t){
    var label = status === 'passed' ? t.whyPassedBadge : status === 'unlocked' ? t.whyUnlockedBadge : t.whyLockedBadge;
    return '<span class="story-badge story-badge-' + status + '">' + esc(label) + '</span>';
  }

  // ---------- "why is this locked?" story mode ----------
  // A linear, swipeable alternative to reading the graph: one card per
  // course, walking backward along the SAME longest-remaining-chain
  // remainingChain() already computes for the "shortest route" panel — just
  // presented one step at a time instead of as a single arrow-joined line.
  // remainingChain's own chain only ever contains not-yet-passed courses, so
  // its last entry is always genuinely actionable (its own prerequisites are
  // already met) — one more card beyond that, showing one of ITS
  // prerequisites that's actually passed (when it has any), gives the
  // sequence the same satisfying "root cause, solved" ending the approved
  // mockup had, instead of stopping one beat early.
  function whyLockedCards(prefix, slug, rtl, t){
    var r = remainingChain(prefix, slug);
    if(!r || !r.hops) return null;
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var needsMap = (window.__PLAN_DATA[prefix] || {}).needsMap || {};
    var path = r.chain.slice().reverse(); // [target, ..., next actionable course]
    var nameOf = function(s){ var m = info[s] || {}; return rtl && m.ar ? m.ar : (m.name || s); };

    var cards = path.map(function(s, i){
      var st = statusFor(prefix, s);
      var isLast = i === path.length - 1;
      var needs = needsMap[s] || [];
      var nextInPath = !isLast ? path[i + 1] : null;
      var chipsHtml = needs.length ? '<div class="story-chip-row">' + needs.map(function(n){
        var passed = isPassed(prefix, n);
        var isNext = n === nextInPath;
        var cls = passed ? 'story-chip-done' : (isNext ? 'story-chip-focus' : '');
        return '<span class="story-chip' + (cls ? ' ' + cls : '') + '">' + (passed ? '✓ ' : '') + esc(nameOf(n)) + (isNext ? ' →' : '') + '</span>';
      }).join('') + '</div>' : '';
      var crumb = i > 0 ? path.slice(0, i + 1).map(nameOf).join(' ← ') : '';
      var note = isLast ? (needs.length ? t.whyResolved : t.whyNoPrereqs) : t.whyNeeds;

      return {
        icon: courseIcon(prefix, s),
        crumb: crumb,
        title: nameOf(s),
        sub: statusBadgeHtml(st, t),
        content: '<p class="story-why-note">' + note + '</p>' + chipsHtml,
        primary: (isLast && !needs.length) ? t.whyDone : undefined
      };
    });

    var rootSlug = path[path.length - 1];
    var rootNeeds = needsMap[rootSlug] || [];
    if(rootNeeds.length){
      // Any of these is already passed (that's WHY rootSlug is unlocked) —
      // the one with an actual grade recorded makes the best closing beat.
      var closer = rootNeeds.filter(function(n){ return isPassed(prefix, n); })[0];
      if(closer){
        var grade = gradeFor(prefix, closer);
        var fullCrumb = path.map(nameOf).concat([nameOf(closer)]).join(' ← ');
        cards.push({
          icon: courseIcon(prefix, closer),
          crumb: fullCrumb,
          title: nameOf(closer),
          sub: statusBadgeHtml('passed', t),
          content: '<p class="story-why-note">' + (grade ? t.whyGrade(grade) : '') + t.whyRootSolved + '</p>',
          primary: t.whyDone
        });
      }
    }

    return cards;
  }

  function openWhyLocked(prefix, slug){
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var t = T[rtl ? 'ar' : 'en'];
    var cards = whyLockedCards(prefix, slug, rtl, t);
    if(!cards || !window.AAUP_STORY) return;
    window.AAUP_STORY.open(cards, { rtl: rtl });
  }

  function legendHTML(t){
    return '<div class="pg-legend"><div class="pg-panel-label">' + t.legendLabel + '</div>' +
      ['passed', 'in_progress', 'unlocked', 'locked'].map(function(st){
        return '<div class="pg-legend-row"><span class="pg-legend-dot" style="background:' + statusColor(st) + ';"></span>' + t[st === 'in_progress' ? 'inProgress' : st] + '</div>';
      }).join('') + '</div>';
  }

  function routeHTML(prefix, slug, rtl, t){
    var r = remainingChain(prefix, slug);
    if(!r) return '';
    if(!r.hops) return '';
    var names = r.chain.map(function(s){
      var m = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[s] || {};
      return rtl && m.ar ? m.ar : (m.name || s);
    });
    return '<div class="pg-route"><div class="pg-panel-label">' + t.routeLabel + '</div>' +
      '<p style="margin:0 0 6px;font-weight:700;">' + names.join(' → ') + '</p>' +
      '<p class="form-note" style="margin:0;">' + t.routeStats(r.hops, r.ch) + '</p></div>';
  }

  var T = {
    en: {
      title: function(name){ return 'Prerequisite map · ' + name; },
      subtitle: function(n){ return n + ' links across this plan'; },
      selectedLabel: 'SELECTED', legendLabel: 'LEGEND', routeLabel: 'SHORTEST ROUTE',
      passed: 'passed', inProgress: 'in progress', unlocked: 'unlocked — you can take it', locked: 'locked behind something',
      // The legend explains; a node labels. Its four strings above are
      // sentences written for the legend, and on a node they wrapped to
      // three lines and pushed the card past the fixed height the layout
      // maths assumes ("100411020 · LOCKED BEHIND SOMETHING").
      nodePassed: 'passed', nodeInProgress: 'now', nodeUnlocked: 'open', nodeLocked: 'locked',
      alreadyDone: 'Already completed.', noPrereqs: 'No prerequisites — open to take now.',
      needsList: function(names){ return 'Needs ' + names.join(' and ') + '.'; },
      routeStats: function(hops, ch){ return hops + (hops === 1 ? ' course' : ' courses') + ' · ' + Math.round(ch) + ' credit hours'; },
      truncated: 'Showing your closest prerequisites — this chain goes back further.',
      whyLocked: 'Why is this locked?',
      whyLockedBadge: 'locked', whyUnlockedBadge: 'unlocked', whyPassedBadge: 'passed',
      whyNeeds: 'Needs:', whyResolved: 'Everything it needs is already done — you can take it now.',
      whyNoPrereqs: 'No prerequisites at all.', whyDone: 'Got it!',
      whyGrade: function(g){ return 'Grade: ' + g + '. '; },
      whyRootSolved: 'Nothing blocking this — end of the chain.'
    },
    ar: {
      title: function(name){ return 'خريطة المتطلبات السابقة · ' + name; },
      subtitle: function(n){ return n + ' رابطًا في هذه الخطة'; },
      selectedLabel: 'المحدد', legendLabel: 'المفتاح', routeLabel: 'أقصر مسار',
      passed: 'منجز', inProgress: 'قيد الدراسة', unlocked: 'متاح — يمكنك أخذه', locked: 'مغلق خلف مساق آخر',
      nodePassed: 'منجز', nodeInProgress: 'الآن', nodeUnlocked: 'متاح', nodeLocked: 'مغلق',
      alreadyDone: 'أُنجز بالفعل.', noPrereqs: 'لا متطلبات سابقة — متاح الآن.',
      needsList: function(names){ return 'يتطلب ' + names.join(' و') + '.'; },
      routeStats: function(hops, ch){ return hops + ' مساق · ' + Math.round(ch) + ' ساعة معتمدة'; },
      truncated: 'يُعرض أقرب المتطلبات فقط — هذه السلسلة تمتد أبعد من ذلك.',
      whyLocked: 'لماذا هذا مغلق؟',
      whyLockedBadge: 'مغلق', whyUnlockedBadge: 'متاح', whyPassedBadge: 'منجز',
      whyNeeds: 'يتطلب:', whyResolved: 'كل متطلباته مُنجزة بالفعل — يمكنك أخذه الآن.',
      whyNoPrereqs: 'لا متطلبات سابقة له إطلاقًا.', whyDone: 'فهمت!',
      whyGrade: function(g){ return 'العلامة: ' + g + '. '; },
      whyRootSolved: 'لا شيء يمنع هذا — نهاية السلسلة.'
    }
  };

  // Per-open-session state: which courses have been "expanded" into the
  // canvas so far (starts with just the searched one) and which is
  // currently selected (drives the side panel + which node gets centered).
  // Reset every time the modal is freshly opened via a new search.
  var expandedSlugs = [];
  var currentSelected = null;

  function scrollToCenter(wrapEl, pos, slug, animate, nodeW){
    if(!wrapEl || !pos[slug]) return;
    // The width the layout actually used, not the desktop constant — on a
    // phone that is 18px narrower, and centring on the wrong half of a node
    // is how the selected course ends up sitting off the edge it was
    // scrolled to.
    var centerX = pos[slug].x + (nodeW || NODE_W) / 2;
    var centerY = pos[slug].y + NODE_H / 2;
    var targetLeft = Math.max(0, centerX - wrapEl.clientWidth / 2);
    var targetTop = Math.max(0, centerY - wrapEl.clientHeight / 2);
    if(wrapEl.scrollTo){
      wrapEl.scrollTo({ left: targetLeft, top: targetTop, behavior: animate ? 'smooth' : 'auto' });
    } else {
      wrapEl.scrollLeft = targetLeft;
      wrapEl.scrollTop = targetTop;
    }
  }

  // Click-and-drag panning on desktop (mouse only — touch already gets
  // native finger-drag scrolling from the wrap's own overflow:auto, and
  // handling both at once just means fighting the browser's own gesture).
  // Bound once per modal open rather than once per render, since the wrap
  // element itself is never replaced — only its contents are.
  var dragBound = false;
  function bindDragPan(wrapEl){
    if(dragBound || !wrapEl) return;
    dragBound = true;
    var dragging = false, startX, startY, startLeft, startTop;
    wrapEl.addEventListener('pointerdown', function(e){
      if(e.pointerType !== 'mouse' || e.button !== 0) return;
      if(e.target.closest && e.target.closest('.pg-node')) return; // let a click on a node stay a click
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = wrapEl.scrollLeft; startTop = wrapEl.scrollTop;
      wrapEl.classList.add('pg-dragging');
      wrapEl.setPointerCapture && wrapEl.setPointerCapture(e.pointerId);
    });
    wrapEl.addEventListener('pointermove', function(e){
      if(!dragging) return;
      wrapEl.scrollLeft = startLeft - (e.clientX - startX);
      wrapEl.scrollTop = startTop - (e.clientY - startY);
    });
    function endDrag(){
      dragging = false;
      wrapEl.classList.remove('pg-dragging');
    }
    wrapEl.addEventListener('pointerup', endDrag);
    wrapEl.addEventListener('pointercancel', endDrag);
    wrapEl.addEventListener('pointerleave', function(){ if(dragging) endDrag(); });
  }

  function render(prefix, selectedSlug, animateScroll){
    var body = document.getElementById('prereqGraphModalBody');
    if(!body) return;
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var t = T[rtl ? 'ar' : 'en'];
    var sel = selectedSlug || currentSelected;
    currentSelected = sel;
    var g = layout(prefix, expandedSlugs);

    var nodesHTML = Object.keys(g.pos).map(function(s){
      return '<div style="position:absolute; left:' + g.pos[s].x + 'px; top:' + g.pos[s].y +
        'px; width:' + g.nodeW + 'px; height:' + NODE_H + 'px;">' +
        nodeHTML(prefix, s, s === sel, rtl, t) + '</div>';
    }).join('');
    // Matches the mockup: a solid edge is colored by what it leads to (green
    // into a passed course, blue into one you're taking now, orange into one
    // you can take now) — except when the destination is itself still locked
    // by some OTHER prerequisite, in which case this specific link is green
    // because the course it comes FROM is already passed.
    var edgesHTML = g.edges.map(function(e){
      var toStatus = statusFor(prefix, e[1]);
      var fromStatus = statusFor(prefix, e[0]);
      var solid = toStatus !== 'locked' || fromStatus === 'passed';
      var cls = 'pg-edge';
      if(!solid){ cls += ' pg-edge-dashed'; }
      else if(toStatus === 'passed'){ cls += ' pg-edge-passed'; }
      else if(toStatus === 'in_progress'){ cls += ' pg-edge-progress'; }
      else if(toStatus === 'unlocked'){ cls += ' pg-edge-unlocked'; }
      else if(fromStatus === 'passed'){ cls += ' pg-edge-passed'; }
      return '<path class="' + cls + '" d="' + edgePath(g.pos[e[0]], g.pos[e[1]], g.nodeW, g.vertical) + '"></path>';
    }).join('');

    var meta = g.info[sel] || {};
    var name = rtl && meta.ar ? meta.ar : (meta.name || sel);
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML =
      '<div class="pg-head"><div><h2 style="margin:0;">' + t.title(name) + '</h2>' +
      '<p class="form-note" style="margin-top:4px;">' + esc(t.subtitle(g.edges.length)) + '</p></div></div>' +
      (g.truncated ? '<p class="form-note pg-truncated">' + esc(t.truncated) + '</p>' : '') +
      '<div class="pg-body">' +
        '<div class="pg-graph-wrap" id="pgGraphWrap"><div class="pg-graph" style="width:' + g.width + 'px; height:' + g.height + 'px;">' +
          '<svg width="' + g.width + '" height="' + g.height + '" class="pg-svg">' + edgesHTML + '</svg>' +
          nodesHTML +
        '</div></div>' +
        '<div class="pg-side">' +
          selectedPanelHTML(prefix, sel, rtl, t) +
          legendHTML(t) +
          routeHTML(prefix, sel, rtl, t) +
        '</div>' +
      '</div>';

    body.querySelectorAll('[data-pg-slug]').forEach(function(el){
      el.addEventListener('click', function(){
        var clicked = el.getAttribute('data-pg-slug');
        if(expandedSlugs.indexOf(clicked) === -1){ expandedSlugs.push(clicked); }
        render(prefix, clicked, true);
      });
    });
    var whyBtnEl = body.querySelector('[data-pg-why]');
    if(whyBtnEl){
      whyBtnEl.addEventListener('click', function(){ openWhyLocked(prefix, whyBtnEl.getAttribute('data-pg-why')); });
    }

    var wrapEl = document.getElementById('pgGraphWrap');
    dragBound = false; // the wrap is a fresh element every render; rebind against it
    bindDragPan(wrapEl);
    scrollToCenter(wrapEl, g.pos, sel, !!animateScroll, g.nodeW);
  }

  function open(prefix, slug){
    var overlay = document.getElementById('prereqGraphModalOverlay');
    if(!overlay) return;
    expandedSlugs = [slug];
    // The modal must actually be visible BEFORE render() computes the
    // centering scroll position — .pg-graph-wrap has zero width/height
    // while display:none, so centering math run first has nothing real to
    // center against and silently does nothing useful.
    overlay.classList.add('open');
    render(prefix, slug, false);
  }
  function close(){
    var overlay = document.getElementById('prereqGraphModalOverlay');
    if(overlay){ overlay.classList.remove('open'); }
  }

  function initModalClose(){
    var closeBtn = document.getElementById('prereqGraphModalClose');
    var overlay = document.getElementById('prereqGraphModalOverlay');
    if(closeBtn){ closeBtn.addEventListener('click', close); }
    if(overlay){ overlay.addEventListener('click', function(e){ if(e.target === overlay){ close(); } }); }
    // Same keyboard escape hatch the other modals have.
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && overlay && overlay.classList.contains('open')){ close(); } });
  }
  if(document.readyState === 'complete'){ initModalClose(); }
  else { window.addEventListener('load', initModalClose); }

  window.AAUP_PREREQ_GRAPH = { open: open, close: close };
})();
