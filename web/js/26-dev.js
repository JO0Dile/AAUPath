// ==========================
// DEVELOPER MODE
// ==========================
// Hidden trigger: open the dialog 3 times in a row (open → close → open →
// close → open) to reveal a password field. The password is a plain,
// hardcoded string with no real security purpose — it's a cosmetic
// Easter-egg gate on a panel that only ever touches this browser's own
// localStorage, not a protected system.
(function(){
  var PASSWORD = 'admin123';
  var openCount = 0;
  var authenticated = false;
  var lastWrong = false;

  function slugify(s){
    var out = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return out || ('plan-' + Date.now());
  }
  function loadImportedPlans(){
    return window.AAUP_STORAGE.getJSON('aaup_importedPlans', {});
  }
  function saveImportedPlans(m){
    window.AAUP_STORAGE.setJSON('aaup_importedPlans', m);
  }

  function validatePlanJson(obj){
    var errors = [];
    if(!obj || typeof obj !== 'object'){ return ['That is not a valid JSON object.']; }
    if(!obj.majorName || typeof obj.majorName !== 'object' || !obj.majorName.en || !obj.majorName.ar){
      errors.push('majorName must be an object with both "en" and "ar" names.');
    }
    if(!Array.isArray(obj.courses) || obj.courses.length === 0){
      errors.push('courses must be a non-empty array.');
    } else {
      obj.courses.forEach(function(c, i){
        ['id', 'name', 'ar', 'creditHours', 'category', 'semester'].forEach(function(field){
          if(c[field] === undefined || c[field] === null || c[field] === ''){
            errors.push('Course #' + (i + 1) + ' is missing "' + field + '".');
          }
        });
      });
    }
    if(!Array.isArray(obj.prerequisites)){
      errors.push('prerequisites must be an array (it can be empty).');
    }
    return errors;
  }

  function importPlan(jsonText){
    var obj;
    try{ obj = JSON.parse(jsonText); }
    catch(e){ return { ok: false, errors: ['That is not valid JSON.'] }; }
    var errors = validatePlanJson(obj);
    if(errors.length){ return { ok: false, errors: errors }; }
    // Same trust boundary as the online feed: this JSON usually came from
    // ANOTHER student (that's what Export/Contribute are for), and its
    // strings flow into the same innerHTML render paths as everything
    // else — so it gets the same escape-and-reslugify pass. Idempotent,
    // so a plan exported from this app re-imports byte-identical.
    if(window.__sanitizeImportedPlan){ obj = window.__sanitizeImportedPlan(obj); }
    var id = slugify(obj.majorName.en && obj.majorName.en.big ? obj.majorName.en.big : obj.majorName.en);
    var plans = loadImportedPlans();
    var entry = { majorName: obj.majorName, courses: obj.courses, prerequisites: obj.prerequisites, importedAt: new Date().toISOString() };
    // Preserve the newer fields when the pasted JSON has them (e.g. it was
    // exported from this app's own "Export This Plan") — dropping them
    // silently would downgrade a fully-featured plan (drag-and-drop, GPA,
    // Degree Audit) back to the old read-only view for no reason.
    if(obj.structure){ entry.structure = obj.structure; }
    if(obj.icon){ entry.icon = obj.icon; }
    if(obj.bio){ entry.bio = obj.bio; }
    if(obj.university){ entry.university = obj.university; }
    if(obj.college){ entry.college = obj.college; }
    plans[id] = entry;
    saveImportedPlans(plans);
    if(window.AAUP_IMPORTED){ window.AAUP_IMPORTED.plansChanged(); }
    return { ok: true, id: id };
  }
  function removePlan(id){
    var plans = loadImportedPlans();
    delete plans[id];
    saveImportedPlans(plans);
    if(window.AAUP_IMPORTED){ window.AAUP_IMPORTED.plansChanged(); }
  }

  function plainMessage(rtl){
    return '<h2 style="margin-top:0;">🛠️ ' + (rtl ? 'أدوات المطورين' : 'Developer Tools') + '</h2>' +
      '<p class="ex-note">' + (rtl ? 'لا شيء لرؤيته هنا... حتى الآن.' : 'Nothing to see here... yet.') + '</p>';
  }

  function passwordPrompt(rtl){
    return '<h2 style="margin-top:0;">🔒 ' + (rtl ? 'وضع المطورين' : 'Developer Mode') + '</h2>' +
      '<div class="form-field"><label for="devPasswordInput">' + (rtl ? 'كلمة المرور' : 'Password') + '</label>' +
      '<input type="password" id="devPasswordInput" autocomplete="off"></div>' +
      '<div class="form-actions"><button type="button" class="home-btn btn-pri" id="devPasswordSubmit">' +
      (rtl ? 'دخول' : 'Enter') + '</button></div>' +
      (lastWrong ? '<p class="dev-wrong-pass">' + (rtl ? 'كلمة مرور خاطئة حقًا!؟' : 'Incorrect Password really!?') + '</p>' : '');
  }

  function planListHtml(rtl){
    var plans = loadImportedPlans();
    var ids = Object.keys(plans);
    return ids.length ? ids.map(function(id){
      var p = plans[id];
      // majorName.en became {big, small} when plans gained two-tone titles;
      // this still concatenated it as a string, so every row in the panel read
      // "[object Object] / [object Object]". nameParts() reads both the old
      // string shape and the new object one.
      var np = window.AAUP_IMPORTED.nameParts;
      var en = np(p.majorName && p.majorName.en);
      var ar = np(p.majorName && p.majorName.ar);
      var title = [en.big, en.small].filter(Boolean).join(' ') || id;
      var titleAr = [ar.big, ar.small].filter(Boolean).join(' ');
      var when = p.importedAt ? new Date(p.importedAt) : null;
      return '<div class="imported-plan-row"><div><div class="ipr-name">' +
        window.__escapeHtml(title) + (titleAr ? ' / ' + window.__escapeHtml(titleAr) : '') + '</div>' +
        '<div class="ipr-meta">' + window.__escapeHtml(id) + ' &middot; ' +
        (p.courses || []).length + ' ' + (rtl ? 'مساقًا' : 'courses') +
        (when && !isNaN(when) ? ' &middot; ' + when.toLocaleDateString() : '') + '</div></div>' +
        '<button type="button" class="home-btn" data-remove-plan="' + id + '">🗑 ' + (rtl ? 'حذف' : 'Remove') + '</button></div>';
    }).join('') : '<p class="ex-note">' + (rtl ? 'لا توجد خطط مستوردة بعد.' : 'No imported plans yet.') + '</p>';
  }

  // Re-binds remove-buttons for whatever rows currently exist — needed
  // whenever the list is refreshed in place rather than via a full panel
  // re-render (see refreshPlanList below).
  function bindRemoveButtons(){
    document.querySelectorAll('[data-remove-plan]').forEach(function(btn){
      if(btn.getAttribute('data-bound') === '1') return;
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', function(){
        removePlan(btn.getAttribute('data-remove-plan'));
        refreshPlanList();
      });
    });
  }

  // Updates ONLY the imported-plans list in place, leaving any success/
  // error message next to the import button untouched — a full renderBody()
  // would wipe that message the instant it appears.
  function refreshPlanList(){
    var list = document.getElementById('devPlanList');
    if(!list) return;
    list.innerHTML = planListHtml(currentRtl());
    bindRemoveButtons();
  }

  function renderPanel(rtl){
    return '<h2 style="margin-top:0;">🛠️ ' + (rtl ? 'لوحة المطورين' : 'Developer Panel') + '</h2>' +

      '<div class="dev-panel-section"><h3>📥 ' + (rtl ? 'استيراد خطة دراسية' : 'Import Study Plan') + '</h3>' +
      '<textarea class="notes-textarea" id="devPlanJsonInput" rows="5" placeholder=\'{"majorName":{"en":"...","ar":"..."},"courses":[{"id":"...","name":"...","ar":"...","creditHours":3,"category":"core","semester":"Y1S1"}],"prerequisites":[["a","b"]]}\'></textarea>' +
      '<div class="form-actions"><button type="button" class="home-btn btn-pri" id="devPlanImportBtn">' +
      (rtl ? 'استيراد' : 'Import') + '</button></div><div id="devPlanImportMsg"></div></div>' +

      '<div class="dev-panel-section"><h3>📋 ' + (rtl ? 'الخطط المستوردة' : 'Imported Study Plans') + '</h3>' +
      '<div id="devPlanList">' + planListHtml(rtl) + '</div>' +
      '<div class="form-actions"><button type="button" class="home-btn" id="devRefreshBtn">🔄 ' + (rtl ? 'تحديث الصفحة الرئيسية' : 'Refresh Study Plans') + '</button></div></div>' +

      '<div class="dev-panel-section"><h3>🏛️ ' + (rtl ? 'الجامعات' : 'Universities') + '</h3>' +
      '<p style="font-size:11.5px;color:var(--text-dim);line-height:1.6;margin:0 0 10px;">' +
      (rtl
        ? 'التطبيق يشحن بالجامعة العربية الأمريكية وحدها. أضف جامعة هنا لتظهر في قائمة «خطة جديدة»، وخططها بتظهر بعدها بقائمة التخصصات — تُحفظ على هذا الجهاز فقط، لا تُنشر لأحد.'
        : 'The app ships with AAUP alone. Add one here and it appears in the New Plan dropdown, and its plans then show up in the list of majors — saved on this device only, not published to anyone.') +
      '</p>' +
      '<div id="devUniList">' + uniListHtml(rtl) + '</div>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="devUniId">' + (rtl ? 'المعرّف' : 'ID') + '</label>' +
        '<input type="text" id="devUniId" maxlength="24" placeholder="e.g. najah"></div>' +
        '<div class="form-field"><label for="devUniShort">' + (rtl ? 'الاختصار' : 'Short name') + '</label>' +
        '<input type="text" id="devUniShort" maxlength="12" placeholder="e.g. NNU"></div>' +
        '<div class="form-field"><label for="devUniIcon">' + (rtl ? 'الأيقونة' : 'Icon') + '</label>' +
        '<input type="text" id="devUniIcon" maxlength="4" placeholder="🏛️"></div>' +
      '</div>' +
      '<div class="form-field-row">' +
        '<div class="form-field"><label for="devUniNameEn">' + (rtl ? 'الاسم بالإنجليزية' : 'Name — English') + '</label>' +
        '<input type="text" id="devUniNameEn" maxlength="70" placeholder="e.g. An-Najah National University"></div>' +
        '<div class="form-field"><label for="devUniNameAr">' + (rtl ? 'الاسم بالعربية' : 'Name — Arabic') + '</label>' +
        '<input type="text" id="devUniNameAr" maxlength="70" placeholder="جامعة النجاح الوطنية"></div>' +
      '</div>' +
      '<div class="form-actions"><button type="button" class="home-btn btn-pri" id="devUniAddBtn">' +
      (rtl ? 'أضف الجامعة' : 'Add university') + '</button></div><div id="devUniMsg"></div></div>' +

      // Admin Mode is a different thing from this panel and says so. This one
      // only ever touches this browser; Admin Mode changes what every student
      // sees, needs a real password, and is checked on a server.
      '<div class="dev-panel-section"><h3>🛡 ' + (rtl ? 'وضع المسؤول' : 'Admin Mode') + '</h3>' +
      '<p style="font-size:11.5px;color:var(--text-dim);line-height:1.6;margin:0 0 10px;">' +
      (rtl
        ? 'يعدّل البيانات المنشورة لجميع الطلاب — الجامعات والتخصصات والمساقات والشعارات. يتطلب اسم مستخدم وكلمة مرور يتم التحقق منهما على الخادم.'
        : 'Edits the published data every student sees — universities, majors, courses, logos. Needs a username and password, checked on the server. This panel, by contrast, only ever changes this one device.') +
      '</p>' +
      '<div class="form-actions"><button type="button" class="home-btn btn-pri" id="devAdminBtn">' +
      (rtl ? 'افتح وضع المسؤول' : 'Open Admin Mode') + '</button></div></div>' +

      '<div class="dev-panel-section"><h3>📥 ' + (rtl ? 'استيراد ملاحظات المجتمع (من البريد)' : 'Import Community Feedback (from Email)') + '</h3>' +
      '<label for="devFeedbackJsonInput" style="font-size:11.5px;color:var(--text-dim);display:block;margin-bottom:6px;">' +
      (rtl ? 'ألصق نص JSON من البريد هنا' : 'Paste the JSON from the email here') + '</label>' +
      '<textarea class="notes-textarea" id="devFeedbackJsonInput" rows="5"></textarea>' +
      '<div class="form-actions"><button type="button" class="home-btn btn-pri" id="devFeedbackImportBtn">' +
      (rtl ? 'استيراد' : 'Import') + '</button></div><div id="devFeedbackImportMsg"></div></div>';
  }

  // Universities added from this panel. Shipped ones are not listed: they
  // come from data/ and cannot be removed from inside the app, so offering a
  // button that would not work is worse than showing nothing.
  function uniListHtml(rtl){
    var added = window.__devUniversities ? window.__devUniversities() : {};
    var ids = Object.keys(added);
    if(!ids.length){
      return '<p class="ex-note">' +
        (rtl ? 'لم تُضف أي جامعة على هذا الجهاز.' : 'No universities added on this device.') + '</p>';
    }
    // Same row markup the imported-plan list above uses, so this section
    // inherits its styling instead of introducing a parallel set of classes.
    return ids.map(function(uid){
      var u = added[uid];
      return '<div class="imported-plan-row"><div>' +
        '<div class="ipr-name">' + window.__escapeHtml(u.icon || '🏛️') + ' ' +
        window.__escapeHtml((u.name && u.name.en) || uid) + '</div>' +
        '<div class="ipr-meta">' + window.__escapeHtml(uid) +
        (u.shortName ? ' &middot; ' + window.__escapeHtml(u.shortName) : '') + '</div></div>' +
        '<button type="button" class="home-btn" data-remove-uni="' + window.__escapeHtml(uid) + '">🗑 ' +
        (rtl ? 'حذف' : 'Remove') + '</button></div>';
    }).join('');
  }

  // Ids become part of every plan record that references them, so they are
  // held to the same shape the rest of the app uses for ids.
  function addUniversity(){
    var rtl = currentRtl();
    var id = (document.getElementById('devUniId').value || '').trim().toLowerCase();
    var nameEn = (document.getElementById('devUniNameEn').value || '').trim();
    var nameAr = (document.getElementById('devUniNameAr').value || '').trim();
    var shortName = (document.getElementById('devUniShort').value || '').trim();
    var icon = (document.getElementById('devUniIcon').value || '').trim() || '🏛️';

    var err = null;
    if(!/^[a-z0-9-]{2,24}$/.test(id)){
      err = rtl ? 'المعرّف يجب أن يكون حروفًا إنجليزية صغيرة أو أرقامًا أو شرطات (2–24).'
                : 'ID must be lowercase letters, numbers or hyphens (2–24 characters).';
    } else if(!nameEn && !nameAr){
      err = rtl ? 'أدخل اسمًا بالإنجليزية أو بالعربية على الأقل.' : 'Enter a name in English or Arabic.';
    } else if((window.APP_UNIVERSITIES || {})[id]){
      err = rtl ? 'هذا المعرّف مستخدم بالفعل.' : 'That ID is already in use.';
    }
    var msgEl = document.getElementById('devUniMsg');
    if(err){ msgEl.innerHTML = '<p class="dev-error-msg">' + window.__escapeHtml(err) + '</p>'; return; }

    var added = window.__devUniversities();
    added[id] = {
      name: { en: nameEn || nameAr, ar: nameAr || nameEn },
      shortName: shortName || id.toUpperCase(),
      icon: icon,
      website: '',
      electivePool: []
    };
    window.__saveDevUniversities(added);

    // Live, without a reload: the registries the whole app reads are updated
    // in place and every screen listing plans told.
    window.APP_UNIVERSITIES[id] = added[id];
    window.APP_UNIV_ELECTIVES[id] = [];
    if(window.AAUP_IMPORTED){ window.AAUP_IMPORTED.plansChanged(); }

    ['devUniId','devUniNameEn','devUniNameAr','devUniShort','devUniIcon'].forEach(function(f){
      var el = document.getElementById(f); if(el) el.value = '';
    });
    msgEl.innerHTML = '<p class="dev-success-msg">✅ ' +
      (rtl ? 'أُضيفت. اخترها عند إنشاء خطة جديدة.' : 'Added. Pick it when you create a new plan.') + '</p>';
    document.getElementById('devUniList').innerHTML = uniListHtml(rtl);
    bindUniRemoveButtons();
  }

  // Removing a university does NOT touch any plan created under it. Those
  // plans are the student's work; they are still listed among the majors,
  // under the college name the plan itself carries, for a plan whose college
  // is not in the registry, and reappear if the university is added again.
  function bindUniRemoveButtons(){
    var list = document.getElementById('devUniList');
    if(!list) return;
    list.querySelectorAll('[data-remove-uni]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var uid = btn.getAttribute('data-remove-uni');
        var added = window.__devUniversities();
        delete added[uid];
        window.__saveDevUniversities(added);
        delete window.APP_UNIVERSITIES[uid];
        delete window.APP_UNIV_ELECTIVES[uid];
        if(window.AAUP_IMPORTED){ window.AAUP_IMPORTED.plansChanged(); }
        document.getElementById('devUniList').innerHTML = uniListHtml(currentRtl());
        bindUniRemoveButtons();
      });
    });
  }

  function currentRtl(){ return window.__anyVisiblePageIsRtl ? window.__anyVisiblePageIsRtl() : false; }

  function renderBody(){
    var body = document.getElementById('devModalBody');
    if(!body) return;
    var rtl = currentRtl();
    if(authenticated){ body.innerHTML = renderPanel(rtl); bindPanel(); }
    else if(openCount >= 3){ body.innerHTML = passwordPrompt(rtl); bindPasswordPrompt(); }
    else { body.innerHTML = plainMessage(rtl); }
  }

  function bindPasswordPrompt(){
    var submit = document.getElementById('devPasswordSubmit');
    var input = document.getElementById('devPasswordInput');
    if(!submit || !input) return;
    var tryLogin = function(){
      if(input.value === PASSWORD){
        authenticated = true;
        lastWrong = false;
        if(window.AAUP_PLAN_EDITOR){ window.AAUP_PLAN_EDITOR.revealDevAffordances(); }
      }
      else { lastWrong = true; }
      renderBody();
    };
    submit.addEventListener('click', tryLogin);
    input.addEventListener('keydown', function(e){ if(e.key === 'Enter') tryLogin(); });
    input.focus();
  }

  function bindPanel(){
    var importBtn = document.getElementById('devPlanImportBtn');
    if(importBtn){
      importBtn.addEventListener('click', function(){
        var text = document.getElementById('devPlanJsonInput').value;
        var result = importPlan(text);
        var msgEl = document.getElementById('devPlanImportMsg');
        if(result.ok){
          msgEl.innerHTML = '<p class="dev-success-msg">✅ Imported "' + result.id + '".</p>';
          document.getElementById('devPlanJsonInput').value = '';
          refreshPlanList();
        } else {
          msgEl.innerHTML = '<ul class="dev-warn-list">' + result.errors.map(function(e){ return '<li>' + e + '</li>'; }).join('') + '</ul>';
        }
      });
    }
    bindRemoveButtons();
    var uniAddBtn = document.getElementById('devUniAddBtn');
    if(uniAddBtn){ uniAddBtn.addEventListener('click', addUniversity); }
    var adminBtn = document.getElementById('devAdminBtn');
    if(adminBtn){
      adminBtn.addEventListener('click', function(){
        closeDialog();
        if(window.AAUP_ADMIN) window.AAUP_ADMIN.open();
      });
    }
    bindUniRemoveButtons();
    var refreshBtn = document.getElementById('devRefreshBtn');
    if(refreshBtn){ refreshBtn.addEventListener('click', function(){ location.reload(); }); }

    var fbBtn = document.getElementById('devFeedbackImportBtn');
    if(fbBtn){
      fbBtn.addEventListener('click', function(){
        var text = document.getElementById('devFeedbackJsonInput').value;
        var result = window.AAUP_COMMUNITY.importFeedback(text);
        var msgEl = document.getElementById('devFeedbackImportMsg');
        if(!result.ok){
          msgEl.innerHTML = '<p class="dev-error-msg">' + result.error + '</p>';
          return;
        }
        var msg = '<p class="dev-success-msg">✅ Imported feedback for ' + result.imported + ' course(s).</p>';
        if(result.warnings.length){ msg += '<ul class="dev-warn-list">' + result.warnings.map(function(w){ return '<li>' + w + '</li>'; }).join('') + '</ul>'; }
        msgEl.innerHTML = msg;
        document.getElementById('devFeedbackJsonInput').value = '';
      });
    }
  }

  function openDialog(){
    openCount++;
    lastWrong = false;
    document.getElementById('devModalOverlay').classList.add('open');
    renderBody();
  }
  function closeDialog(){
    document.getElementById('devModalOverlay').classList.remove('open');
  }

  function bind(){
    var overlay = document.getElementById('devModalOverlay');
    var closeBtn = document.getElementById('devModalClose');
    if(!overlay) return;
    if(closeBtn) closeBtn.addEventListener('click', closeDialog);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) closeDialog(); });
    var card = overlay.querySelector('.modal-card');
    if(card) card.addEventListener('click', function(e){ e.stopPropagation(); });
  }
  if(document.readyState === 'complete'){ bind(); }
  else { window.addEventListener('load', bind); }

  window.AAUP_DEV = {
    openDialog: openDialog, closeDialog: closeDialog, isAuthenticated: function(){ return authenticated; },
    // Shared with js/72-share.js: importing a plan someone sent via a share
    // link goes through this exact same validate-and-store path a pasted
    // JSON does in the Developer Panel, not a second copy of it.
    importPlan: importPlan
  };
})();
