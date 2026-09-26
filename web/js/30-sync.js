// ==========================
// ONLINE SYNC — pulls new/updated official plans from APP_PLANS_FEED_URL
// ==========================
// This is the one place text from OUTSIDE the user's own browser enters the
// app (every other imported plan came from a file the user personally chose
// to open). Every string field is HTML-escaped and every id is re-slugified
// to a safe [a-z0-9-]+ shape before it ever reaches the same render paths
// AAUP_IMPORTED already uses — those paths interpolate plan data into
// innerHTML/attribute strings without re-checking it, which is fine for a
// user's own data (self-XSS at worst) but not for data that arrived over
// the network on behalf of every user of the feed.
(function(){
  function safeId(s, fallback){
    var out = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return out || fallback || ('x-' + Math.random().toString(36).slice(2, 8));
  }
  function esc(s){ return window.__escapeHtml(s); }
  function escName(n){
    if(!n) return { big: '', small: '' };
    if(typeof n === 'object') return { big: esc(n.big || ''), small: esc(n.small || '') };
    return { big: esc(n), small: '' };
  }
  var CATS = ['skills','core','math','dept','eng','uni','free'];

  function sanitizePlan(fp){
    if(!fp || !fp.id || !fp.majorName) return null;
    var id = safeId(fp.id);
    var university = (window.APP_UNIVERSITIES && window.APP_UNIVERSITIES[fp.university]) ? fp.university : 'aaup';
    var years = Array.isArray(fp.structure && fp.structure.years) ? fp.structure.years.map(function(y){
      return { id: safeId(y.id, 'y1'), hasSummer: !!y.hasSummer };
    }) : [{ id: 'y1', hasSummer: false }];
    var yearIds = years.map(function(y){ return y.id; });
    var courses = Array.isArray(fp.courses) ? fp.courses.slice(0, 400).map(function(c){
      var out = {
        id: safeId(c.id), name: esc(c.name || c.id || ''), ar: esc(c.ar || ''),
        creditHours: Math.max(0, Math.min(20, Number(c.creditHours) || 0)),
        category: CATS.indexOf(c.category) !== -1 ? c.category : 'core',
        // A course with no year is not a course in year one — it is an
        // elective the student picks, and the plan deliberately does not say
        // when. Forcing it to yearIds[0] is what dumped every department
        // elective into Year 1 Semester 1, mixed in with the required courses
        // and with no way to tell them apart. Empty is preserved and the
        // renderer gives them their own section.
        yearId: yearIds.indexOf(safeId(c.yearId)) !== -1 ? safeId(c.yearId) : '',
        // "summer" is a friendly alias for the renderer's s3 summer slot —
        // normalize so a feed plan's summer courses actually render.
        semester: (c.semester == null || c.semester === '')
          ? ''
          : (window.__normalizeSemester ? window.__normalizeSemester(c.semester) : (['s1','s2'].indexOf(c.semester) !== -1 ? c.semester : 's1'))
      };
      // The real catalog code (e.g. "100411010") — was silently dropped by
      // this sanitizer even though __sanitizeImportedPlan (the other entry
      // point, for manually-pasted/imported plans) already preserved it;
      // every course synced from the online feed showed "-" for its course
      // number in the popup and couldn't be found by searching its code.
      if(c.courseNumber != null){ out.courseNumber = esc(String(c.courseNumber)).slice(0, 30); }
      // The university's requirement bucket. Like courseNumber above, this
      // sanitizer is a strict whitelist, so a field that is not named here is
      // silently dropped — which is exactly how every synced course lost its
      // course number once already.
      if(window.__REQUIREMENT_KEYS && window.__REQUIREMENT_KEYS.indexOf(c.requirement) !== -1){
        out.requirement = c.requirement;
      }
      // Whether this course's TERM came from the published plan or was picked
      // by the app (see tools/build-catalogue.py). Named here for the same
      // reason the two above are: this whitelist drops anything it does not
      // know, and every plan on the home screen arrives through it.
      if(c.termSuggested){ out.termSuggested = true; }
      return out;
    }) : [];
    var prerequisites = Array.isArray(fp.prerequisites) ? fp.prerequisites.slice(0, 800).map(function(pair){
      return [safeId(pair[0]), safeId(pair[1])];
    }).filter(function(pair){ return pair[0] && pair[1]; }) : [];
    return {
      id: id,
      majorName: { en: escName(fp.majorName.en), ar: escName(fp.majorName.ar) },
      icon: String(fp.icon || '🎓').slice(0, 8),
      // The two newer icon layers have to survive this sanitizer or every
      // synced plan would fall back to its emoji. iconKey is checked against
      // the built-in set rather than escaped — it is an enum, not text — and
      // imageUrl goes through the same URL guard the renderer uses.
      iconKey: (window.AAUP_ICONS && window.AAUP_ICONS.has(fp.iconKey)) ? fp.iconKey : '',
      imageUrl: window.AAUP_ICONS ? window.AAUP_ICONS.safeImageUrl(fp.imageUrl) : '',
      bio: { en: esc(fp.bio && fp.bio.en), ar: esc(fp.bio && fp.bio.ar) },
      college: { en: esc(fp.college && fp.college.en), ar: esc(fp.college && fp.college.ar) },
      // Where this plan sits among its faculty's tiles. A number or null, never
      // text — it is only ever compared, so it does not go through esc().
      sortOrder: (fp.sortOrder == null || fp.sortOrder === '' || !isFinite(Number(fp.sortOrder)))
        ? null : Number(fp.sortOrder),
      university: university,
      structure: { years: years },
      courses: courses,
      prerequisites: prerequisites,
      requirementHours: window.__cleanRequirementHours
        ? window.__cleanRequirementHours(fp.requirementHours) : {},
      official: true,
      feedVersion: Number(fp.version) || 1,
      importedAt: new Date().toISOString()
    };
  }

  function fetchFeed(){
    if(!window.APP_PLANS_FEED_URL || typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(window.APP_PLANS_FEED_URL, { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; });
  }

  // ---------------------------------------------------------------------
  // What changed, in words a student can act on
  // ---------------------------------------------------------------------
  // Only structural facts are listed. "Something changed" is not a decision
  // anyone can make, and a raw JSON diff is not either.
  function diffPlans(oldP, newP){
    var out = [];
    var byId = function(list){
      var m = {};
      (list || []).forEach(function(c){ m[c.id] = c; });
      return m;
    };
    var a = byId(oldP.courses), b = byId(newP.courses);
    var label = function(c){ return (c.courseNumber ? c.courseNumber + ' · ' : '') + (c.name || c.id); };

    Object.keys(b).forEach(function(id){ if(!a[id]) out.push({ kind: 'add', text: 'Adds ' + label(b[id])}); });
    Object.keys(a).forEach(function(id){ if(!b[id]) out.push({ kind: 'remove', text: 'Removes ' + label(a[id])}); });

    Object.keys(b).forEach(function(id){
      if(!a[id]) return;
      var o = a[id], n = b[id];
      if(o.creditHours !== n.creditHours){
        out.push({ kind: 'change', text: label(n) + ': credit hours ' + o.creditHours + ' → ' + n.creditHours });
      }
      if(o.yearId !== n.yearId || o.semester !== n.semester){
        out.push({ kind: 'move', text: label(n) + ': moved to ' + n.yearId + ' ' + semLabel(n.semester) });
      }
      if(o.name !== n.name){ out.push({ kind: 'rename', text: 'Renamed “' + o.name + '” → “' + n.name + '”' }); }
    });

    var key = function(p){ return p[0] + '>' + p[1]; };
    var oldPr = {}, newPr = {};
    (oldP.prerequisites || []).forEach(function(p){ oldPr[key(p)] = p; });
    (newP.prerequisites || []).forEach(function(p){ newPr[key(p)] = p; });
    Object.keys(newPr).forEach(function(k){
      if(!oldPr[k]) out.push({ kind: 'prereq', text: 'New prerequisite: ' + nameIn(b, newPr[k][0]) + ' before ' + nameIn(b, newPr[k][1]) });
    });
    Object.keys(oldPr).forEach(function(k){
      if(!newPr[k]) out.push({ kind: 'prereq', text: 'Dropped prerequisite: ' + nameIn(a, oldPr[k][0]) + ' before ' + nameIn(a, oldPr[k][1]) });
    });

    var oy = (oldP.structure && oldP.structure.years || []).length;
    var ny = (newP.structure && newP.structure.years || []).length;
    if(oy !== ny) out.push({ kind: 'structure', text: 'Plan length changes from ' + oy + ' to ' + ny + ' years' });
    return out;
  }

  function semLabel(s){ return s === 's1' ? 'Semester 1' : s === 's2' ? 'Semester 2' : 'Summer'; }
  function nameIn(map, id){ return map[id] ? (map[id].name || id) : id; }

  // Icons, logos and blurbs are published presentation, not the student's
  // work — nothing in the app lets them edit these — so they are refreshed
  // even on a customized plan, with no prompt. This is what keeps a rebranded
  // icon from being held hostage by an unrelated pending decision about
  // courses.
  var COSMETIC = ['icon', 'iconKey', 'imageUrl', 'bio', 'college', 'majorName', 'sortOrder', 'feedVersion'];
  function applyCosmetic(existing, sanitized){
    var changed = false;
    COSMETIC.forEach(function(f){
      if(f === 'feedVersion') return;
      if(JSON.stringify(existing[f]) !== JSON.stringify(sanitized[f])){
        existing[f] = sanitized[f];
        changed = true;
      }
    });
    return changed;
  }

  function applyFeed(feed){
    var result = { added: 0, updated: 0, pending: 0, cosmetic: 0 };
    if(!feed || !Array.isArray(feed.plans) || !window.AAUP_IMPORTED) return result;
    var local = window.AAUP_IMPORTED.loadImportedPlans();
    var awaiting = [];

    feed.plans.forEach(function(fp){
      var sanitized = sanitizePlan(fp);
      if(!sanitized) return;
      var existing = local[sanitized.id];

      if(!existing){
        local[sanitized.id] = sanitized;
        result.added++;
        return;
      }
      if(!existing.official){
        // A plan the student built themselves that happens to share an id.
        // Not ours to touch at all.
        return;
      }
      if((existing.feedVersion || 0) >= sanitized.feedVersion) return;

      if(!existing.wasEdited){
        local[sanitized.id] = sanitized;
        result.updated++;
        return;
      }

      // Customized. Presentation refreshes now; structure waits for a yes.
      if(applyCosmetic(existing, sanitized)) result.cosmetic++;
      var changes = diffPlans(existing, sanitized);
      if(changes.length){
        awaiting.push({ id: sanitized.id, incoming: sanitized, changes: changes });
        result.pending++;
      } else {
        // Nothing structural actually differs, so there is nothing to ask
        // about — take the new version number so this stops re-triggering.
        existing.feedVersion = sanitized.feedVersion;
        result.updated++;
      }
    });

    if(result.added || result.updated || result.cosmetic || result.pending){
      window.AAUP_IMPORTED.saveImportedPlans(local);
    }
    if(awaiting.length) queueConsent(awaiting);
    return result;
  }

  // ---------------------------------------------------------------------
  // The consent dialog
  // ---------------------------------------------------------------------
  // One plan at a time. Two plans' worth of changes in one dialog is a choice
  // nobody reads, and these are irreversible in the direction that matters:
  // "Apply" replaces work the student did by hand.
  var consentQueue = [];
  var consentOpen = false;

  function queueConsent(items){
    items.forEach(function(it){
      if(!consentQueue.some(function(q){ return q.id === it.id; })) consentQueue.push(it);
    });
    showNextConsent();
  }

  function showNextConsent(){
    if(consentOpen || !consentQueue.length) return;
    // Never interrupt a tour, the assistant mid-answer, or another dialog.
    if(document.querySelector('.modal-overlay.open, .dialog-overlay.open')) {
      setTimeout(showNextConsent, 4000);
      return;
    }
    consentOpen = true;
    var item = consentQueue[0];
    var plans = window.AAUP_IMPORTED.loadImportedPlans();
    var plan = plans[item.id];
    var name = plan && plan.majorName ? ((plan.majorName.en && plan.majorName.en.big) || item.id) : item.id;

    var el = document.createElement('div');
    el.className = 'sync-consent-overlay open';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');

    var box = document.createElement('div');
    box.className = 'sync-consent';

    var h = document.createElement('h3');
    h.textContent = 'The official ' + name + ' plan was updated';
    box.appendChild(h);

    var p = document.createElement('p');
    p.className = 'sync-consent-lead';
    p.textContent = 'You have made your own changes to this plan, so nothing has been altered. ' +
      'Here is what the official version changed:';
    box.appendChild(p);

    var ul = document.createElement('ul');
    ul.className = 'sync-consent-list';
    item.changes.slice(0, 40).forEach(function(c){
      var li = document.createElement('li');
      li.className = 'sync-change sync-change-' + c.kind;
      li.textContent = c.text;
      ul.appendChild(li);
    });
    box.appendChild(ul);
    if(item.changes.length > 40){
      var more = document.createElement('p');
      more.className = 'sync-consent-more';
      more.textContent = '…and ' + (item.changes.length - 40) + ' more.';
      box.appendChild(more);
    }

    var warn = document.createElement('p');
    warn.className = 'sync-consent-warn';
    warn.textContent = 'Applying replaces this plan\'s courses and prerequisites with the official version. ' +
      'Your completed-course ticks, grades and notes are kept.';
    box.appendChild(warn);

    var actions = document.createElement('div');
    actions.className = 'sync-consent-actions';

    var apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'home-btn sync-consent-apply';
    apply.textContent = 'Apply changes to my plan';
    apply.addEventListener('click', function(){ resolveConsent(item, true, el); });

    var keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'home-btn';
    keep.textContent = 'Keep my current version';
    keep.addEventListener('click', function(){ resolveConsent(item, false, el); });

    actions.appendChild(apply);
    actions.appendChild(keep);
    box.appendChild(actions);
    el.appendChild(box);
    document.body.appendChild(el);
    apply.focus();
  }

  function resolveConsent(item, accept, el){
    var plans = window.AAUP_IMPORTED.loadImportedPlans();
    var existing = plans[item.id];
    if(existing){
      if(accept){
        // Progress lives in its own storage keyed by course id, so replacing
        // the plan definition does not touch it — a course that survives the
        // update keeps its tick, its grade and its notes.
        var incoming = item.incoming;
        incoming.wasEdited = false;
        plans[item.id] = incoming;
      } else {
        // Record that this version was declined, so the same dialog does not
        // reappear on every single page load for a decision already made.
        existing.feedVersion = item.incoming.feedVersion;
        existing.declinedVersion = item.incoming.feedVersion;
      }
      window.AAUP_IMPORTED.saveImportedPlans(plans);
    }
    if(el && el.parentNode) el.parentNode.removeChild(el);
    consentQueue = consentQueue.filter(function(q){ return q.id !== item.id; });
    consentOpen = false;
    if(window.__showToast){
      window.__showToast(accept ? 'Updated to the official plan.' : 'Kept your version.');
    }
    if(accept) window.AAUP_IMPORTED.plansChanged();
    showNextConsent();
  }

  function lastSyncLabel(){
    var t = 0;
    try{ t = parseInt(localStorage.getItem('aaup_lastSync') || '0', 10) || 0; }catch(e){}
    if(!t) return 'Never checked yet.';
    var mins = Math.round((Date.now() - t) / 60000);
    if(mins < 1) return 'Last checked just now.';
    if(mins < 60) return 'Last checked ' + mins + ' min ago.';
    var hrs = Math.round(mins / 60);
    if(hrs < 24) return 'Last checked ' + hrs + 'h ago.';
    return 'Last checked ' + Math.round(hrs / 24) + 'd ago.';
  }

  // Two startup paths reach checkForUpdates(false): the catalogue boot chain
  // hands the freshly read plans over (01-catalogue.js), and this module's own
  // load init fires independently. That meant three plans.json downloads per
  // cold start and two applyFeed passes over identical data. An automatic check
  // is only worth doing once per page load, so the first one is shared; a
  // manual check from Settings always runs fresh, because the whole point of
  // pressing the button is to ask again.
  var autoCheck = null;

  // presetFeed lets the catalogue hand over the plans it has already
  // downloaded and parsed, instead of making this module fetch the same file a
  // second time on a student's mobile data.
  function checkForUpdates(manual, presetFeed){
    if(!manual && autoCheck) return autoCheck;
    var run = (presetFeed ? Promise.resolve(presetFeed) : fetchFeed()).then(function(feed){
      if(!feed){
        if(manual && window.__showToast){ window.__showToast('Could not reach the plans feed — check your connection.'); }
        return { added: 0, updated: 0, pending: 0, cosmetic: 0 };
      }
      var result = applyFeed(feed);
      try{ localStorage.setItem('aaup_lastSync', String(Date.now())); }catch(e){}
      // A pending item gets its own dialog, so it is not also announced in a
      // toast that would scroll away behind it.
      //
      // Nor is anything announced over the first screen a student ever sees.
      // On a brand-new device every plan in the feed is "new", so the landing
      // page came up with "🔄 78 new." floating over it — an update to an app
      // they had not opened yet. A manual check still always reports back,
      // because then someone asked.
      var firstRun = document.getElementById('onboardingWizardOverlay');
      firstRun = !!(firstRun && firstRun.classList.contains('open'));
      if(!manual && firstRun){ return result; }
      if(manual || result.added || result.updated || result.cosmetic){
        var bits = [];
        if(result.added) bits.push(result.added + ' new');
        if(result.updated) bits.push(result.updated + ' updated');
        if(result.cosmetic) bits.push(result.cosmetic + ' refreshed');
        if(!bits.length) bits.push('already up to date');
        var msg = bits.join(', ') +
          (result.pending ? ' · ' + result.pending + ' need' + (result.pending === 1 ? 's' : '') + ' your decision' : '') + '.';
        if(window.__showToast){ window.__showToast(msg); }
      }
      return result;
    });
    if(!manual) autoCheck = run;
    return run;
  }

  window.AAUP_SYNC = {
    checkForUpdates: checkForUpdates,
    lastSyncLabel: lastSyncLabel,
    // Exposed so the consent path can be driven with a crafted feed. Reaching
    // it through the network would mean publishing a change and waiting for a
    // deploy, which is not a thing a test can do — and this is the one branch
    // in the app that can destroy a student's own work if it is wrong.
    __applyFeedForTest: applyFeed
  };

  // No startup check is scheduled here. 01-catalogue.js already downloads the
  // very same plans.json to build the catalogue and hands the parsed feed to
  // checkForUpdates() the moment it lands, so a second listener on window load
  // only raced it into re-downloading the file. If that download fails there is
  // nothing to retry either — it is the same URL.
})();
