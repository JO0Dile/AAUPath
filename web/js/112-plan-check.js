// Admin · Check with aaup.edu — every plan against the university's own
// Academic Plan pages, about once a year.
//
// Each program on aaup.edu has an Academic Plan page (/<program>/curriculum)
// built from the registration system: one row per course, with its number,
// hours and the NUMBERS of its prerequisites. This card reads those pages,
// compares them with the plans the app ships (plans.json), and lists only
// what differs: courses missing or no longer listed, hours, prerequisites,
// programs the app does not have, and programs with no plan published.
//
// Getting the pages. www.aaup.edu turns away requests from servers - it
// answered 400 to every data centre tried, and blocks proxies outright - so
// there are two ways in, tried in this order:
//   1. the admin Worker fetches them (/api/admin/aaup), if the university
//      lets it;
//   2. the admin's own browser does: the card hands out a short script to run
//      on www.aaup.edu, which saves every page into one file, and the card
//      reads that file. Same pages, read the way any visitor reads them.
//
// The comparison follows tools/sync-site-plans.py, which is how the plans were
// brought in line with the site the first time:
//   * a page whose tables add up to the degree total it states is COMPLETE,
//     and a course it does not list has left the plan;
//   * an incomplete page only speaks for the courses it lists;
//   * a "-" in the Prerequisite column means none;
//   * a lecture and its lab printed as each other's prerequisite are
//     co-requisites, not two locks;
//   * university and free elective lists are left out - the plans give those
//     hours as slots the student names.
//
// "Use aaup.edu for this plan" applies one plan's differences through the
// same save the plan editor uses, so it lands in the repository and goes live
// like any edit. A course the university renumbered is saved as a replaced
// course (old number counts as the new one), so no student loses a pass.
(function(){
  'use strict';

  var KEY = 'aaup_planCheck';          // the last check, so reopening the card does not need a new one
  var SEEN = 'aaup_planCheckKept';     // plans the admin chose to keep as they are
  var st = { phase: 'idle', done: 0, total: 0, now: '', result: null, open: null, err: '', serverBlocked: false };
  var ctx = null;                      // { api, esc, rerender, toast }

  function load(){ try{ return JSON.parse(localStorage.getItem(KEY) || 'null'); }catch(e){ return null; } }
  function save(r){ try{ localStorage.setItem(KEY, JSON.stringify(r)); }catch(e){ /* storage full or blocked: the result still shows */ } }
  function kept(){ try{ return JSON.parse(localStorage.getItem(SEEN) || '{}'); }catch(e){ return {}; } }
  function keep(id, sig){ var k = kept(); k[id] = sig; try{ localStorage.setItem(SEEN, JSON.stringify(k)); }catch(e){ /* ignore */ } }
  st.result = load();

  // ---------------------------------------------------------------- reading pages
  function dom(html){ return new window.DOMParser().parseFromString(html, 'text/html'); }
  function txt(el){ return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function num(s){ s = String(s || '').trim(); if(!s || s === '-') return null; var n = parseFloat(s); return isFinite(n) ? n : null; }

  var TAB = { 'Univ. Req.': 'univReq', 'Univ. Elec.': 'univElec', 'Colg. Req.': 'colgReq', 'Colg. Elec.': 'colgElec',
              'Spec. Req.': 'specReq', 'Spec. Elec.': 'specElec', 'Dept. Req.': 'deptReq', 'Dept. Elec.': 'deptElec',
              'Minor Req.': 'minorReq', 'Minor Elec.': 'minorElec', 'Supp. Req.': 'supportCourses', 'Free Elec.': 'freeElec' };
  var POOLS = { univElec: 1, freeElec: 1 };

  // The program list on /academic-programs: faculty headings, then links.
  function parsePrograms(html){
    var d = dom(html), out = [], fac = '';
    d.querySelectorAll('h3, h6.field-content a').forEach(function(el){
      if(el.tagName === 'H3'){ fac = txt(el); return; }
      var name = txt(el).replace(/​/g, ''), href = el.getAttribute('href') || '';
      if(!/^(Bachelor|Diploma|Advanced Residency|Residency)/.test(name) || /Graduate/.test(fac)) return;
      // path: as the site links it (a few carry zero-width spaces, %E2%80%8B,
      // and are only found under that address); key: without them, as the
      // plans record it.
      var path = href.replace(/^https?:\/\/www\.aaup\.edu/, '');
      out.push({ faculty: fac, name: name, path: path, key: path.replace(/%E2%80%8B/gi, '') });
    });
    return out;
  }

  // One Academic Plan page -> { degreeHours, complete, published, courses: {number: {...}} }
  function parsePlan(html){
    var d = dom(html), tabs = {}, buckets = {}, courses = {};
    d.querySelectorAll('a[data-bs-target]').forEach(function(a){ tabs[(a.getAttribute('data-bs-target') || '').replace('#', '')] = txt(a); });
    var m = /Total Credit Hours Required[^(]*\(\s*(\d+)/.exec(d.body ? d.body.textContent : '');
    // A page can hold more than one version of the plan (dataset-1-…,
    // dataset-2-…); the last is the current one, as in parse-site.py.
    var last = 1;
    d.querySelectorAll('div.tab-pane[id]').forEach(function(pane){ var m2 = /^dataset-(\d+)/.exec(pane.id); if(m2) last = Math.max(last, +m2[1]); });
    d.querySelectorAll('div.tab-pane[id]').forEach(function(pane){
      var ds = /^dataset-(\d+)/.exec(pane.id);
      if(ds && +ds[1] !== last) return;
      var key = TAB[tabs[pane.id]];
      if(!key) return;
      var rule = txt(pane.querySelector('p.px-3')), hrs = /\(\s*(\d+)\s*\)\s*credit hours/.exec(rule);
      var rows = [];
      pane.querySelectorAll('table tbody > tr').forEach(function(tr){
        var tds = Array.prototype.filter.call(tr.children, function(c){ return c.tagName === 'TD'; });
        var code = tds.filter(function(c){ return c.classList.contains('course-id'); })[0];
        if(!code) return;
        var name = tds.filter(function(c){ return c.classList.contains('course-name'); })[0];
        var plain = tds.filter(function(c){ return !c.classList.contains('course-id') && !c.classList.contains('course-name') && !c.classList.contains('d-none'); });
        var pre = plain[plain.length - 1];
        rows.push({ code: txt(code), name: txt(name), credits: num(txt(plain[2])), bucket: key,
                    prereqs: pre ? Array.prototype.map.call(pre.querySelectorAll('p.course-id'), txt) : [] });
      });
      buckets[key] = { hours: hrs ? +hrs[1] : rows.reduce(function(s, r){ return s + (r.credits || 0); }, 0), rows: rows };
      if(!POOLS[key]) rows.forEach(function(r){ if(!courses[r.code]) courses[r.code] = r; });
    });
    var free = Array.prototype.filter.call(d.querySelectorAll('h2'), function(h){ return /Free Elective/.test(txt(h)); })[0];
    if(free && !buckets.freeElec){
      var fh = /\(\s*(\d+)\s*\)\s*credit hours/.exec(txt(free.parentElement && free.parentElement.parentElement));
      if(fh) buckets.freeElec = { hours: +fh[1], rows: [] };
    }
    var sum = Object.keys(buckets).reduce(function(s, k){ return s + buckets[k].hours; }, 0);
    var total = m ? +m[1] : null;
    return { degreeHours: total, sum: sum, complete: !!total && Math.abs(sum - total) < 0.001,
             published: Object.keys(buckets).length > 0, courses: courses };
  }

  // ---------------------------------------------------------------- comparing
  function compare(plan, page){
    var byId = {}, byNum = {};
    (plan.courses || []).forEach(function(c){
      var n = String(c.courseNumber || '').trim();
      byId[c.id] = c;
      if(!/^\d{6,}$/.test(n)) return;                // an elective slot, not a course
      (byNum[n] = byNum[n] || []).push(c);
    });
    function lecture(n){ var cs = byNum[n] || []; return cs.filter(function(c){ return c.id === n; })[0] || cs.filter(function(c){ return !/-lab$/.test(c.id); })[0] || cs[0]; }
    var changes = [];
    Object.keys(page.courses).forEach(function(n){
      var s = page.courses[n];
      // On an incomplete page a course only it lists is not a difference:
      // the plan keeps the document's courses there (see the header).
      if(!byNum[n]){ if(page.complete) changes.push({ kind: 'missing', code: n, name: s.name, site: s }); return; }
      var a = byNum[n][0];
      if(s.credits != null && Number(a.creditHours) !== s.credits) changes.push({ kind: 'hours', code: n, name: a.name, app: Number(a.creditHours), site: s.credits });
    });
    if(page.complete){
      Object.keys(byNum).forEach(function(n){
        if(!page.courses[n]) changes.push({ kind: 'notListed', code: n, name: byNum[n][0].name, app: byNum[n][0] });
      });
    }
    // prerequisites, as course numbers, for courses both list
    var appPre = {};
    (plan.prerequisites || []).forEach(function(p){
      var a = byId[p[0]], b = byId[p[1]];
      if(!a || !b) return;
      var bn = String(b.courseNumber || ''), an = String(a.courseNumber || '');
      if(an && bn && an !== bn) (appPre[bn] = appPre[bn] || {})[an] = 1;
    });
    Object.keys(page.courses).forEach(function(n){
      if(!byNum[n]) return;
      var want = {};
      page.courses[n].prereqs.forEach(function(q){
        var mutual = page.courses[q] && page.courses[q].prereqs.indexOf(n) >= 0;
        if(byNum[q] && q !== n && !mutual) want[q] = 1;
      });
      var have = appPre[n] || {};
      var w = Object.keys(want).sort(), h = Object.keys(have).sort();
      if(w.join() !== h.join()) changes.push({ kind: 'prereq', code: n, name: lecture(n).name, app: h, site: w });
    });
    // a course renumbered by the university: listed under a new number, the
    // same name gone from its old one
    var gone = changes.filter(function(c){ return c.kind === 'notListed'; });
    changes.filter(function(c){ return c.kind === 'missing'; }).forEach(function(c){
      var twin = gone.filter(function(g){ return norm(g.name) === norm(c.name) && !g.renamedTo; })[0];
      if(twin){ twin.renamedTo = c.code; c.renamedFrom = twin.code; }
    });
    if(page.complete && page.degreeHours && plan.degreeHours && page.degreeHours !== plan.degreeHours){
      changes.push({ kind: 'degree', app: plan.degreeHours, site: page.degreeHours });
    }
    return changes;
  }
  function norm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function sig(changes){ return changes.map(function(c){ return c.kind + c.code + (c.site && c.site.join ? c.site.join() : JSON.stringify(c.site || '')); }).join('|'); }

  // ---------------------------------------------------------------- the run
  // pages: { path: html } ; programs: [{faculty, name, path}]
  function analyse(programs, pages, catalogue){
    var map = catalogue.aaupPages || {}, byPath = {}, aside = {};
    Object.keys(map).forEach(function(id){ byPath[map[id]] = id; });
    // Pages read and set aside because they are not the program's plan
    // (tools/import-catalogue-programs.py, SITE_SET_ASIDE).
    var sa = catalogue.aaupSetAside || {};
    Object.keys(sa).forEach(function(id){ aside[sa[id].page] = { id: id, reason: sa[id].reason }; });
    var plans = {};
    (catalogue.plans || []).forEach(function(p){ plans[p.id] = p; });
    var out = { at: Date.now(), differ: [], match: [], fresh: [], none: [], unread: [], aside: [] };
    programs.forEach(function(pr){
      var html = pages[pr.path + '/curriculum'];
      if(html == null){ out.unread.push(pr); return; }
      var k = pr.key || pr.path.replace(/%E2%80%8B/gi, '');
      if(aside[k + '/curriculum']){ out.aside.push({ name: pr.name, faculty: pr.faculty, reason: aside[k + '/curriculum'].reason }); return; }
      var page = parsePlan(html), id = byPath[k + '/curriculum'] || byPath[k];
      if(!page.published){ out.none.push({ name: pr.name, faculty: pr.faculty, plan: id || null }); return; }
      if(!id || !plans[id]){ out.fresh.push({ name: pr.name, faculty: pr.faculty, hours: page.degreeHours }); return; }
      var ch = compare(plans[id], page);
      var row = { id: id, name: pr.name, faculty: pr.faculty, path: pr.path, complete: page.complete,
                  sum: page.sum, hours: page.degreeHours, changes: ch, page: page };
      (ch.length ? out.differ : out.match).push(row);
    });
    return out;
  }

  function getText(path){
    return ctx.api('GET', '/api/admin/aaup?path=' + encodeURIComponent(path)).then(function(r){
      if(!r || r.status !== 200 || !r.html) { var e = new Error('aaup.edu answered ' + (r && r.status)); e.blocked = true; throw e; }
      return r.html;
    });
  }

  function runServer(){
    st.phase = 'running'; st.err = ''; st.done = 0; st.total = 0; st.now = 'the program list'; ctx.rerender();
    var programs, pages = {};
    return getText('/academic-programs').then(function(html){
      programs = parsePrograms(html);
      st.total = programs.length; ctx.rerender();
      return programs.reduce(function(p, pr){
        return p.then(function(){
          if(st.phase !== 'running') return null;
          st.now = pr.name; st.done++; ctx.rerender();
          return getText(pr.path + '/curriculum').then(function(h){ pages[pr.path + '/curriculum'] = h; },
                                                       function(){ /* one page failing is listed as unread */ });
        });
      }, Promise.resolve());
    }).then(function(){ return finish(programs, pages); }, function(e){
      st.phase = 'idle';
      if(e.blocked){ st.serverBlocked = true; st.err = 'aaup.edu turned the server away. Use “From your browser” below — it takes about two minutes.'; }
      else st.err = e.message;
      ctx.rerender();
    });
  }

  function finish(programs, pages){
    st.now = 'comparing';
    return fetch('plans.json', { cache: 'no-store' }).then(function(r){ return r.json(); }).then(function(cat){
      st.result = analyse(programs, pages, cat);
      save(st.result);
      st.phase = 'idle'; st.open = null; ctx.rerender();
    });
  }

  function loadFile(file){
    var fr = new FileReader();
    fr.onload = function(){
      try{
        var data = JSON.parse(fr.result);
        if(!data || !data.programs || !data.pages) throw new Error('This is not a file from the aaup.edu script.');
        var pages = {};
        Object.keys(data.pages).forEach(function(p){ if(data.pages[p] && data.pages[p].status === 200) pages[p] = data.pages[p].html; });
        st.phase = 'running'; st.total = data.programs.length; st.done = data.programs.length; ctx.rerender();
        finish(data.programs, pages).catch(function(e){ st.phase = 'idle'; st.err = e.message; ctx.rerender(); });
      }catch(e){ st.err = e.message; ctx.rerender(); }
    };
    fr.readAsText(file);
  }

  // The script for www.aaup.edu. It reads the program list there, then each
  // program's Academic Plan page, at a visitor's pace, and saves one file.
  function script(){
    return [
      '// AAUPath plan check: run on https://www.aaup.edu in the browser console (F12 > Console).',
      '(async () => {',
      '  const D = new DOMParser(), get = async p => (await fetch(p, {credentials: "same-origin"})).text();',
      '  const list = D.parseFromString(await get("/academic-programs"), "text/html");',
      '  const programs = []; let fac = "";',
      '  list.querySelectorAll("h3, h6.field-content a").forEach(el => {',
      '    if (el.tagName === "H3") { fac = el.textContent.trim(); return; }',
      '    const name = el.textContent.replace(/\\u200b/g, "").trim();',
      '    if (/^(Bachelor|Diploma|Advanced Residency|Residency)/.test(name) && !/Graduate/.test(fac))',
      '      programs.push({faculty: fac, name, path: el.getAttribute("href").replace(/^https?:\\/\\/www\\.aaup\\.edu/, "")});',
      '  });',
      '  const pages = {}; let n = 0;',
      '  for (const p of programs) {',
      '    const r = await fetch(p.path + "/curriculum", {credentials: "same-origin"});',
      '    let html = (await r.text()).replace(/<(p|td) class="d-none course-desc">[\\s\\S]*?<\\/\\1>/g, "");',
      '    const i = html.indexOf("curriculum-wrapper");',
      '    pages[p.path + "/curriculum"] = {status: r.status, html: i >= 0 ? html.slice(i - 200) : html.slice(0, 2000)};',
      '    console.log(++n + "/" + programs.length, p.name);',
      '    await new Promise(res => setTimeout(res, 400));',
      '  }',
      '  const a = document.createElement("a");',
      '  a.href = URL.createObjectURL(new Blob([JSON.stringify({savedAt: new Date().toISOString(), programs, pages})], {type: "application/json"}));',
      '  a.download = "aaup-academic-plans.json"; document.body.appendChild(a); a.click();',
      '  console.log("Done: load aaup-academic-plans.json into the Check card.");',
      '})();'
    ].join('\n');
  }

  // ---------------------------------------------------------------- applying one plan
  var CAT = { univReq: 'skills', colgReq: 'math', specReq: 'core', deptReq: 'core', minorReq: 'core',
              supportCourses: 'math', colgElec: 'dept', specElec: 'dept', deptElec: 'dept', minorElec: 'dept' };
  function titleCase(s){ return String(s || '').toLowerCase().replace(/\b([a-z])/g, function(m){ return m.toUpperCase(); })
    .replace(/\b(And|Of|In|For|The|To|With|On)\b/g, function(m){ return m.toLowerCase(); }).replace(/\b(Ai|Ii|Iii|Iv|Ui|Ux|It|Gis)\b/g, function(m){ return m.toUpperCase(); }); }

  function apply(row){
    var uni = 'aaup';
    return ctx.api('GET', '/api/major/' + uni + '/' + row.id).then(function(res){
      var m = res.major, page = row.page;
      var byNum = {};
      m.courses.forEach(function(c){ var n = String(c.courseNumber || ''); if(/^\d{6,}$/.test(n)) (byNum[n] = byNum[n] || []).push(c); });
      var replaced = (m.replaced || []).slice();
      // hours
      Object.keys(page.courses).forEach(function(n){
        var s = page.courses[n];
        if(byNum[n] && s.credits != null) byNum[n].forEach(function(c){ c.creditHours = s.credits; });
      });
      // courses no longer listed (complete pages only)
      var drop = {};
      if(page.complete){
        Object.keys(byNum).forEach(function(n){ if(!page.courses[n]) byNum[n].forEach(function(c){ drop[c.id] = n; }); });
      }
      // courses listed but missing; a renumbered one keeps its place in the plan
      var renamedFrom = {};
      row.changes.forEach(function(ch){ if(ch.kind === 'missing' && ch.renamedFrom) renamedFrom[ch.code] = ch.renamedFrom; });
      Object.keys(page.courses).forEach(function(n){
        if(byNum[n]) return;
        var s = page.courses[n], old = renamedFrom[n] && byNum[renamedFrom[n]] ? byNum[renamedFrom[n]][0] : null;
        m.courses.push({ id: n, courseNumber: n, name: old ? old.name : titleCase(s.name), nameAr: old ? old.nameAr : '',
          creditHours: s.credits || 0, category: old ? old.category : (CAT[s.bucket] || 'core'),
          yearId: old ? old.yearId : '', semester: old ? old.semester : '',
          // carried into the stored plan by the Worker (courseToStored)
          requirement: s.bucket, isElective: !!CAT[s.bucket] && CAT[s.bucket] === 'dept' });
        byNum[n] = [m.courses[m.courses.length - 1]];
        if(old) replaced.push({ old: old.id, new: n });
      });
      m.courses = m.courses.filter(function(c){ return !drop[c.id]; });
      var ids = {}; m.courses.forEach(function(c){ ids[c.id] = c; });
      // prerequisites: the page's, for every course it lists; others keep theirs
      function lecture(n){ var cs = (byNum[n] || []).filter(function(c){ return ids[c.id]; }); return cs.filter(function(c){ return c.id === n; })[0] || cs.filter(function(c){ return !/-lab$/.test(c.id); })[0] || cs[0]; }
      var numOf = {}; m.courses.forEach(function(c){ numOf[c.id] = String(c.courseNumber || ''); });
      var pairs = m.prerequisites.filter(function(p){ return ids[p[0]] && ids[p[1]] && !page.courses[numOf[p[1]]]; });
      Object.keys(page.courses).forEach(function(n){
        var b = lecture(n);
        if(!b) return;
        page.courses[n].prereqs.forEach(function(q){
          var a = lecture(q), mutual = page.courses[q] && page.courses[q].prereqs.indexOf(n) >= 0;
          if(a && q !== n && !mutual) pairs.push([a.id, b.id]);
        });
      });
      m.prerequisites = pairs;
      m.replaced = replaced.filter(function(r){ return ids[r.new] && !ids[r.old]; });
      if(page.degreeHours) m.degreeHours = page.degreeHours;
      return ctx.api('PUT', '/api/major/' + uni + '/' + row.id, { major: m, baseSha: res.sha || '' });
    });
  }

  // ---------------------------------------------------------------- view
  function esc(s){ return ctx.esc(s); }
  function when(t){ return t ? new Date(t).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function count(list){ return list ? list.length : 0; }
  function summary(c){
    var k = { missing: 0, notListed: 0, hours: 0, prereq: 0, degree: 0, renamed: 0 };
    c.forEach(function(x){ if(x.renamedTo) k.renamed++; else if(x.renamedFrom) return; else k[x.kind]++; });
    var out = [];
    if(k.renamed) out.push(k.renamed + ' renumbered');
    if(k.notListed) out.push(k.notListed + ' no longer listed');
    if(k.missing) out.push(k.missing + ' missing');
    if(k.hours) out.push(k.hours + (k.hours === 1 ? ' credit-hour change' : ' credit-hour changes'));
    if(k.prereq) out.push(k.prereq + ' prerequisite' + (k.prereq === 1 ? '' : 's'));
    if(k.degree) out.push('degree total');
    return out.join(' · ');
  }
  var BUCKET = { univReq: 'University requirement', univElec: 'University elective', colgReq: 'College requirement',
                 colgElec: 'College elective', specReq: 'Specialization requirement', specElec: 'Specialization elective',
                 deptReq: 'Department requirement', deptElec: 'Department elective', minorReq: 'Minor requirement',
                 minorElec: 'Minor elective', supportCourses: 'Support course', freeElec: 'Free elective' };
  function names(list, page){
    return list.length ? list.map(function(n){ return (page && page.courses[n] && titleCase(page.courses[n].name)) || n; }).join(', ') : 'none';
  }

  function html(c){
    ctx = c;
    var r = st.result, h = '<h2>Check with aaup.edu</h2>';
    h += '<p class="admin-hint">Reads every program’s Academic Plan page on aaup.edu — courses, credit hours and prerequisites — and lists only what differs from the plans in the app. Nothing changes until you choose “Use aaup.edu” on a plan.' +
         (r ? ' Last check: <b>' + esc(when(r.at)) + '</b>.' : '') + '</p>';
    if(st.err) h += '<div class="admin-note admin-note-warn">' + esc(st.err) + '</div>';
    if(st.phase === 'running'){
      var pc = st.total ? Math.round(st.done / st.total * 100) : 5;
      h += '<div class="pc-card"><b>Checking ' + st.done + ' of ' + (st.total || '…') + '</b> · ' + esc(st.now) +
           '<div class="pc-prog" role="progressbar" aria-valuenow="' + pc + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pc + '%"></i></div>' +
           '<button type="button" class="home-btn" id="pcStop">Stop</button></div>';
      return h;
    }
    if(st.open && r){
      var row = r.differ.filter(function(x){ return x.id === st.open; })[0];
      if(row) return h + detail(row);
    }
    h += '<div class="pc-card"><div class="pc-actions">' +
         '<button type="button" class="home-btn btn-pri" id="pcRun">' + (r ? 'Check again' : 'Check now') + '</button></div>' +
         '<details' + (st.serverBlocked ? ' open' : '') + '><summary>From your browser (when aaup.edu turns the server away)</summary>' +
         '<ol class="admin-hint"><li>On a computer, open <b>www.aaup.edu</b>.</li><li>Press F12, open <b>Console</b>, paste the script and press Enter. It takes about two minutes and downloads <b>aaup-academic-plans.json</b>.</li><li>Load that file here.</li></ol>' +
         '<div class="pc-actions"><button type="button" class="home-btn" id="pcCopyScript">Copy the script</button>' +
         '<label class="home-btn">Load the file<input type="file" id="pcFile" accept="application/json,.json" hidden></label></div></details></div>';
    if(!r) return h;
    var k = kept();
    var differ = r.differ.filter(function(x){ return k[x.id] !== sig(x.changes); });
    h += '<div class="pc-chips">' +
         chip('ok', count(r.match) + (r.differ.length - differ.length), 'match aaup.edu') +
         chip('warn', differ.length, 'plans differ') +
         chip('new', count(r.fresh), 'new on aaup.edu') +
         chip('none', count(r.none), 'no plan published') + '</div>';
    if(differ.length){
      h += '<h3 class="pc-h">Differ</h3>' + differ.map(function(x){
        return '<button type="button" class="pc-item" data-pc-open="' + esc(x.id) + '"><span class="pc-dot pc-warn"></span><span class="pc-t"><b>' + esc(x.name.replace(/^Bachelor in /, '')) +
               '</b><small>' + esc(summary(x.changes)) + (x.complete ? '' : ' · page incomplete') + '</small></span><span class="pc-go">Open ›</span></button>';
      }).join('');
    }
    if(count(r.fresh)) h += '<h3 class="pc-h">New on aaup.edu</h3>' + r.fresh.map(function(x){
      return '<div class="pc-item"><span class="pc-dot pc-new"></span><span class="pc-t"><b>' + esc(x.name) + '</b><small>' + esc(x.faculty) + (x.hours ? ' · ' + x.hours + ' CH' : '') + ' · not in the app — ask Claude to add it</small></span></div>';
    }).join('');
    if(count(r.none)) h += '<h3 class="pc-h">No plan published yet</h3>' + r.none.map(function(x){
      return '<div class="pc-item"><span class="pc-dot pc-none"></span><span class="pc-t"><b>' + esc(x.name) + '</b><small>' + esc(x.faculty) + ' · the page lists no courses</small></span></div>';
    }).join('');
    if(count(r.aside)) h += '<h3 class="pc-h">Set aside</h3>' + r.aside.map(function(x){
      return '<div class="pc-item"><span class="pc-dot pc-none"></span><span class="pc-t"><b>' + esc(x.name) + '</b><small>' + esc(x.reason) + '</small></span></div>';
    }).join('');
    if(count(r.unread)) h += '<p class="admin-hint">' + r.unread.length + ' page(s) could not be read: ' + esc(r.unread.map(function(x){ return x.name; }).join(', ')) + '.</p>';
    h += '<div class="pc-actions"><button type="button" class="home-btn" id="pcCopyAll">Copy all changes</button></div>';
    return h;
  }
  function chip(kind, n, label){ return '<div class="pc-chip pc-' + kind + '"><b>' + n + '</b><span>' + label + '</span></div>'; }

  function detail(row){
    var h = '<div class="pc-actions"><button type="button" class="home-btn" id="pcBack">‹ All plans</button></div>' +
            '<h3>' + esc(row.name) + '</h3><p class="admin-hint">aaup.edu page: ' + esc(row.path) + '/curriculum' +
            (row.complete ? '' : ' · its tables add up to ' + row.sum + ' of the ' + row.hours + ' hours it states, so only the courses it lists are compared') +
            '</p><div id="pcHistory" class="admin-hint"></div>';
    row.changes.forEach(function(c){
      if(c.renamedFrom) return;
      var head, app, site;
      if(c.kind === 'missing'){ head = 'Missing'; app = 'Not in the plan'; site = (BUCKET[c.site.bucket] || c.site.bucket || '') + ' · ' + (c.site.credits || 0) + ' CH' + (c.site.prereqs.length ? ' · needs ' + names(c.site.prereqs, row.page) : ''); }
      else if(c.kind === 'notListed' && c.renamedTo){ head = 'Renumbered'; app = c.code; site = c.renamedTo + ' (students keep their pass: it is saved as a replaced course)'; }
      else if(c.kind === 'notListed'){ head = 'Not on aaup.edu'; app = 'In the plan'; site = 'Not in this plan'; }
      else if(c.kind === 'hours'){ head = 'Credit hours'; app = c.app + ' CH'; site = c.site + ' CH'; }
      else if(c.kind === 'prereq'){ head = 'Prerequisites'; app = names(c.app, row.page); site = names(c.site, row.page); }
      else { head = 'Degree total'; app = c.app + ' CH'; site = c.site + ' CH'; }
      h += '<div class="pc-diff"><div class="pc-dh">' + esc(c.name ? titleCase(c.name) : head) + (c.code ? ' <code>' + esc(c.code) + '</code>' : '') + ' <span class="pc-pill">' + esc(head) + '</span></div>' +
           '<div class="pc-dr"><span>App</span><span class="pc-was">' + esc(app) + '</span><span>aaup.edu</span><span class="pc-now">' + esc(site) + '</span></div></div>';
    });
    h += '<div class="pc-actions"><button type="button" class="home-btn btn-pri" id="pcApply">Use aaup.edu for this plan</button>' +
         '<button type="button" class="home-btn" id="pcKeep">Keep the app’s</button></div>' +
         '<p class="admin-hint">“Use aaup.edu” saves this plan like an edit in the plan editor; it is live for everyone in about a minute. Requirement-hour totals and Arabic names of new courses are not changed here.</p>';
    return h;
  }

  function report(){
    var r = st.result, lines = ['AAUPath plan check, ' + when(r.at)];
    r.differ.forEach(function(x){
      lines.push('', x.name + ' (' + x.id + ')' + (x.complete ? '' : ' [page incomplete]'));
      x.changes.forEach(function(c){
        if(c.renamedFrom) return;
        if(c.kind === 'missing') lines.push('  + missing ' + c.code + ' ' + c.name + ' (' + c.site.credits + ' CH, ' + (BUCKET[c.site.bucket] || c.site.bucket) + ')');
        else if(c.kind === 'notListed') lines.push('  - ' + c.code + ' ' + c.name + (c.renamedTo ? ' renumbered to ' + c.renamedTo : ' not on aaup.edu'));
        else if(c.kind === 'hours') lines.push('  ~ ' + c.code + ' ' + c.name + ': ' + c.app + ' -> ' + c.site + ' CH');
        else if(c.kind === 'prereq') lines.push('  ~ ' + c.code + ' ' + c.name + ' prerequisites: [' + c.app.join(', ') + '] -> [' + c.site.join(', ') + ']');
        else lines.push('  ~ degree total ' + c.app + ' -> ' + c.site);
      });
    });
    if(r.fresh.length){ lines.push('', 'New on aaup.edu:'); r.fresh.forEach(function(x){ lines.push('  ' + x.name + ' (' + x.faculty + ')'); }); }
    if(r.none.length){ lines.push('', 'No plan published:'); r.none.forEach(function(x){ lines.push('  ' + x.name); }); }
    return lines.join('\n');
  }

  function copy(text, done){
    var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject();
    p.then(function(){ ctx.toast(done); }, function(){
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); ctx.toast(done); }catch(e){ ctx.toast('Select and copy it by hand.'); }
      ta.remove();
    });
  }

  function bind(main, c){
    ctx = c;
    function on(id, ev, fn){ var el = main.querySelector('#' + id); if(el) el.addEventListener(ev, fn); }
    on('pcRun', 'click', runServer);
    on('pcStop', 'click', function(){ st.phase = 'idle'; ctx.rerender(); });
    on('pcCopyScript', 'click', function(){ copy(script(), 'Script copied. Paste it in the Console on www.aaup.edu.'); });
    on('pcFile', 'change', function(e){ if(e.target.files && e.target.files[0]) loadFile(e.target.files[0]); });
    on('pcCopyAll', 'click', function(){ copy(report(), 'Copied. Paste it to Claude to apply or explain.'); });
    on('pcBack', 'click', function(){ st.open = null; ctx.rerender(); });
    main.querySelectorAll('[data-pc-open]').forEach(function(b){
      b.addEventListener('click', function(){ st.open = b.getAttribute('data-pc-open'); ctx.rerender(); });
    });
    if(st.open){
      var row = st.result.differ.filter(function(x){ return x.id === st.open; })[0];
      // who changed this plan last - a dean's save says "staff <username>"
      ctx.api('GET', '/api/history/aaup/' + st.open).then(function(res){
        var c = (res.commits || [])[0], el = main.querySelector('#pcHistory');
        if(!c || !el) return;
        var by = /^staff ([^:]+):/.exec(c.message || '');
        el.textContent = 'Last changed ' + when(Date.parse(c.date)) + (by ? ' by ' + by[1] + ' (staff)' : '') + '.';
      }, function(){ /* history is a nice-to-have */ });
      on('pcKeep', 'click', function(){ keep(row.id, sig(row.changes)); st.open = null; ctx.rerender(); });
      on('pcApply', 'click', function(e){
        var b = e.target; b.disabled = true; b.textContent = 'Saving…';
        apply(row).then(function(){
          st.result.differ = st.result.differ.filter(function(x){ return x.id !== row.id; });
          st.result.match.push({ id: row.id, name: row.name });
          save(st.result); st.open = null; ctx.toast('Saved. Live for everyone in about a minute.'); ctx.rerender();
        }, function(err){ b.disabled = false; b.textContent = 'Use aaup.edu for this plan'; st.err = err.message; ctx.rerender(); });
      });
    }
  }

  window.AdminPlanCheck = { html: html, bind: bind, _parsePlan: parsePlan, _compare: compare, _parsePrograms: parsePrograms, _script: script };
})();
