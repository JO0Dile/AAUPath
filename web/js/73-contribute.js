// ==========================
// CONTRIBUTIONS — turning "coming soon" from a dead end into a real path.
//
// A "coming soon" major (js/28-imported.js's notePending) is a real,
// published programme with no course list transcribed yet. Before this,
// tapping one just said so and went nowhere. Now it offers to open the
// plan in its own existing editor — the same drag-and-drop, add-course,
// add-prerequisite tools any custom plan already has — and, once a
// student has added something, a live "Submit contribution" button next
// to Edit Mode sends exactly what they built to the maintainer.
//
// Nothing here writes to the actual course catalogue directly — a
// contribution is a message with course data attached, not an automatic
// merge. The maintainer reads it in the admin panel (js/48-admin.js) and
// adds it the same way they add anything else, then can reply, and that
// reply is what the student sees back here.
//
// Same non-account shape as Student Thoughts: one device id (shared via
// window.__deviceId, js/14-storage.js), no login, no password on the
// student's side. Reading and replying to EVERY contribution — not just
// your own — needs the Worker's ADMIN_SECRET, which is deliberately never
// shipped with the app: the admin panel asks for it once per session and
// holds it in sessionStorage (js/48-admin.js).
// ==========================
(function(){
  'use strict';

  function esc(s){
    var v = String(s == null ? '' : s);
    return window.__cleanText ? window.__cleanText(v) : (window.__escapeHtml ? window.__escapeHtml(v) : v);
  }
  function endpoint(){ return (window.APP_CONTRIB_URL || '').replace(/\/+$/, ''); }
  function deviceId(){ return window.__deviceId ? window.__deviceId() : 'd-anon'; }
  function displayName(){
    var s = window.AAUP_STUDENT ? window.AAUP_STUDENT.get() : null;
    var n = s && (s.name || s.displayName);
    return (n && String(n).trim()) || '';
  }

  var TX = {
    offerTitle: { en: 'Help build this major?', ar: 'تساعد تبني هاي الخطة؟' },
    offerBody: { en: 'Nobody has added its course list yet. You can add what you know in the same editor a custom plan uses, and send it to the maintainer — even if it is only a few courses.',
                 ar: 'ولا حدا ضاف قائمة مساقاتها لسا. فيك تضيف اللي تعرفه بنفس المحرر اللي بتستخدمه الخطط المخصصة، وترسله للمسؤول عن التطبيق — حتى لو كم مساق بس.' },
    offerOk: { en: 'Start adding courses', ar: 'ابدأ بإضافة مساقات' },
    submitting: { en: 'Sending…', ar: 'عم نرسل…' },
    submitOk: { en: '📮 Sent — the maintainer can reply here in Settings.', ar: '📮 اترسلت — المسؤول فيه يرد هون بالإعدادات.' },
    submitEmpty: { en: 'Add at least one course before submitting.', ar: 'ضيف مساق واحد ع الأقل قبل الإرسال.' },
    submitFail: { en: 'Could not send it — check your connection and try again.', ar: 'ما قدرنا نرسلها — تأكد من الاتصال وجرب مرة ثانية.' },
    notConfigured: { en: 'Contributions are not accepted online yet — use Contribute to send a file instead.', ar: 'المساهمات مش مفعّلة أونلاين لسا — استخدم "ساهم" لإرسال ملف بدلاً من هيك.' },
    settingsTitle: { en: 'My contributions', ar: 'مساهماتي' },
    settingsLead: { en: 'Anything you have submitted while helping build a major, and any reply back.', ar: 'أي شي بعتّه وأنت عم تساعد تبني خطة، وأي رد رجع.' },
    refresh: { en: 'Refresh', ar: 'تحديث' },
    none: { en: 'Nothing sent yet.', ar: 'ما في شي مُرسَل لسا.' },
    statusPending: { en: 'Waiting for a reply', ar: 'بانتظار رد' },
    statusReplied: { en: 'Replied', ar: 'تم الرد' }
  };
  function t(k, r){ return r ? TX[k].ar : TX[k].en; }

  // ---- offer + entering edit mode ----------------------------------------

  function offerToHelp(prefix){
    var rtl = window.__anyVisiblePageIsRtl ? window.__anyVisiblePageIsRtl() : false;
    if(!endpoint()){
      if(window.__showToast) window.__showToast(t('notConfigured', rtl));
      return;
    }
    var start = function(){
      var plans = window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans() : {};
      var p = plans[prefix];
      if(p){
        var changed = false;
        if(!p.contributing){ p.contributing = true; changed = true; }
        // A "coming soon" major from the feed has no structure at all —
        // zero courses means nothing to lay out yet. The modern plan editor
        // (drag-and-drop, add-course, add-prerequisite) needs one to exist
        // before it will render in edit mode; this is the exact same
        // single-year starting point js/33-plan-editor.js gives a brand
        // new plan, not a special case invented for this flow.
        if(!p.structure || !Array.isArray(p.structure.years) || !p.structure.years.length){
          p.structure = { years: [{ id: 'y1', hasSummer: false }] };
          changed = true;
        }
        if(changed) window.AAUP_IMPORTED.saveImportedPlans(plans);
      }
      if(window.AAUP_DASHBOARD) window.AAUP_DASHBOARD.selectAndOpen(prefix);
      if(window.AAUP_IMPORTED){
        window.AAUP_IMPORTED.open(prefix);
        var page = document.getElementById('page-' + prefix);
        if(page && !page.classList.contains('editing')) window.AAUP_IMPORTED.toggleEdit(prefix);
      }
    };
    if(window.__showConfirmDialog){
      window.__showConfirmDialog(t('offerBody', rtl) + '\n\n' + t('offerOk', rtl) + '?', start, rtl);
    } else if(window.confirm(t('offerBody', rtl))){
      start();
    }
  }

  // ---- submitting ----------------------------------------------------------

  function submit(prefix){
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var url = endpoint();
    if(!url){ if(window.__showToast) window.__showToast(t('notConfigured', rtl)); return; }
    var bundle = window.AAUP_IMPORTED && window.AAUP_IMPORTED.planBundle(prefix);
    if(!bundle || !Array.isArray(bundle.courses) || !bundle.courses.length){
      if(window.__showToast) window.__showToast(t('submitEmpty', rtl));
      return;
    }
    if(window.__showToast) window.__showToast(t('submitting', rtl));
    var nameObj = bundle.majorName && bundle.majorName.en;
    var majorName = (nameObj && (nameObj.big || nameObj)) || prefix;
    fetch(url + '/contributions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix: prefix,
        majorName: majorName,
        deviceId: deviceId(),
        contributorName: displayName(),
        courses: bundle.courses,
        prerequisites: bundle.prerequisites || [],
        structure: bundle.structure || null
      })
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(){
      if(window.__showToast) window.__showToast(t('submitOk', rtl));
    }).catch(function(){
      if(window.__showToast) window.__showToast(t('submitFail', rtl));
    });
  }

  // ---- Settings → Data: "My contributions" --------------------------------

  function fetchMine(){
    var url = endpoint();
    if(!url) return Promise.resolve([]);
    return fetch(url + '/contributions?device=' + encodeURIComponent(deviceId()))
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data){ return (data && Array.isArray(data.contributions)) ? data.contributions : []; })
      .catch(function(){ return []; });
  }

  function contribRowHtml(c, r){
    var status = c.status === 'pending' ? t('statusPending', r) : (c.adminReply ? t('statusReplied', r) : c.status);
    return '<div class="contrib-row">' +
      '<div class="contrib-row-head"><span class="contrib-major">' + esc(c.majorName || c.prefix) + '</span>' +
      '<span class="contrib-status contrib-status-' + esc(c.status) + '">' + esc(status) + '</span></div>' +
      '<div class="contrib-meta">' + esc((c.courses || []).length) + (r ? ' مساق مُرسَل' : ' course(s) sent') + '</div>' +
      (c.adminReply ? '<p class="contrib-reply">💬 ' + esc(c.adminReply) + '</p>' : '') +
      '</div>';
  }

  function settingsSectionHtml(r){
    if(!endpoint()) return '';
    return '<h3 class="mh" style="margin:18px 0 6px;">' + window.AAUP_ICONS.preview('mail', 18) + t('settingsTitle', r) + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' + t('settingsLead', r) + '</p>' +
      '<div class="form-actions" style="justify-content:flex-start;"><button type="button" class="home-btn" id="contribRefreshBtn">' + t('refresh', r) + '</button></div>' +
      '<div id="contribList" class="contrib-list"></div>';
  }

  function bindSettingsSection(root){
    var list = root.querySelector('#contribList');
    var btn = root.querySelector('#contribRefreshBtn');
    if(!list || !btn) return;
    var r = root.getAttribute('dir') === 'rtl';
    var load = function(){
      list.innerHTML = '<p class="form-note">' + (r ? 'جارٍ التحميل…' : 'Loading…') + '</p>';
      fetchMine().then(function(items){
        list.innerHTML = items.length
          ? items.map(function(c){ return contribRowHtml(c, r); }).join('')
          : '<p class="form-note">' + t('none', r) + '</p>';
      });
    };
    btn.addEventListener('click', load);
    load();
  }

  window.AAUP_CONTRIBUTE = {
    offerToHelp: offerToHelp, submit: submit,
    settingsSectionHtml: settingsSectionHtml, bindSettingsSection: bindSettingsSection
  };
})();
