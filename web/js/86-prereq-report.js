// ==========================
// REPORT A WRONG PREREQUISITE
//
// Every plan in this app was transcribed by hand out of a published PDF, and
// some of the arrows are wrong — a prerequisite the document does not list, a
// prerequisite it does list that never made it across, a course number read
// off a scan one digit out. Nothing in the build can find those: the source is
// the only authority and the source is what was misread.
//
// The people who WILL find them are students, one at a time, at the moment a
// course says it is closed to them and they know for a fact it is not. That
// moment is the only chance this data has of getting corrected, and it lasts
// about four seconds. So the report is one tap from the course itself, it
// arrives with the plan, the course and the prerequisite list already attached,
// and the only thing the student has to supply is which arrow is wrong and,
// optionally, a sentence.
//
// WHERE IT GOES
// A report is sent to the same Worker that already receives plan
// contributions (workers/contributions-worker.js), tagged kind:'prereq-report'
// so the admin panel can tell the two apart. If no Worker is configured —
// which is the case for anyone running this app from a plain file server —
// it falls back to a pre-filled mailto:, the same channel js/22-feedback.js
// has always used. Either way the student's own copy is kept in
// localStorage, so the popup can say "you already reported this" instead of
// letting the same arrow be sent ten times.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not edit the plan. A student saying an arrow is wrong is evidence,
// not a decision — the catalogue in data/ stays exactly as published until a
// maintainer checks the report against the document. A student who needs the
// course unblocked today can already remove the prerequisite in Edit Mode;
// that is a private change to their own copy and it is a separate thing.
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_prereqReports';
  var MAILTO = 'pmhtrfalab999@gmail.com';

  var TX = {
    en: {
      lbl: 'Prerequisite looks wrong?',
      open: 'Report it',
      title: 'Which prerequisite is wrong?',
      lead: 'This was typed in by hand from the published plan, so some of it is wrong. Tell us which one and we will check it against the document.',
      extra: 'Not listed here — something else is wrong',
      noteLbl: 'Anything else? (optional)',
      notePh: 'e.g. the plan says 010610025, the card says 010610026',
      send: 'Send report',
      cancel: 'Cancel',
      sent: 'Sent — thank you. This one gets checked against the plan document.',
      queued: 'Saved. It will be sent the next time you are online.',
      already: 'You already reported this course.',
      mail: 'Opening your mail app with the report filled in.',
      none: 'This course has no prerequisites listed, so there is nothing to correct here.'
    },
    ar: {
      lbl: 'المتطلب السابق غلط؟',
      open: 'بلّغ عنه',
      title: 'أي متطلب سابق غلط؟',
      lead: 'هاي الخطة متكتوبة بالإيد من الخطة المنشورة، فبعضها غلط. قلنا أي واحد ومنراجعه على الوثيقة.',
      extra: 'مش من هدول — في إشي تاني غلط',
      noteLbl: 'في إشي كمان؟ (اختياري)',
      notePh: 'مثلًا: الخطة بتقول 010610025 والبطاقة بتقول 010610026',
      send: 'إرسال البلاغ',
      cancel: 'إلغاء',
      sent: 'انبعت — شكرًا. رح نراجعه على وثيقة الخطة.',
      queued: 'انحفظ. رح ينبعت أول ما ترجع أونلاين.',
      already: 'أنت بلّغت عن هذا المساق من قبل.',
      mail: 'عم نفتح تطبيق البريد والبلاغ جاهز فيه.',
      none: 'هذا المساق ما إله متطلبات سابقة مسجّلة، فما في إشي نصححه.'
    }
  };
  function t(rtl){ return TX[rtl ? 'ar' : 'en']; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }
  function ic(k, n){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview(k, n || 14) : ''; }

  // ---------------------------------------------------------------------
  // What has already been reported, by "plan-c-slug" — the same id the rest
  // of the app uses for a course, so a report survives a plan being renamed.
  function loadSent(){
    return (window.AAUP_STORAGE && window.AAUP_STORAGE.getJSON)
      ? (window.AAUP_STORAGE.getJSON(KEY, {}) || {}) : {};
  }
  function saveSent(m){
    if(window.AAUP_STORAGE && window.AAUP_STORAGE.setJSON) window.AAUP_STORAGE.setJSON(KEY, m);
  }
  function fullId(prefix, slug){ return prefix + '-c-' + slug; }
  function alreadySent(prefix, slug){ return !!loadSent()[fullId(prefix, slug)]; }

  function courseName(prefix, slug, rtl){
    var info = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[slug] || {};
    if(rtl && info.ar) return info.ar;
    return info.name || info.en || slug;
  }
  function courseNum(prefix, slug){
    var info = ((window.__PLAN_DATA[prefix] || {}).courseInfo || {})[slug] || {};
    return info.num == null ? '' : String(info.num);
  }
  function needsOf(prefix, slug){
    return ((window.__PLAN_DATA[prefix] || {}).needsMap || {})[slug] || [];
  }

  // ---------------------------------------------------------------------
  // The line on the course itself. Shown on every course that has at least
  // one prerequisite — a course with none has no arrow to be wrong about,
  // and offering to report one there is an invitation to noise.
  function lineHtml(prefix, slug, rtl){
    if(!needsOf(prefix, slug).length) return '';
    var tx = t(rtl);
    var done = alreadySent(prefix, slug);
    return '<div class="cd-report">' +
      '<span class="cd-report-lbl">' + esc(tx.lbl) + '</span>' +
      (done
        ? '<span class="cd-report-done">' + ic('tick', 13) + esc(tx.already) + '</span>'
        : '<button type="button" class="cd-report-btn" data-prereq-report="' +
          esc(prefix) + '|' + esc(slug) + '">' + esc(tx.open) + '</button>') +
    '</div>';
  }

  // ---------------------------------------------------------------------
  // The form. One radio per listed prerequisite plus an "something else"
  // row, and one optional sentence. Nothing is required beyond the choice,
  // because a report that demands an essay is a report nobody files.
  function open(prefix, slug){
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var tx = t(rtl);
    var needs = needsOf(prefix, slug);
    if(!needs.length){ if(window.__showToast) window.__showToast(tx.none); return; }
    if(alreadySent(prefix, slug)){ if(window.__showToast) window.__showToast(tx.already); return; }

    var overlay = document.getElementById('prereqReportOverlay');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'prereqReportOverlay';
      overlay.innerHTML = '<div class="modal-card"><div class="modal-body" id="prereqReportBody"></div></div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e){
        if(e.target === overlay) overlay.classList.remove('open');
      });
    }
    var body = overlay.querySelector('#prereqReportBody');
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    var rows = needs.map(function(n, i){
      var num = courseNum(prefix, n);
      return '<label class="pr-opt"><input type="radio" name="prWhich" value="' + esc(n) + '"' +
        (i === 0 ? ' checked' : '') + '>' +
        '<span class="pr-opt-name">' + esc(courseName(prefix, n, rtl)) + '</span>' +
        (num ? '<span class="pr-opt-num">' + esc(num) + '</span>' : '') + '</label>';
    }).join('');
    body.innerHTML =
      '<h2 class="mh">' + ic('warning', 18) + esc(tx.title) + '</h2>' +
      '<p class="form-note" style="margin-top:0;">' + esc(tx.lead) + '</p>' +
      '<p class="pr-course">' + esc(courseName(prefix, slug, rtl)) + '</p>' +
      '<div class="pr-opts">' + rows +
        '<label class="pr-opt"><input type="radio" name="prWhich" value="">' +
        '<span class="pr-opt-name">' + esc(tx.extra) + '</span></label>' +
      '</div>' +
      // .form-field is what styles a textarea everywhere else in the app —
      // without it the browser default (white box, monospace) shows through.
      '<div class="form-field"><label for="prNote" class="pr-note-lbl">' + esc(tx.noteLbl) + '</label>' +
      '<textarea id="prNote" rows="3" placeholder="' + esc(tx.notePh) + '"></textarea></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="home-btn" id="prCancel">' + esc(tx.cancel) + '</button> ' +
        '<button type="button" class="home-btn pr-send" id="prSend">' + esc(tx.send) + '</button>' +
      '</div>';
    overlay.classList.add('open');

    body.querySelector('#prCancel').onclick = function(){ overlay.classList.remove('open'); };
    body.querySelector('#prSend').onclick = function(){
      var picked = body.querySelector('input[name="prWhich"]:checked');
      send(prefix, slug, picked ? picked.value : '', body.querySelector('#prNote').value, rtl);
      overlay.classList.remove('open');
      // The line inside the course popup says "already reported" from now on.
      var host = document.querySelector('[data-prereq-report]');
      if(host && host.getAttribute('data-prereq-report') === prefix + '|' + slug){
        var wrap = host.parentElement;
        if(wrap) wrap.innerHTML = '<span class="cd-report-lbl">' + esc(tx.lbl) + '</span>' +
          '<span class="cd-report-done">' + ic('tick', 13) + esc(tx.already) + '</span>';
      }
    };
  }

  // ---------------------------------------------------------------------
  // Sending. The Worker when one is configured, a pre-filled mail draft when
  // there is not. Recorded locally either way and BEFORE the network call, so
  // a report written on a train is not lost and is not sent twice.
  function payload(prefix, slug, wrongSlug, note){
    return {
      kind: 'prereq-report',
      prefix: prefix,
      majorName: majorNameOf(prefix),
      deviceId: window.__deviceId ? window.__deviceId() : 'd-anon',
      course: { id: slug, num: courseNum(prefix, slug), name: courseName(prefix, slug, false) },
      wrongPrereq: wrongSlug
        ? { id: wrongSlug, num: courseNum(prefix, wrongSlug), name: courseName(prefix, wrongSlug, false) }
        : null,
      listedPrereqs: needsOf(prefix, slug).map(function(n){
        return { id: n, num: courseNum(prefix, n), name: courseName(prefix, n, false) };
      }),
      note: String(note || '').slice(0, 500),
      at: new Date().toISOString()
    };
  }

  function majorNameOf(prefix){
    var plans = window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans() : {};
    var p = plans[prefix];
    var n = p && p.majorName && p.majorName.en;
    return (n && (n.big || n)) || prefix;
  }

  function send(prefix, slug, wrongSlug, note, rtl){
    var tx = t(rtl);
    var body = payload(prefix, slug, wrongSlug, note);
    var sent = loadSent();
    sent[fullId(prefix, slug)] = { at: body.at, wrong: wrongSlug || '', delivered: false, body: body };
    saveSent(sent);

    var url = (window.APP_CONTRIB_URL || '').replace(/\/+$/, '');
    if(!url){
      // A mail draft is handed to the student's own mail app; nothing here
      // can retry it, so the record is closed rather than left for
      // flushPending() to reattempt forever.
      sent[fullId(prefix, slug)].delivered = true;
      sent[fullId(prefix, slug)].via = 'mail';
      delete sent[fullId(prefix, slug)].body;
      saveSent(sent);
      mail(body, tx);
      return;
    }
    fetch(url + '/contributions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      var m = loadSent();
      if(m[fullId(prefix, slug)]) { m[fullId(prefix, slug)].delivered = true; saveSent(m); }
      if(window.__showToast) window.__showToast(tx.sent);
    }).catch(function(){
      // Kept locally, marked undelivered. flushPending() retries it.
      if(window.__showToast) window.__showToast(tx.queued);
    });
  }

  function mail(body, tx){
    // The draft opens in the student's own mail app, so it is in their
    // language; the course numbers are what the maintainer goes by.
    var L = window.__L;
    var A = !!(window.AAUP_LANG && window.AAUP_LANG.isAr());
    var nm = function(c){ return A ? courseName(body.prefix, c.id, true) : c.name; };
    var major = body.majorName;
    if(A){
      var mp = (window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans() : {})[body.prefix];
      var ma = mp && mp.majorName && mp.majorName.ar;
      if(ma && (ma.big || typeof ma === 'string')) major = ma.big || ma;
    }
    var lines = [
      L('Plan: ', 'الخطة: ') + major + ' (' + body.prefix + ')',
      L('Course: ', 'المساق: ') + nm(body.course) + (body.course.num ? ' [' + body.course.num + ']' : ''),
      L('Prerequisite reported wrong: ', 'المتطلب الغلط: ') + (body.wrongPrereq
        ? nm(body.wrongPrereq) + (body.wrongPrereq.num ? ' [' + body.wrongPrereq.num + ']' : '')
        : L('(not one of the listed ones)', '(مش من المتطلبات المذكورة)')),
      L('All prerequisites the app lists: ', 'المتطلبات اللي بالتطبيق: ') + (body.listedPrereqs.map(function(p){
        return nm(p) + (p.num ? ' [' + p.num + ']' : '');
      }).join(L(', ', '، ')) || L('(none)', '(ولا إشي)')),
      '', body.note || ''
    ];
    var href = 'mailto:' + MAILTO +
      '?subject=' + encodeURIComponent(L('AAUPath — wrong prerequisite: ', 'متطلب سابق غلط: ') + nm(body.course)) +
      '&body=' + encodeURIComponent(lines.join('\n'));
    if(window.__showToast) window.__showToast(tx.mail);
    window.location.href = href;
  }

  // Retries anything that was written while offline. Called on load and
  // whenever the browser says the connection is back.
  function flushPending(){
    var url = (window.APP_CONTRIB_URL || '').replace(/\/+$/, '');
    if(!url || !navigator.onLine) return;
    var m = loadSent();
    Object.keys(m).forEach(function(id){
      var rec = m[id];
      if(!rec || rec.delivered || !rec.body) return;
      fetch(url + '/contributions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec.body)
      }).then(function(r){
        if(!r.ok) return;
        var cur = loadSent();
        if(cur[id]){ cur[id].delivered = true; saveSent(cur); }
      }).catch(function(){});
    });
  }
  window.addEventListener('online', flushPending);

  // Delegated because the course popup replaces its own body on every open.
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-prereq-report]');
    if(!btn) return;
    var parts = (btn.getAttribute('data-prereq-report') || '').split('|');
    if(parts.length === 2) open(parts[0], parts[1]);
  });

  window.AAUP_PREREQ_REPORT = {
    lineHtml: lineHtml, open: open, alreadySent: alreadySent, flushPending: flushPending
  };
})();
