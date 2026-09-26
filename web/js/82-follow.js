// ==========================
// FOLLOW A FRIEND'S PLAN
//
// Same year, same major, different pace. Two students comparing notes is the
// most ordinary thing in a semester and the app had no way to do it: you
// could share your PLAN, but not where you are on it.
//
// A follow link carries a snapshot, not an account: which plan, a display
// name the sender types, and the list of courses they have passed. No grades,
// no GPA, nothing the sender did not choose to send — and no server: it is
// the same offline #hash link the rest of js/72-share.js uses, so nothing is
// published anywhere by making one.
//
// It is a snapshot on purpose. It says when it was taken, and it does not
// update itself — an app that silently kept showing a friend's progress
// would be tracking them, which is a different thing from being sent it.
// ==========================
(function(){
  'use strict';

  var KEY = 'aaup_following';
  var VERSION = 1;

  var TX = {
    title:    { en: 'Friends', ar: 'أصدقاء' },
    you:      { en: 'You', ar: 'أنت' },
    ahead:    { en: 'Ahead of you in', ar: 'سبقك في' },
    behindYou:{ en: 'You are ahead in', ar: 'أنت سابقه في' },
    same:     { en: 'Exactly level with you.', ar: 'نفس تقدّمك تمامًا.' },
    taken:    { en: 'snapshot from {d}', ar: 'لقطة من {d}' },
    remove:   { en: 'Remove', ar: 'إزالة' },
    shareMine:{ en: 'Share my progress', ar: 'شارك تقدّمي' },
    nameAsk:  { en: 'Share your progress as…', ar: 'شارك تقدّمك باسم…' },
    nameHint: { en: 'Whoever opens the link sees this name, your plan, and which courses you have passed. No grades, no GPA.',
                ar: 'اللي بيفتح الرابط بيشوف هالاسم وخطتك والمساقات اللي نجحت فيها. بدون علامات وبدون معدل.' },
    build:    { en: 'Make the link', ar: 'اعمل الرابط' },
    copy:     { en: 'Copy link', ar: 'انسخ الرابط' },
    copied:   { en: 'Copied', ar: 'تم النسخ' },
    cancel:   { en: 'Cancel', ar: 'إلغاء' },
    askFollow:{ en: '{n} shared their progress in {p}. Follow it?', ar: 'شارك {n} تقدّمه في {p}. تتابعه؟' },
    followed: { en: 'Following {n}.', ar: 'صرت تتابع {n}.' },
    wrongPlan:{ en: 'That snapshot is for a plan you do not have open.', ar: 'هاي اللقطة لخطة مش مفتوحة عندك.' }
  };
  function t(k, r){ return r ? TX[k].ar : TX[k].en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }

  function load(){
    try{ return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(e){ return {}; }
  }
  function save(map){
    try{ localStorage.setItem(KEY, JSON.stringify(map)); }catch(e){}
  }

  // ---- what a snapshot is --------------------------------------------------

  // Passed courses, read the same way every other screen reads them: off the
  // rendered plan, so a course the student removed from their own plan is not
  // in it and a retake's superseded original is not double-counted.
  function snapshotOf(prefix, name){
    var page = document.getElementById('page-' + prefix);
    if(!page) return null;
    var done = [], doneCr = 0, total = 0;
    if(window.AAUP_AUDIT){
      window.AAUP_AUDIT.computeAudit(prefix).forEach(function(r){ total += r.total; doneCr += r.completed; });
    }
    page.querySelectorAll('.course[id].completed:not(.course-removed)').forEach(function(el){
      done.push(el.id.replace(prefix + '-c-', ''));
    });
    return { v: VERSION, plan: prefix, name: name || '', done: done,
             doneCr: Math.round(doneCr * 10) / 10, total: Math.round(total * 10) / 10,
             at: Date.now() };
  }

  function courseName(prefix, slug, rtl){
    var info = (window.__PLAN_DATA[prefix] || {}).courseInfo || {};
    var meta = info[slug];
    if(!meta) return slug;
    return (rtl && meta.ar) ? meta.ar : (meta.name || slug);
  }

  // What each of you has that the other does not. Both directions, because a
  // comparison that only ever runs one way is a scoreboard.
  function diff(prefix, snap){
    var page = document.getElementById('page-' + prefix);
    var mine = {};
    if(page){
      page.querySelectorAll('.course[id].completed:not(.course-removed)').forEach(function(el){
        mine[el.id.replace(prefix + '-c-', '')] = true;
      });
    }
    var theirs = {};
    (snap.done || []).forEach(function(s){ theirs[s] = true; });
    var ahead = Object.keys(theirs).filter(function(s){ return !mine[s]; });
    var behind = Object.keys(mine).filter(function(s){ return !theirs[s]; });
    return { ahead: ahead, behind: behind };
  }

  // ---- the card on the dashboard -------------------------------------------

  function sectionHtml(prefix, rtl){
    var all = load();
    var ids = Object.keys(all).filter(function(id){ return all[id] && all[id].plan === prefix; });
    if(!ids.length) return '';

    var myDone = 0, myTotal = 0;
    if(window.AAUP_AUDIT){
      window.AAUP_AUDIT.computeAudit(prefix).forEach(function(r){ myTotal += r.total; myDone += r.completed; });
    }
    function bar(doneCr, total, label, cls){
      var pct = total ? Math.max(0, Math.min(100, Math.round(doneCr / total * 100))) : 0;
      return '<div class="fl-row' + (cls ? ' ' + cls : '') + '">' +
        '<div class="fl-line"><span class="fl-name">' + esc(label) + '</span>' +
        '<span class="fl-num">' + doneCr + ' / ' + total + 'H</span></div>' +
        '<div class="fl-track"><i style="width:' + pct + '%;"></i></div></div>';
    }

    return '<div class="dash-card fl-card" style="margin-bottom:20px;">' +
      '<h3 class="mh">' + window.AAUP_ICONS.preview('people', 18) + esc(t('title', rtl)) + '</h3>' +
      bar(Math.round(myDone * 10) / 10, Math.round(myTotal * 10) / 10, t('you', rtl), 'fl-me') +
      ids.map(function(id){
        var snap = all[id];
        var d = diff(prefix, snap);
        var when = new Date(snap.at || Date.now()).toISOString().slice(0, 10);
        var aheadTx = d.ahead.length
          ? t('ahead', rtl) + ': ' + d.ahead.slice(0, 3).map(function(s){ return courseName(prefix, s, rtl); }).join(', ') +
            (d.ahead.length > 3 ? ' +' + (d.ahead.length - 3) : '')
          : (d.behind.length ? t('behindYou', rtl) + ': ' + d.behind.length : t('same', rtl));
        return bar(snap.doneCr || 0, snap.total || myTotal, snap.name || '—', '') +
          '<p class="fl-note">' + esc(aheadTx) + ' · ' +
          esc(t('taken', rtl).replace('{d}', when)) +
          ' <button type="button" class="fl-x" data-fl-remove="' + esc(id) + '">' + esc(t('remove', rtl)) + '</button></p>';
      }).join('') +
      '</div>';
  }

  function bind(prefix){
    document.querySelectorAll('[data-fl-remove]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var all = load();
        delete all[btn.getAttribute('data-fl-remove')];
        save(all);
        if(window.AAUP_DASHBOARD) window.AAUP_DASHBOARD.open(prefix);
      });
    });
  }

  // ---- making a link -------------------------------------------------------

  function open(prefix){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body || !window.AAUP_SHARE || !window.AAUP_SHARE.encodePayload) return;
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var me = (window.AAUP_STUDENT && window.AAUP_STUDENT.get && window.AAUP_STUDENT.get()) || {};
    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('people', 20) + esc(t('nameAsk', rtl)) + '</h2>' +
      '<div class="form-field"><input type="text" id="flName" maxlength="40" value="' + esc(me.name || '') + '" placeholder="' + esc(t('you', rtl)) + '"></div>' +
      '<p class="form-note">' + esc(t('nameHint', rtl)) + '</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="home-btn btn-pri" id="flGo">' +
          window.AAUP_ICONS.preview('link', 14) + esc(t('build', rtl)) + '</button>' +
        '<button type="button" class="home-btn" id="flCancel">' + esc(t('cancel', rtl)) + '</button>' +
      '</div>' +
      '<div id="flOut"></div>';
    overlay.classList.add('open');
    document.getElementById('flCancel').addEventListener('click', function(){ overlay.classList.remove('open'); });
    document.getElementById('flGo').addEventListener('click', function(){
      var snap = snapshotOf(prefix, (document.getElementById('flName').value || '').trim());
      if(!snap) return;
      window.AAUP_SHARE.encodePayload('follow', snap).then(function(url){
        var out = document.getElementById('flOut');
        out.innerHTML = '<div class="share-link-row"><input type="text" class="share-link-input" id="flLink" readonly dir="ltr" value="' + esc(url) + '"></div>' +
          '<div class="form-actions"><button type="button" class="home-btn" id="flCopy">' +
          window.AAUP_ICONS.preview('copy', 14) + esc(t('copy', rtl)) + '</button></div>';
        var input = document.getElementById('flLink');
        document.getElementById('flCopy').addEventListener('click', function(){
          var btn = this;
          var done = function(){ btn.innerHTML = window.AAUP_ICONS.preview('check', 14) + esc(t('copied', rtl)); };
          if(navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(url).then(done, function(){ input.select(); document.execCommand('copy'); done(); });
          } else { input.select(); document.execCommand('copy'); done(); }
        });
      });
    });
  }

  // ---- opening one ---------------------------------------------------------

  function accept(snap){
    if(!snap || snap.v !== VERSION || !snap.plan) return;
    var rtl = window.__isRtl ? window.__isRtl(snap.plan) : false;
    var name = snap.name || '—';
    var planName = (window.AAUP_DASHBOARD && window.AAUP_DASHBOARD.planDisplayInfo)
      ? (window.AAUP_DASHBOARD.planDisplayInfo(snap.plan).name || snap.plan) : snap.plan;
    var msg = t('askFollow', rtl).replace('{n}', name).replace('{p}', planName);
    var go = function(){
      var all = load();
      all[snap.plan + '::' + name + '::' + (snap.at || Date.now())] = snap;
      save(all);
      if(window.__showToast) window.__showToast(t('followed', rtl).replace('{n}', name));
      if(window.AAUP_DASHBOARD) window.AAUP_DASHBOARD.selectAndOpen(snap.plan);
    };
    if(window.__showConfirmDialog){ window.__showConfirmDialog(msg, go); }
    else if(window.confirm(msg)){ go(); }
  }

  window.AAUP_FOLLOW = {
    open: open, accept: accept, sectionHtml: sectionHtml, bind: bind, snapshotOf: snapshotOf
  };
})();
