// ==========================
// CELEBRATIONS — confetti when a whole semester (or summer) gets completed,
// and a shareable achievement image card. Both are pure "reward" polish on
// top of data the app already tracks; both no-op gracefully where they
// can't run (reduced-motion users get no animation; a browser without
// canvas/share just downloads or skips).
// ==========================
(function(){
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- confetti ----------
  var COLORS = ['#5db8ff', '#4ade80', '#ff6fb8', '#f2b93d', '#a78bfa'];
  function confettiBurst(originEl){
    if(prefersReducedMotion) return;
    var canvas = document.getElementById('confettiCanvas');
    if(!canvas){
      canvas = document.createElement('canvas');
      canvas.id = 'confettiCanvas';
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3000;';
      document.body.appendChild(canvas);
    }
    var ctx = canvas.getContext('2d');
    if(!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var ox = window.innerWidth / 2, oy = window.innerHeight / 3;
    if(originEl && originEl.getBoundingClientRect){
      var r = originEl.getBoundingClientRect();
      if(r.width && r.top < window.innerHeight && r.bottom > 0){
        ox = r.left + r.width / 2;
        oy = Math.max(40, r.top + r.height / 2);
      }
    }

    var particles = [];
    var N = 90;
    for(var i = 0; i < N; i++){
      var angle = (Math.PI * 2 * i) / N + Math.random();
      var speed = 3 + Math.random() * 6;
      particles.push({
        x: ox, y: oy,
        vx: Math.cos(angle) * speed * (0.6 + Math.random()),
        vy: Math.sin(angle) * speed - (2 + Math.random() * 3),
        size: 4 + Math.random() * 5,
        color: COLORS[i % COLORS.length],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        life: 1
      });
    }
    var start = null;
    var DURATION = 2200;
    // Clear in DEVICE pixels: the drawing transform below scales everything
    // by dpr, so clearing with the transform still active (clearRect(0,0,
    // canvas.width, canvas.height)) is off by a factor of dpr — harmless when
    // dpr >= 1 (it just over-clears), but at dpr < 1 (browser zoomed out, or
    // fractional Windows display scaling) it clears only part of the canvas
    // and every un-cleared frame stacks up into diagonal dotted "trails"
    // instead of a clean burst. Reset the transform, clear the whole canvas,
    // then restore the dpr transform for drawing.
    function clearAll(){
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function frame(ts){
      if(!start) start = ts;
      var elapsed = ts - start;
      clearAll();
      particles.forEach(function(p){
        p.vy += 0.16;      // gravity
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life = Math.max(0, 1 - elapsed / DURATION);
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      if(elapsed < DURATION){
        requestAnimationFrame(frame);
      } else {
        clearAll();
      }
    }
    requestAnimationFrame(frame);
  }
  window.__confetti = confettiBurst;

  // ---------- semester-completion detection ----------
  // A session-only set of already-celebrated semesters, keyed by their
  // course-row id, so a fully-completed semester fires exactly once — and
  // becomes eligible to fire again only if it's later made incomplete and
  // re-completed.
  // ---------- 59 · the semester receipt ----------
  //
  // A semester ending is the one moment in four years when a student feels
  // something about their degree, and the app used to mark it with four
  // cards that said "Semester complete!", listed the courses, printed the
  // cumulative GPA and stopped. None of that was WRONG; it just was not
  // about the semester that had ended.
  //
  // A receipt is: what this semester was worth on its own (its GPA, its
  // hours, its courses), what it did to the cumulative (the before and the
  // after, which is the number people actually want), and what it opened.
  // Those three are the reward for keeping the app up to date, and they are
  // the thing worth a screenshot.
  //
  // The "before" cumulative is the real cumulative computed with this
  // semester's courses excluded — gpaFor()'s categoryFilter takes an element
  // predicate, so the semester's own rows are simply filtered out. It is not
  // a stored historical figure and does not pretend to be: a student who
  // enters four semesters of grades in one sitting gets one honest receipt
  // for the last of them, not four reconstructions of a past they did not
  // record.
  function tx(rtl, en, ar){ return rtl ? ar : en; }

  function receiptFigures(prefix, row){
    var courseEls = Array.prototype.slice.call(row.querySelectorAll('.course[id]:not(.course-removed)'));
    var ids = {};
    courseEls.forEach(function(el){ ids[el.id] = true; });

    var hours = 0;
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    courseEls.forEach(function(el){
      var parts = window.__splitCourseId && window.__splitCourseId(el.id);
      var meta = parts && info[parts.slug];
      hours += (meta && parseFloat(meta.cr)) || 0;
    });

    var gpa = window.AAUP_GPA || {};
    var after = gpa.gpaFor ? gpa.gpaFor(prefix) : null;
    // Everything except this semester's own courses — i.e. where the
    // cumulative stood the moment before this semester closed.
    var before = gpa.gpaFor ? gpa.gpaFor(prefix, function(el){ return !ids[el.id]; }) : null;

    // This semester on its own. semesterGpas() already computes exactly
    // this, keyed by the same year/semester the row id carries.
    var semGpa = null;
    var m = /-y(\d+)-s(\d+)$/.exec(row.id || '');
    if(m && gpa.semesterGpas){
      var want = 'Year ' + m[1] + ' \u2014 ' + (m[2] === '3' ? 'Summer' : 'Semester ' + m[2]);
      (gpa.semesterGpas(prefix) || []).forEach(function(sg){ if(sg.label === want) semGpa = sg; });
    }

    return {
      courseEls: courseEls, hours: hours, semGpa: semGpa,
      beforeGpa: before && before.gpa != null ? before.gpa : null,
      afterGpa: after && after.gpa != null ? after.gpa : null,
      opened: openedBy(prefix, ids)
    };
  }

  // Courses that were not available before this semester's courses were
  // passed and are available now. Computed from the plan's own prerequisite
  // map rather than from what is on screen, because the grid has not
  // re-rendered yet at the moment this fires.
  function openedBy(prefix, ids){
    var data = window.__PLAN_DATA[prefix] || {};
    var needs = data.needsMap || {};
    var progress = window.__getProgress ? window.__getProgress() : {};
    var justPassed = {};
    Object.keys(ids).forEach(function(pid){
      var parts = window.__splitCourseId && window.__splitCourseId(pid);
      if(parts) justPassed[parts.slug] = true;
    });
    var n = 0;
    Object.keys(needs).forEach(function(slug){
      if(justPassed[slug] || progress[prefix + '-c-' + slug]) return;
      var reqs = needs[slug] || [];
      if(!reqs.length) return;
      var openNow = reqs.every(function(r){ return !!progress[prefix + '-c-' + r]; });
      var neededOne = reqs.some(function(r){ return justPassed[r]; });
      if(openNow && neededOne) n++;
    });
    return n;
  }

  function semesterRecapCards(prefix, row){
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var semEl = row.closest('.sem');
    var semLabel = (semEl && semEl.querySelector('.sem-label') && semEl.querySelector('.sem-label').textContent || '').trim();
    var yearEl = row.closest('.year-row');
    var yearLabel = (yearEl && yearEl.querySelector('.year-badge .label') && yearEl.querySelector('.year-badge .label').textContent || '').trim();
    var where = [yearLabel, semLabel].filter(Boolean).join(' \u00b7 ');
    var f = receiptFigures(prefix, row);
    var ic = function(k, n){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview(k, n || 34) : ''; };

    var nC = f.courseEls.length;
    var courseNames = f.courseEls.map(function(el){
      var nameEl = el.querySelector('.name');
      return nameEl ? nameEl.textContent.replace(/\s*\u2713\s*$/, '').trim() : el.id;
    });

    var cards = [];

    // 1 — what this semester was, in its own numbers.
    cards.push({
      icon: ic('clipboard'),
      crumb: where ? window.__escapeHtml(where) : '',
      title: tx(rtl, 'Semester closed', 'انتهى الفصل'),
      sub: f.semGpa
        ? tx(rtl,
            f.hours + ' hours \u00b7 ' + nC + ' course' + (nC === 1 ? '' : 's'),
            f.hours + ' ساعة \u00b7 ' + arCourses(nC))
        : tx(rtl,
            f.hours + ' hours \u00b7 ' + nC + ' course' + (nC === 1 ? '' : 's') + ' \u00b7 no grades entered',
            f.hours + ' ساعة \u00b7 ' + arCourses(nC) + ' \u00b7 ما في علامات مدخلة'),
      content: f.semGpa
        ? '<div class="story-gpa-big">' + f.semGpa.gpa.toFixed(2) + '</div>' +
          '<div class="story-cap">' + tx(rtl, 'this semester\u2019s GPA', 'معدل هذا الفصل') + '</div>'
        : ''
    });

    // 2 — what it did to the cumulative. Only when there is a move to show:
    // the first graded semester has no "before", and saying "\u2014 \u2192 3.42"
    // is worse than not having the card.
    if(f.afterGpa != null && f.beforeGpa != null){
      var delta = f.afterGpa - f.beforeGpa;
      var dir = delta > 0.004 ? 'up' : delta < -0.004 ? 'down' : 'flat';
      cards.push({
        icon: ic(dir === 'down' ? 'chart' : 'stats'),
        title: tx(rtl, 'Cumulative GPA', 'المعدل التراكمي'),
        sub: dir === 'flat'
          ? tx(rtl, 'unchanged by this semester', 'ما تغيّر بهذا الفصل')
          : tx(rtl,
              (delta > 0 ? 'up ' : 'down ') + Math.abs(delta).toFixed(2) + ' on this semester',
              (delta > 0 ? 'طلع ' : 'نزل ') + Math.abs(delta).toFixed(2) + ' بهذا الفصل'),
        content: '<div class="story-move story-move-' + dir + '">' +
          '<span class="story-move-was">' + f.beforeGpa.toFixed(2) + '</span>' +
          '<span class="story-move-arrow" aria-hidden="true">\u2192</span>' +
          '<span class="story-move-now">' + f.afterGpa.toFixed(2) + '</span></div>'
      });
    } else if(f.afterGpa != null){
      cards.push({
        icon: ic('stats'),
        title: tx(rtl, 'Cumulative GPA', 'المعدل التراكمي'),
        sub: tx(rtl, 'your first graded semester', 'أول فصل بعلامات إلك'),
        content: '<div class="story-gpa-big">' + f.afterGpa.toFixed(2) + '</div>'
      });
    }

    // 3 — what it opened. Silent at zero: a semester that unlocks nothing is
    // a normal semester, and "0 courses opened" reads as a failure.
    if(f.opened > 0){
      cards.push({
        icon: ic('unlock'),
        title: tx(rtl,
          f.opened + ' course' + (f.opened === 1 ? '' : 's') + ' opened',
          'انفتح ' + arCourses(f.opened)),
        sub: tx(rtl, 'you could not take these before this semester',
                     'ما كنت تقدر تاخدهم قبل هذا الفصل'),
        content: ''
      });
    }

    // 4 — what was actually finished, by name.
    cards.push({
      icon: ic('book'),
      title: tx(rtl, 'What you finished', 'اللي خلّصته'),
      sub: '',
      content: '<div class="story-course-chips">' +
        courseNames.map(function(n){
          return '<span class="story-course-chip">' + window.__escapeHtml(n) + '</span>';
        }).join('') + '</div>',
      primary: tx(rtl, 'Nice work!', 'عمل ممتاز!')
    });

    return cards;
  }

  // Three for a dual, plural genitive to ten, singular accusative above.
  function arCourses(n){
    if(n === 1) return 'مساق واحد';
    if(n === 2) return 'مساقين';
    if(n <= 10) return n + ' مساقات';
    return n + ' مساقًا';
  }

  // A semester can finish on a student's very first visit to a plan (e.g.
  // most courses already ticked off elsewhere, one click here finishes the
  // set) — the exact moment the roadmap's own first-visit popup can also be
  // open. Same wait-until-clear pattern AAUP_TUTORIAL uses for the same
  // reason: don't fight another modal for the top of the stack.
  function celebrateSemester(prefix, row){
    if(!window.AAUP_STORY || prefersReducedMotion){ confettiBurst(row); return; }
    var tries = 0;
    (function attempt(){
      tries++;
      var blocked = document.querySelector('.modal-overlay.open');
      if(blocked && tries < 20){ setTimeout(attempt, 400); return; }
      window.AAUP_STORY.open(semesterRecapCards(prefix, row), { onFinish: function(){ confettiBurst(row); } });
    })();
  }

  var celebrated = {};
  function celebrateCheck(prefix){
    var root = document.getElementById('page-' + prefix);
    if(!root) return;
    var progress = window.__getProgress ? window.__getProgress() : {};
    var rows = root.querySelectorAll('.course-row[id]');
    Array.prototype.slice.call(rows).forEach(function(row){
      var courses = row.querySelectorAll('.course[id]:not(.course-removed)');
      if(!courses.length){ delete celebrated[row.id]; return; }
      var allDone = Array.prototype.slice.call(courses).every(function(c){ return !!progress[c.id]; });
      if(allDone){
        if(!celebrated[row.id]){
          celebrated[row.id] = true;
          celebrateSemester(prefix, row);
        }
      } else {
        delete celebrated[row.id];
      }
    });
  }
  // Ignore the very first pass right after a plan loads — otherwise a
  // returning student with an already-finished semester would get a
  // confetti blast on every page open. First call just seeds the set.
  var seeded = {};
  function celebrateCheckGuarded(prefix){
    if(!seeded[prefix]){
      seeded[prefix] = true;
      // seed silently: mark currently-complete semesters as already celebrated
      var root = document.getElementById('page-' + prefix);
      if(root){
        var progress = window.__getProgress ? window.__getProgress() : {};
        root.querySelectorAll('.course-row[id]').forEach(function(row){
          var courses = row.querySelectorAll('.course[id]:not(.course-removed)');
          if(courses.length && Array.prototype.slice.call(courses).every(function(c){ return !!progress[c.id]; })){
            celebrated[row.id] = true;
          }
        });
      }
      return;
    }
    celebrateCheck(prefix);
  }
  window.__celebrateCheck = celebrateCheckGuarded;

  // ---------- shareable achievement card ----------
  function drawCard(opts){
    // opts: { icon, title, subtitle, footer }
    var W = 1080, H = 1080;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    if(!ctx) return null;

    // background gradient
    // Drawn in whatever theme is running (js/02-shared-cross.js
    // __themeColors), not the indigo this was pinned to.
    var th = window.__themeColors ? window.__themeColors()
      : { bg: '#0a1428', panel: '#132540', accent: '#5db8ff', text: '#ffffff', dim: '#9fb4d0' };
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, th.bg);
    g.addColorStop(1, th.panel);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // accent frame
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(40, 40, W - 80, H - 80);

    ctx.textAlign = 'center';

    // trophy + icon
    ctx.font = '150px serif';
    ctx.fillText('🏆', W / 2, 320);
    ctx.font = '120px serif';
    ctx.fillText(opts.icon || '⭐', W / 2, 470);

    // "Achievement Unlocked"
    ctx.fillStyle = th.accent;
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('ACHIEVEMENT UNLOCKED', W / 2, 590);

    // title
    ctx.fillStyle = th.text;
    ctx.font = 'bold 72px sans-serif';
    wrapText(ctx, opts.title || '', W / 2, 690, W - 200, 84);

    // subtitle (major)
    if(opts.subtitle){
      ctx.fillStyle = th.dim;
      ctx.font = '38px sans-serif';
      wrapText(ctx, opts.subtitle, W / 2, 880, W - 240, 48);
    }

    // footer
    ctx.fillStyle = th.accent;
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(opts.footer || 'Study Plans', W / 2, H - 90);

    return canvas;
  }

  function wrapText(ctx, text, cx, y, maxWidth, lineHeight){
    var words = String(text).split(' ');
    var line = '', lines = [];
    words.forEach(function(w){
      var test = line ? (line + ' ' + w) : w;
      if(ctx.measureText(test).width > maxWidth && line){ lines.push(line); line = w; }
      else { line = test; }
    });
    if(line) lines.push(line);
    var startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach(function(l, i){ ctx.fillText(l, cx, startY + i * lineHeight); });
  }

  function shareAchievement(opts){
    var canvas = drawCard(opts);
    if(!canvas){ return; }
    canvas.toBlob(function(blob){
      if(!blob) return;
      var file = null;
      try{ file = new File([blob], 'achievement.png', { type: 'image/png' }); }catch(e){ file = null; }
      // Prefer the native share sheet (mobile) with the image attached;
      // fall back to a plain download everywhere else.
      if(file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share){
        navigator.share({ files: [file], title: 'Achievement Unlocked', text: (opts.title || '') }).catch(function(){ downloadBlob(blob); });
      } else {
        downloadBlob(blob);
      }
    }, 'image/png');
  }
  function downloadBlob(blob){
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'achievement-card.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    if(window.__showToast){ window.__showToast('Achievement card saved'); }
  }

  window.AAUP_CELEBRATE = { confetti: confettiBurst, shareAchievement: shareAchievement };
})();
