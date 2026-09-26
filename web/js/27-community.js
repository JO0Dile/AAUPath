// ==========================
// COMMUNITY DATA (anonymous, aggregated course feedback)
// ==========================
(function(){
  function loadCommunity(){
    return window.AAUP_STORAGE.getJSON('aaup_community_feedback', {});
  }
  function saveCommunity(m){
    window.AAUP_STORAGE.setJSON('aaup_community_feedback', m);
  }
  function knownCourseIds(){
    var ids = {};
    (window.__PLANS || []).forEach(function(prefix){
      var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
      Object.keys(info).forEach(function(slug){ ids[slug] = true; });
    });
    // Imported plans keep their own separate course list (see the Imported
    // Plans module) rather than registering into window.__PLAN_DATA, so
    // they need to be folded in here explicitly too.
    try{
      var imported = JSON.parse(localStorage.getItem('aaup_importedPlans') || '{}') || {};
      Object.keys(imported).forEach(function(planId){
        (imported[planId].courses || []).forEach(function(c){ if(c && c.id){ ids[c.id] = true; } });
      });
    }catch(e){}
    return ids;
  }

  // Privacy: only ever reads parsed.feedback — studentName / studentGPA /
  // studentGender / submittedAt from the pasted email body are never
  // touched, let alone stored. Unknown course ids are skipped and reported,
  // not silently dropped.
  function importFeedback(jsonText){
    var parsed;
    try{ parsed = JSON.parse(jsonText); }
    catch(e){ return { ok: false, error: 'Invalid JSON format. Please check your copy.' }; }

    var feedback = parsed && parsed.feedback;
    if(!Array.isArray(feedback)){
      return { ok: false, error: 'Invalid JSON format. Please check your copy.' };
    }

    var known = knownCourseIds();
    var community = loadCommunity();
    var warnings = [];
    var importedCount = 0;

    feedback.forEach(function(item){
      if(!item || typeof item.courseId !== 'string' || item.difficulty === undefined){
        warnings.push('Skipped a malformed entry.');
        return;
      }
      if(!known[item.courseId]){
        // courseId is straight out of a pasted email and this warning is
        // rendered via innerHTML — escape it like any other foreign text.
        warnings.push('Skipped unknown course: ' + window.__escapeHtml(String(item.courseId).slice(0, 60)));
        return;
      }
      var entry = community[item.courseId] || { totalDifficulty: 0, difficultyVotes: 0, workloadCounts: {}, sampleNotes: [] };
      if(typeof item.difficulty === 'number' && item.difficulty > 0){
        entry.totalDifficulty += item.difficulty;
        entry.difficultyVotes += 1;
      }
      // Whitelisted, not just escaped: workload becomes an object KEY that
      // later lands in innerHTML (the ⚡ badge), and the app only has
      // meaning for these three values anyway.
      if(['Easy','Medium','Hard'].indexOf(item.workload) !== -1){
        entry.workloadCounts[item.workload] = (entry.workloadCounts[item.workload] || 0) + 1;
      }
      if(item.note && String(item.note).trim()){
        // Notes render inside the 📝 popover via innerHTML — a student
        // email is exactly as untrusted as the network feed, so they get
        // the same escape-at-the-boundary treatment.
        entry.sampleNotes.push(window.__cleanText(String(item.note).trim().slice(0, 200)));
        if(entry.sampleNotes.length > 5){ entry.sampleNotes = entry.sampleNotes.slice(-5); }
      }
      community[item.courseId] = entry;
      importedCount++;
    });

    saveCommunity(community);
    refreshAllCommunityBadges();
    return { ok: true, imported: importedCount, warnings: warnings };
  }

  function summarize(entry){
    var avgDifficulty = entry.difficultyVotes ? (entry.totalDifficulty / entry.difficultyVotes) : null;
    var topWorkload = null, topCount = 0;
    Object.keys(entry.workloadCounts || {}).forEach(function(w){
      if(entry.workloadCounts[w] > topCount){ topCount = entry.workloadCounts[w]; topWorkload = w; }
    });
    return { avgDifficulty: avgDifficulty, topWorkload: topWorkload, topCount: topCount, notes: entry.sampleNotes || [] };
  }

  function refreshCardBadge(prefix, slug){
    var community = loadCommunity();
    var entry = community[slug];
    var el = document.getElementById(prefix + '-c-' + slug);
    if(!el) return;
    var row = el.querySelector('.community-badge-row');
    if(!entry){
      if(row) row.remove();
      return;
    }
    var s = summarize(entry);
    var html = '';
    if(s.avgDifficulty !== null){ html += '<span class="meta-badge">' + window.AAUP_ICONS.preview('star', 11) + s.avgDifficulty.toFixed(1) + '</span>'; }
    if(s.topWorkload){ html += '<span class="meta-badge">' + window.AAUP_ICONS.preview('bolt', 11) + s.topWorkload + ' (' + s.topCount + ')</span>'; }
    if(s.notes.length){ html += '<span class="meta-badge" data-notes-for="' + prefix + '-c-' + slug + '">' + window.AAUP_ICONS.preview('pen', 11) + s.notes.length + '</span>'; }
    if(!html){ if(row) row.remove(); return; }
    if(!row){ row = document.createElement('div'); row.className = 'community-badge-row'; el.appendChild(row); }
    row.innerHTML = html;
  }

  function refreshAllCommunityBadges(){
    // window.__PLANS is only the four hardcoded majors (js/11-module11.js)
    // — every imported/feed-synced plan (which is most of them) registers
    // into window.__PLAN_DATA the same way but was never in that list, so
    // this silently never refreshed a single badge for any of them. Every
    // currently-registered plan is the right set, not a hardcoded four.
    Object.keys(window.__PLAN_DATA || {}).forEach(function(prefix){
      var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
      Object.keys(info).forEach(function(slug){ refreshCardBadge(prefix, slug); });
    });
    bindNotePopovers();
  }

  function bindNotePopovers(){
    document.querySelectorAll('[data-notes-for]').forEach(function(badge){
      if(badge.getAttribute('data-bound') === '1') return;
      badge.setAttribute('data-bound', '1');
      badge.addEventListener('click', function(e){
        e.stopPropagation();
        var id = badge.getAttribute('data-notes-for');
        var parts = window.__splitCourseId(id);
        var community = loadCommunity();
        var entry = parts && community[parts.slug];
        showNotesPopover(badge, entry ? entry.sampleNotes : []);
      });
    });
  }

  function showNotesPopover(anchor, notes){
    var existing = document.querySelector('.community-notes-popover');
    if(existing) existing.remove();
    var pop = document.createElement('div');
    pop.className = 'community-notes-popover';
    var rect = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, rect.left) + 'px';
    pop.style.top = (rect.bottom + 6) + 'px';
    var html = '<button type="button" class="cnp-close" aria-label="Close">&times;</button>';
    if(notes && notes.length){
      notes.forEach(function(n){ html += '<div class="cnp-note">\u201c' + n + '\u201d</div>'; });
    } else {
      html += '<div class="cnp-note">No sample notes yet.</div>';
    }
    pop.innerHTML = html;
    document.body.appendChild(pop);
    pop.querySelector('.cnp-close').addEventListener('click', function(){ pop.remove(); });
    setTimeout(function(){
      document.addEventListener('click', function onDoc(e){
        if(!pop.contains(e.target)){ pop.remove(); document.removeEventListener('click', onDoc); }
      });
    }, 0);
  }

  // ---- live pooling (workers/ratings-worker.js) --------------------------
  //
  // Everything above this point works the way it always has: a maintainer
  // pastes an aggregated feedback file, and it shows as badges. This adds a
  // second, live source feeding the exact same badges — the difficulty
  // stars and workload buttons a student already sets for themselves
  // (js/21-course-modal-extras.js) now also, quietly, contribute to a
  // pooled number for that course. Nothing new to fill in; the rating
  // itself is the only thing shared, same shape as importFeedback already
  // handled, so summarize()/refreshCardBadge() need no changes at all.

  function ratingsUrl(){ return (window.APP_RATINGS_URL || '').replace(/\/+$/, ''); }
  function deviceId(){ return window.__deviceId ? window.__deviceId() : 'd-anon'; }

  // A study-plan page re-renders on every single course toggle — syncLive()
  // is called from that same post-render hook, so without this it would
  // refetch the whole plan's ratings on every click. Once per plan per
  // 5 minutes is plenty for numbers that only move when someone else rates
  // something.
  var lastSyncAt = {};
  var SYNC_COOLDOWN_MS = 5 * 60 * 1000;
  // Pooled ratings are the one feature here that needs a server, and the app
  // is designed to work without one. When the endpoint answers with an error
  // there is no point asking it again: a Worker deployed without its KV
  // namespace bound answers 500 to every request, forever, and a plan with
  // 200 courses asks in four batches — so one misconfiguration produced four
  // failed requests on every plan open, which is what the diagnostics screen
  // was reporting. One failure now stands the feature down for the session.
  var liveDown = false;

  function mergeLiveAggregate(courseId, agg, community){
    if(!agg) return;
    var entry = community[courseId] || { totalDifficulty: 0, difficultyVotes: 0, workloadCounts: {}, sampleNotes: [] };
    if(agg.avgDifficulty != null && agg.difficultyVotes){
      entry.totalDifficulty = agg.avgDifficulty * agg.difficultyVotes;
      entry.difficultyVotes = agg.difficultyVotes;
    }
    if(agg.workloadCounts) entry.workloadCounts = agg.workloadCounts;
    entry.inProgressCount = agg.inProgressCount || 0;
    community[courseId] = entry;
  }

  // Pulls pooled numbers for every course in this plan, in batches (the
  // Worker caps how many course ids one request can ask for). Merges into
  // the same local map the pasted-feedback path writes, so a device that
  // has both a manually-imported snapshot AND a live Worker configured
  // shows the live numbers without losing sample notes only the pasted
  // file carries.
  function syncLive(prefix){
    var url = ratingsUrl();
    var ids = Object.keys((window.__PLAN_DATA[prefix] || {}).courseInfo || {});
    if(!url || !ids.length || liveDown) return Promise.resolve();
    var now = Date.now();
    if(lastSyncAt[prefix] && now - lastSyncAt[prefix] < SYNC_COOLDOWN_MS) return Promise.resolve();
    lastSyncAt[prefix] = now;
    var CHUNK = 60;
    var chunks = [];
    for(var i = 0; i < ids.length; i += CHUNK){ chunks.push(ids.slice(i, i + CHUNK)); }
    return chunks.reduce(function(chain, chunk){
      return chain.then(function(){
        // Every batch after a failed one fails the same way — the endpoint
        // does not become reachable three requests later. Stop asking.
        if(liveDown) return null;
        return fetch(url + '/ratings?courses=' + encodeURIComponent(chunk.join(',')))
          .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(data){
            var community = loadCommunity();
            Object.keys(data.ratings || {}).forEach(function(id){ mergeLiveAggregate(id, data.ratings[id], community); });
            saveCommunity(community);
          }).catch(function(){ liveDown = true; });
      });
    }, Promise.resolve()).then(function(){ refreshAllCommunityBadges(); });
  }

  // Sends this device's CURRENT difficulty/workload/status for one course —
  // always all three together, since the Worker stores one row per device
  // and replaces it wholesale on every write. Sending only whichever field
  // just changed would silently erase the other two from the pooled count.
  function pingRating(prefix, courseId){
    var url = ratingsUrl();
    if(!url || !courseId || liveDown) return;
    var pid = window.AAUP_GPA ? window.AAUP_GPA.primaryId(prefix, courseId) : courseId;
    var ratings = (window.AAUP_PERSONAL ? window.AAUP_PERSONAL.loadRatings() : {})[pid] || {};
    var statuses = window.AAUP_GPA ? window.AAUP_GPA.loadStatuses() : {};
    fetch(url + '/ratings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: courseId, deviceId: deviceId(),
        difficulty: ratings.difficulty || null,
        workload: ratings.workload || null,
        status: statuses[pid] || null
      })
    }).then(function(r){ if(!r.ok) liveDown = true; })
      .catch(function(){ liveDown = true; });
  }

  window.AAUP_COMMUNITY = {
    importFeedback: importFeedback,
    refreshAllCommunityBadges: refreshAllCommunityBadges,
    loadCommunity: loadCommunity,
    syncLive: syncLive,
    pingRating: pingRating
  };

  function init(){ refreshAllCommunityBadges(); }
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
