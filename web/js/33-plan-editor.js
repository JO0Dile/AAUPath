// ==========================
// PLAN EDITOR (developer-only: drag-and-drop semester reordering,
// prerequisite-validated, plus a shell for creating brand-new plans)
// ==========================
(function(){
  // ---------- semester ordering ----------
  // Container ids look like "robotics-y2-s1" — parse the year/semester and
  // turn it into one comparable integer (y1s1=1, y1s2=2, y2s1=3, ... y4s2=8).
  // Three slots per year, not two: s3 is the summer semester. With the old
  // *2 formula a year's summer (y1s3) scored the same as the NEXT year's
  // first semester (y2s1), so the prerequisite check silently treated them
  // as the same point in time — a course could be dragged ahead of its own
  // prerequisite without complaint. Year is \d+ so plans can pass year 10.
  function orderOfContainerId(id){
    var m = /-y(\d+)-s(\d)$/.exec(id || '');
    if(!m) return null;
    return (parseInt(m[1], 10) - 1) * 3 + parseInt(m[2], 10);
  }
  function containerOf(el){
    var row = el.closest('.course-row');
    return row && row.id ? row : null;
  }
  function primarySlugFor(prefix, slug){
    return window.AAUP_GPA ? window.AAUP_GPA.primaryId(prefix, slug).slice((prefix + '-c-').length) : slug;
  }
  // The draggable unit is the whole pair-group when there is one (lecture +
  // lab move together, since they're the same real course), otherwise just
  // the single course box.
  function dragUnitFor(el){
    return el.closest('.pair-group') || el;
  }

  // ---------- persistence ----------
  function loadOverrides(){
    return window.AAUP_STORAGE.getJSON('aaup_semesterOverrides', {});
  }
  function saveOverrides(m){
    window.AAUP_STORAGE.setJSON('aaup_semesterOverrides', m);
  }

  // Re-applies any saved moves by physically relocating the DOM nodes —
  // called once per plan, before that plan's very first prerequisite-arrow
  // draw, so arrows are correct from the first paint rather than jumping
  // after the fact.
  function replayOverrides(prefix){
    var all = loadOverrides();
    var forPlan = all[prefix];
    if(!forPlan) return;
    Object.keys(forPlan).forEach(function(slug){
      var targetId = forPlan[slug];
      var courseEl = document.getElementById(prefix + '-c-' + slug);
      var target = document.getElementById(targetId);
      if(!courseEl || !target) return;
      target.appendChild(dragUnitFor(courseEl));
    });
  }

  // ---------- validation ----------
  // Returns {ok:true} or {ok:false, reason:{en,ar}}. Only checks DIRECT
  // neighbors (immediate prerequisites and immediate dependents) — since
  // every earlier move was itself validated the same way, the whole chain
  // stays correctly ordered by induction; no need to re-walk the full
  // transitive graph on every single drag.
  // ---------- synced pairs (retake exception) ----------
  // A prereq and its dependent can legitimately share a semester when a
  // student is RETAKING the prereq at the same time as the course that
  // needs it (e.g. retaking Calculus I while also taking Statistics,
  // which the student already qualified for the first time around). That's
  // the one case worth an explicit "sync" confirmation instead of a flat
  // rejection — being scheduled BEFORE its own prereq is never valid, no
  // exception applies there.
  function syncKey(reqSlug, depSlug){ return reqSlug + '__' + depSlug; }
  function loadSyncedPairs(){
    return window.AAUP_STORAGE.getJSON('aaup_syncedPairs', {});
  }
  function saveSyncedPairs(m){
    window.AAUP_STORAGE.setJSON('aaup_syncedPairs', m);
  }
  function isPairSynced(prefix, reqSlug, depSlug){
    var all = loadSyncedPairs();
    return !!(all[prefix] && all[prefix][syncKey(reqSlug, depSlug)]);
  }
  function markPairSynced(prefix, reqSlug, depSlug){
    var all = loadSyncedPairs();
    all[prefix] = all[prefix] || {};
    all[prefix][syncKey(reqSlug, depSlug)] = true;
    saveSyncedPairs(all);
  }

  function validateMove(prefix, slug, targetContainerId){
    // The elective pool is a real drop target: it is how a student takes back
    // "I take this one in Year 3" without having to guess a semester. It has
    // no position in time, so none of the prerequisite ordering below applies.
    if(/-elective-/.test(targetContainerId || '')) return { ok: true };
    var targetOrder = orderOfContainerId(targetContainerId);
    if(targetOrder === null) return { ok: false, hard: true, reason: { en: 'Not a valid semester slot.', ar: 'ليس فصلاً دراسيًا صالحًا.' } };

    var data = window.__PLAN_DATA[prefix] || {};
    var info = data.courseInfo || {};
    var needs = (data.needsMap && data.needsMap[slug]) || [];
    var unlocks = (data.unlocksMap && data.unlocksMap[slug]) || [];

    for(var i = 0; i < needs.length; i++){
      var reqSlug = needs[i];
      var reqEl = document.getElementById(prefix + '-c-' + reqSlug);
      var reqContainer = reqEl && containerOf(reqEl);
      var reqOrder = reqContainer ? orderOfContainerId(reqContainer.id) : null;
      if(reqOrder === null) continue;
      var reqName = (info[reqSlug] && info[reqSlug].name) || reqSlug;
      var reqNameAr = (info[reqSlug] && info[reqSlug].ar) || reqName;
      if(reqOrder > targetOrder){
        return { ok: false, hard: true, reason: {
          en: 'Needs "' + reqName + '" to come first — that\u2019s currently in a later semester.',
          ar: 'يحتاج إلى "' + reqNameAr + '" أولًا — وهو حاليًا في فصل لاحق.'
        } };
      }
      if(reqOrder === targetOrder && !isPairSynced(prefix, reqSlug, slug)){
        var thisName = (info[slug] && info[slug].name) || slug;
        return { ok: false, hard: false, syncReq: reqSlug, syncDep: slug, reason: {
          en: '"' + thisName + '" normally needs "' + reqName + '" finished first. This is only valid if a student is retaking "' + reqName + '" at the same time.',
          ar: '"' + thisName + '" يحتاج عادةً إلى إنهاء "' + reqNameAr + '" أولًا. هذا صالح فقط إذا كان الطالب يعيد "' + reqNameAr + '" في نفس الوقت.'
        } };
      }
    }
    for(var j = 0; j < unlocks.length; j++){
      var depSlug = unlocks[j];
      var depEl = document.getElementById(prefix + '-c-' + depSlug);
      var depContainer = depEl && containerOf(depEl);
      var depOrder = depContainer ? orderOfContainerId(depContainer.id) : null;
      if(depOrder === null) continue;
      var depName = (info[depSlug] && info[depSlug].name) || depSlug;
      var depNameAr = (info[depSlug] && info[depSlug].ar) || depName;
      if(depOrder < targetOrder){
        return { ok: false, hard: true, reason: {
          en: '"' + depName + '" needs this course first — it\u2019s currently in an earlier semester.',
          ar: '"' + depNameAr + '" يحتاج إلى هذا المساق أولًا — وهو حاليًا في فصل سابق.'
        } };
      }
      if(depOrder === targetOrder && !isPairSynced(prefix, slug, depSlug)){
        var thisName2 = (info[slug] && info[slug].name) || slug;
        return { ok: false, hard: false, syncReq: slug, syncDep: depSlug, reason: {
          en: '"' + depName + '" normally needs "' + thisName2 + '" finished first. This is only valid if a student is retaking "' + thisName2 + '" at the same time.',
          ar: '"' + depNameAr + '" يحتاج عادةً إلى إنهاء "' + thisName2 + '" أولًا. هذا صالح فقط إذا كان الطالب يعيد "' + thisName2 + '" في نفس الوقت.'
        } };
      }
    }
    return { ok: true };
  }

  // ---------- applying a move ----------
  // isUndo suppresses the "Undo" toast on the reverse move, so undoing a
  // move doesn't itself offer to undo the undo (and re-toast forever).
  function applyMove(prefix, slug, targetContainerId, isUndo){
    var courseEl = document.getElementById(prefix + '-c-' + slug);
    var target = document.getElementById(targetContainerId);
    if(!courseEl || !target) return false;

    // Where it's coming FROM, captured before the DOM move, so Undo has an
    // exact semester slot to send it back to.
    var fromRow = courseEl.closest('.course-row[id]');
    var fromContainerId = fromRow ? fromRow.id : null;

    target.appendChild(dragUnitFor(courseEl));

    // Built-in majors are static HTML that's never regenerated, so an
    // "override" recorded separately and replayed on load is enough. An
    // imported plan's view is fully rebuilt from its own course data on
    // every single interaction (checkbox click, exiting edit mode, adding
    // another course...) — an override alone would just get silently
    // discarded the next time anything re-rendered, which is exactly what
    // was happening. For those, the actual yearId/semester on the course
    // itself has to be updated instead.
    if(window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()[prefix]){
      window.AAUP_IMPORTED.persistCourseMove(prefix, slug, targetContainerId);
    } else {
      var all = loadOverrides();
      all[prefix] = all[prefix] || {};
      all[prefix][slug] = targetContainerId;
      saveOverrides(all);
      if(window.__redraw && window.__redraw[prefix]){ window.__redraw[prefix](); }
    }
    if(!isUndo && fromContainerId && fromContainerId !== targetContainerId && window.__showActionToast){
      window.__showActionToast('Moved — saved.', 'Undo', function(){
        applyMove(prefix, slug, fromContainerId, true);
      });
    } else if(window.__showToast){
      window.__showToast(isUndo ? 'Move undone.' : 'Moved — saved automatically.');
    }
    return true;
  }

  // ---------- drag interaction (pointer events: mouse + touch in one) ----------
  var drag = null; // { el, unit, fromParent, fromNext, prefix, slug, ghost, offsetX, offsetY }

  function isEditing(prefix){
    var page = document.getElementById('page-' + prefix);
    return !!(page && page.classList.contains('editing'));
  }

  function courseRowsFor(prefix){
    var page = document.getElementById('page-' + prefix);
    return page ? Array.prototype.slice.call(page.querySelectorAll('.course-row[id]')) : [];
  }

  function clearDropHighlights(prefix){
    courseRowsFor(prefix).forEach(function(r){ r.classList.remove('drop-ok', 'drop-bad'); });
  }

  function startDrag(e, courseEl, prefix, slug){
    var unit = dragUnitFor(courseEl);
    var rect = unit.getBoundingClientRect();
    var ghost = unit.cloneNode(true);
    ghost.className += ' course-drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);

    drag = {
      el: courseEl, unit: unit, prefix: prefix, slug: slug,
      fromParent: unit.parentNode, fromNext: unit.nextSibling,
      ghost: ghost,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top
    };
    unit.classList.add('drag-source-hidden');
    document.body.style.userSelect = 'none';
  }

  function updateDrag(e){
    if(!drag) return;
    drag.ghost.style.left = (e.clientX - drag.offsetX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.offsetY) + 'px';

    drag.ghost.style.display = 'none';
    var hoverEl = document.elementFromPoint(e.clientX, e.clientY);
    drag.ghost.style.display = '';
    var row = hoverEl && hoverEl.closest('.course-row[id]');
    clearDropHighlights(drag.prefix);
    if(row){
      var check = validateMove(drag.prefix, drag.slug, row.id);
      row.classList.add(check.ok ? 'drop-ok' : 'drop-bad');
    }
  }

  function snapBack(d){
    if(d.fromNext){ d.fromParent.insertBefore(d.unit, d.fromNext); }
    else { d.fromParent.appendChild(d.unit); }
    d.el.classList.add('drop-rejected');
    setTimeout(function(){ d.el.classList.remove('drop-rejected'); }, 400);
  }

  // pointercancel means the browser aborted the gesture — its coordinates
  // aren't a reliable drop position, so this always snaps back rather than
  // trying to read a potentially-meaningless elementFromPoint.
  function cancelDrag(){
    if(!drag) return;
    var d = drag;
    drag = null;
    document.body.style.userSelect = '';
    d.ghost.remove();
    d.unit.classList.remove('drag-source-hidden');
    clearDropHighlights(d.prefix);
    snapBack(d);
  }

  function endDrag(e){
    if(!drag) return;
    var d = drag;
    drag = null;
    document.body.style.userSelect = '';

    d.ghost.style.display = 'none';
    var hoverEl = document.elementFromPoint(e.clientX, e.clientY);
    var row = hoverEl && hoverEl.closest('.course-row[id]');
    d.ghost.remove();
    d.unit.classList.remove('drag-source-hidden');
    clearDropHighlights(d.prefix);

    if(!row){ snapBack(d); return; }

    var check = validateMove(d.prefix, d.slug, row.id);
    if(check.ok){
      applyMove(d.prefix, d.slug, row.id);
      return;
    }

    var rtl = window.__isRtl ? window.__isRtl(d.prefix) : false;

    if(check.hard){
      if(window.__showToast){ window.__showToast((rtl ? check.reason.ar : check.reason.en)); }
      snapBack(d);
      return;
    }

    // Same-semester conflict only — this is exactly the "retaking a
    // prerequisite" scenario (e.g. retaking Calculus I while also taking
    // Statistics, which the student already qualified for the first time).
    // Offer to sync this specific pair instead of a flat rejection.
    var targetRowId = row.id;
    var msg = (rtl ? check.reason.ar : check.reason.en) + '\n\n' +
      (rtl
        ? 'هل تريد المزامنة؟ سيُسمح لهذين المساقين بمشاركة نفس الفصل دائمًا (حالة إعادة تسجيل).'
        : 'Do you want to sync? These two courses will be allowed to share this semester from now on (a retake case).');
    if(window.__showConfirmDialog){
      window.__showConfirmDialog(msg, function(){
        markPairSynced(d.prefix, check.syncReq, check.syncDep);
        applyMove(d.prefix, d.slug, targetRowId);
      }, rtl);
      // While the confirm dialog is open, leave the card back where it
      // started — applyMove (if confirmed) will move it from there.
      snapBack(d);
    } else {
      snapBack(d);
    }
  }

  var DRAG_THRESHOLD = 5;
  var pending = null; // {el, slug, prefix, startX, startY} — shared with `drag`, since only one
                       // drag can ever be in flight regardless of how many plans call bindDraggable
  var boundPrefixes = {};
  function bindDraggable(prefix){
    // Delegated on `document` rather than a specific page element on
    // purpose: the built-in majors' page never gets rebuilt, but an
    // imported plan's DOM is replaced wholesale on every re-render
    // (checkbox toggle, course add, etc.) — a listener bound to a specific
    // node would go silently dead the moment that node is replaced.
    // Delegation means this only ever needs to be attached once per prefix.
    if(boundPrefixes[prefix]) return;
    boundPrefixes[prefix] = true;

    document.addEventListener('pointerdown', function(e){
      if(!isEditing(prefix)) return;
      // The remove-course "✕" button lives INSIDE the course card, so
      // without this check every press on it also matched .course[id] and
      // got treated as the start of a possible drag — any tiny movement
      // while tapping it (routine on touch, and not uncommon with a
      // mouse) crossed the drag threshold and hijacked the click instead
      // of removing the course. Anything explicitly marked as its own
      // control gets to handle its own clicks, full stop.
      if(e.target.closest('.imp-card-btn-row, .imp-add-course-card')) return;
      var courseEl = e.target.closest('.course[id]');
      if(!courseEl || courseEl.id.indexOf(prefix + '-c-') !== 0) return;
      var parts = window.__splitCourseId ? window.__splitCourseId(courseEl.id) : null;
      if(!parts) return;
      pending = { el: courseEl, slug: parts.slug, prefix: prefix, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
      // Route every later event for this gesture through this element even
      // if the finger drifts off it mid-drag — without this, fast touch
      // movement can silently drop pointermove events on mobile.
      if(courseEl.setPointerCapture){ try{ courseEl.setPointerCapture(e.pointerId); }catch(err){} }
      e.preventDefault();
    });

    window.addEventListener('pointermove', function(e){
      if(drag){ updateDrag(e); return; }
      if(!pending || pending.prefix !== prefix) return;
      var dx = e.clientX - pending.startX, dy = e.clientY - pending.startY;
      if(Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD){
        startDrag(e, pending.el, prefix, pending.slug);
        pending = null;
      }
    });

    window.addEventListener('pointerup', function(e){
      // `pending` still set at pointerup means the press never crossed the
      // drag threshold — a tap. Edit mode had no use for one, so it is free
      // for js/85-carry.js to pick the course up with. A real drag clears
      // `pending` in pointermove above and never reaches here.
      if(pending && pending.prefix === prefix){
        var tap = pending;
        pending = null;
        if(window.AAUP_CARRY){ window.AAUP_CARRY.tapped(tap.prefix, tap.slug); }
      }
      if(drag && drag.prefix === prefix){ endDrag(e); }
    });

    // Mobile browsers can cancel an in-progress pointer sequence (an OS
    // gesture taking over, a system dialog, scroll disambiguation losing
    // to us, etc.) — without handling this the SAME as a mouseup-outside
    // (snap back + clear state), a cancelled gesture left `pending`/`drag`
    // permanently set, so the NEXT tap looked "stuck" reacting to a drag
    // that, as far as the person could see, had already ended.
    window.addEventListener('pointercancel', function(e){
      if(pending && pending.prefix === prefix){ pending = null; }
      if(drag && drag.prefix === prefix){ cancelDrag(); }
    });
  }

  // ---------- edit mode ----------
  function enterEditMode(prefix){
    if(window.showPage){ window.showPage(prefix); }
    var page = document.getElementById('page-' + prefix);
    if(page){ page.classList.add('editing'); }
    if(window.AAUP_TUTORIAL){ window.AAUP_TUTORIAL.startWhenClear('devEdit'); }
  }
  function exitEditMode(prefix){
    var page = document.getElementById('page-' + prefix);
    if(page){ page.classList.remove('editing'); }
    clearDropHighlights(prefix);
  }

  // ---------- reveal Edit affordances after a successful Developer Mode login ----------
  function revealDevAffordances(){
    document.querySelectorAll('[data-dev-edit-btn]').forEach(function(el){ el.style.display = ''; });
  }

  // ---------- "+ New study plan" shell (name/details only — populate its
  // courses afterward via the existing Import Study Plan panel) ----------
  function loadImportedPlans(){
    return window.AAUP_STORAGE.getJSON('aaup_importedPlans', {});
  }
  function saveImportedPlans(m){
    window.AAUP_STORAGE.setJSON('aaup_importedPlans', m);
  }
  function slugify(s){
    var out = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return out || ('plan-' + Date.now());
  }

  // prefill {university, college}: where the student was when they asked —
  // the college they had open in the major picker — so the new plan lands
  // under it instead of at the top of the list.
  function openNewPlanDialog(prefill){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body) return;
    var icons = (window.AAUP_IMPORTED && window.AAUP_IMPORTED.ICONS) || ['🎓','🤖','🔒','⚕️','💻','📊','🔬','🎨','📚','⚙️'];
    var selectedIcon = icons[0];

    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('plus', 20) + 'New Study Plan · خطة دراسية جديدة</h2>' +
      '<div class="form-field"><label>Icon · الأيقونة</label><div class="icon-picker-grid" id="npIconGrid">' +
      icons.map(function(ic, i){ return '<div class="icon-picker-option' + (i === 0 ? ' selected' : '') + '" data-icon="' + ic + '">' + ic + '</div>'; }).join('') +
      '</div></div>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="npNameEnBig">Major name — English · اسم التخصص بالإنجليزية</label><input type="text" id="npNameEnBig" maxlength="60" placeholder="e.g. Data Science"></div>' +
        '<div class="form-field"><label for="npUniversity">University · الجامعة</label><select id="npUniversity">' +
          Object.keys(window.APP_UNIVERSITIES || {}).map(function(uid){
            var u = window.APP_UNIVERSITIES[uid];
            return '<option value="' + uid + '">' + u.icon + ' ' + u.name.en + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="form-field"><label for="npNameEnSmall">English subtitle · عنوان فرعي إنجليزي</label><input type="text" id="npNameEnSmall" maxlength="40" placeholder="optional · اختياري"></div>' +
      '</div>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="npNameArBig">Major name — Arabic · اسم التخصص بالعربية</label><input type="text" id="npNameArBig" maxlength="60" placeholder="مثال: علم البيانات"></div>' +
        '<div class="form-field"><label for="npNameArSmall">Arabic subtitle · عنوان فرعي عربي</label><input type="text" id="npNameArSmall" maxlength="40" placeholder="اختياري"></div>' +
      '</div>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="npCollegeEn">College / Faculty (English) · الكلية بالإنجليزية</label><input type="text" id="npCollegeEn" maxlength="80" placeholder="e.g. Faculty of Fine Arts"></div>' +
        '<div class="form-field"><label for="npCollegeAr">College / Faculty (Arabic) · الكلية بالعربية</label><input type="text" id="npCollegeAr" maxlength="80" placeholder="مثال: كلية الفنون الجميلة"></div>' +
      '</div>' +
      '<div class="form-field"><label for="npBioEn">Bio (English) · نبذة بالإنجليزية</label><textarea id="npBioEn" class="notes-textarea" rows="2" maxlength="220" placeholder="A short description shown on the home page card"></textarea></div>' +
      '<div class="form-field"><label for="npBioAr">Bio (Arabic) · نبذة بالعربية</label><textarea id="npBioAr" class="notes-textarea" rows="2" maxlength="220"></textarea></div>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="npCancel">Cancel · إلغاء</button>' +
      '<button type="button" class="home-btn" id="npCreate" style="border-color:var(--accent);color:var(--text);">Create · إنشاء</button></div>' +
      '<div id="npMsg"></div>' +
      '<p class="form-note">This creates the plan with one empty Year 1 — add courses and more years from inside it once created. · يُنشئ الخطة بسنة أولى فارغة — أضف المساقات والسنوات من داخلها بعد الإنشاء.</p>';
    overlay.classList.add('open');

    var sel = prefill || null;
    if(sel && sel.university){
      var uniSelect = document.getElementById('npUniversity');
      if(uniSelect) uniSelect.value = sel.university;
    }
    if(sel && sel.college && window.APP_COLLEGES && window.APP_COLLEGES[sel.college]){
      var collegeName = window.APP_COLLEGES[sel.college].name;
      var enField = document.getElementById('npCollegeEn'), arField = document.getElementById('npCollegeAr');
      if(enField) enField.value = collegeName.en || '';
      if(arField) arField.value = collegeName.ar || '';
    }

    document.getElementById('npIconGrid').addEventListener('click', function(e){
      var opt = e.target.closest('.icon-picker-option');
      if(!opt) return;
      document.querySelectorAll('#npIconGrid .icon-picker-option').forEach(function(o){ o.classList.remove('selected'); });
      opt.classList.add('selected');
      selectedIcon = opt.getAttribute('data-icon');
    });

    document.getElementById('npCancel').addEventListener('click', function(){ overlay.classList.remove('open'); });
    document.getElementById('npCreate').addEventListener('click', function(){
      // Everything typed here ends up in innerHTML-built markup (home
      // cards, plan header, drill-down tiles) — cleaned at the source.
      var enBig = window.__cleanText(document.getElementById('npNameEnBig').value.trim());
      var enSmall = window.__cleanText(document.getElementById('npNameEnSmall').value.trim());
      var arBig = window.__cleanText(document.getElementById('npNameArBig').value.trim());
      var arSmall = window.__cleanText(document.getElementById('npNameArSmall').value.trim());
      var collegeEn = window.__cleanText(document.getElementById('npCollegeEn').value.trim());
      var collegeAr = window.__cleanText(document.getElementById('npCollegeAr').value.trim());
      var bioEn = window.__cleanText(document.getElementById('npBioEn').value.trim());
      var bioAr = window.__cleanText(document.getElementById('npBioAr').value.trim());
      var msg = document.getElementById('npMsg');
      if(!enBig || !arBig){
        msg.innerHTML = '<p class="dev-error-msg">Please fill in at least the big English and Arabic name. · يرجى إدخال الاسم الكبير بالإنجليزية والعربية على الأقل.</p>';
        return;
      }
      var id = slugify(enBig);
      var plans = loadImportedPlans();
      plans[id] = {
        majorName: { en: { big: enBig, small: enSmall }, ar: { big: arBig, small: arSmall } },
        icon: selectedIcon,
        college: { en: collegeEn, ar: collegeAr },
        university: (document.getElementById('npUniversity') && document.getElementById('npUniversity').value) || 'aaup',
        bio: { en: bioEn, ar: bioAr },
        structure: { years: [{ id: 'y1', hasSummer: false }] },
        courses: [],
        prerequisites: [],
        importedAt: new Date().toISOString()
      };
      saveImportedPlans(plans);
      if(window.AAUP_IMPORTED){ window.AAUP_IMPORTED.plansChanged(); }
      // Straight into the new plan, in edit mode: it has one empty year and
      // the next thing anyone does with it is add courses. It becomes the
      // student's plan too — they made it because it is their major.
      overlay.classList.remove('open');
      window.AAUP_DASHBOARD.select(id);
      window.AAUP_DASHBOARD.openStudyPlan(id);
      window.AAUP_IMPORTED.toggleEdit(id);
    });
  }

  window.AAUP_PLAN_EDITOR = {
    enterEditMode: enterEditMode,
    exitEditMode: exitEditMode,
    validateMove: validateMove,
    applyMove: applyMove,
    replayOverrides: replayOverrides,
    revealDevAffordances: revealDevAffordances,
    openNewPlanDialog: openNewPlanDialog,
    orderOfContainerId: orderOfContainerId,
    isPairSynced: isPairSynced,
    markPairSynced: markPairSynced,
    bindDraggable: bindDraggable,
    clearDropHighlights: clearDropHighlights
  };

  // The four built-in pages carry a static edit-mode banner; the line editor
  // button is injected rather than hand-added to each one's HTML.
  function addLinkButton(prefix){
    var page = document.getElementById('page-' + prefix);
    var banner = page && page.querySelector('.edit-mode-banner');
    if(!banner || banner.querySelector('.emb-links')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emb-links';
    btn.textContent = 'Prerequisite lines';
    btn.addEventListener('click', function(){
      if(window.AAUP_LINKS){ window.AAUP_LINKS.open(prefix); }
    });
    var exit = banner.querySelector('.emb-exit');
    if(exit){ banner.insertBefore(btn, exit); }
    else { banner.appendChild(btn); }
  }

  function init(){
    ['robotics', 'cybersecurity', 'medical', 'cs'].forEach(function(prefix){
      bindDraggable(prefix);
      addLinkButton(prefix);
    });
  }
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }
})();
