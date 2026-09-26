// ==========================
// THOUGHTS — a shared wall for everyone studying the same major.
//
// Write one line, press Send, and it is live for every student on that plan.
// "Show thoughts" opens the wall full-screen.
//
// THREE RULES, IN THE ORDER THEY RUN
//
// 1. The word filter (js/58-wordfilter.js) checks the text BEFORE anything
//    else happens. A rejected thought is never stored, never queued, never
//    sent — it does not exist. The student gets one of a set of messages and
//    the text stays in the box so they can edit rather than retype.
// 2. A thought is text written by a stranger and rendered in everyone else's
//    browser, which is the exact shape of an XSS hole. It is escaped exactly
//    ONCE, at render, and never handed to innerHTML unescaped anywhere in
//    this file. Escaping on the way in as well looks safer and is not: the
//    text gets escaped twice and a student who types "<3" reads back "&lt;3".
// 3. Offline is normal here, not an error. A thought written on the bus is
//    queued and posted the next time the app has a connection — the student
//    is told which of the two happened rather than being left guessing.
//
// The wall lives on its own Worker (workers/thoughts-worker.js), separate
// from the admin one on purpose: this endpoint takes writes from anyone with
// the app, so it must not sit behind the same key that can commit to the
// repository. Until APP_THOUGHTS_URL is configured the whole feature runs
// device-local — you can write, read and delete your own thoughts, and
// nothing leaves the phone.
// ==========================
(function(){
  'use strict';

  var LOCAL_KEY = 'aaup_thoughts';        // this device's own thoughts
  var QUEUE_KEY = 'aaup_thoughtsQueue';   // written offline, not yet posted
  var CACHE_KEY = 'aaup_thoughtsCache';   // last wall we successfully fetched
  var REACT_KEY = 'aaup_thoughtReactions'; // { thoughtId: 'up'|'down' } — this device's own reactions
  var MAX_LEN = 280;
  var COOLDOWN_MS = 20 * 1000;            // between one student's posts

  function esc(s){ return window.__escapeHtml(s == null ? '' : String(s)); }
  function store(){ return window.AAUP_STORAGE; }
  // The server can be set two ways: baked into js/01-catalogue.js at build
  // time, or pasted into Settings → Data on the device. The stored one wins,
  // because someone who has just deployed their Worker is holding a phone,
  // not a text editor.
  var URL_KEY = 'aaup_thoughtsUrl';
  function storedUrl(){
    try{ return localStorage.getItem(URL_KEY) || ''; }catch(e){ return ''; }
  }
  function endpoint(){ return storedUrl() || window.APP_THOUGHTS_URL || ''; }
  function setServerUrl(v){
    v = String(v || '').trim().replace(/\/+$/, '');
    if(v && !/^https:\/\/[^\s]+$/i.test(v)) return false;
    try{ if(v) localStorage.setItem(URL_KEY, v); else localStorage.removeItem(URL_KEY); }catch(e){}
    return true;
  }
  function online(){ return typeof navigator === 'undefined' || navigator.onLine !== false; }

  function isRtl(prefix){ return window.__isRtl ? window.__isRtl(prefix) : false; }

  // ---- the rejection messages --------------------------------------------
  //
  // A blocked post is the one moment this feature talks back, so it does it
  // with a joke rather than a scolding — the student is a classmate, not a
  // suspect. Every message ends the same way, because the instruction has to
  // be clear even when the joke is not.
  var REJECT_EN = [
    'Nope. Your keyboard slipped and hit a word we cannot publish.',
    'That word is doing the heavy lifting there, and it is not coming with us.',
    'Blocked. Somewhere a lecturer felt that one.',
    'We ran that past the filter and the filter said absolutely not.',
    'Bold. Illegal, but bold.',
    'The wall has standards, and that word is under all of them.',
    'Not posting that one. Your future employer thanks us.',
    'That is a no from the filter, and the filter does not negotiate.',
    'Strong words. Wrong app.',
    'Rejected — try saying it the way you would in front of your mother.'
  ];
  var REJECT_AR = [
    'لأ. إصبعك زلّ على كلمة ما بنقدر ننشرها.',
    'الكلمة هاي شايلة الموضوع كله، وما رح تمرّ معنا.',
    'مرفوض. في دكتور حسّ فيها من بعيد.',
    'مرّرناها على الفلتر، والفلتر قال أبداً.',
    'جريئة. ممنوعة، بس جريئة.',
    'الحائط عندو مبادئ، والكلمة هاي تحتها كلها.',
    'ما رح ننشرها. صاحب الشغل المستقبلي بيشكرنا.',
    'الفلتر قال لأ، والفلتر ما بيفاوض.',
    'كلام قوي. تطبيق غلط.',
    'مرفوضة — جرّب تقولها زي ما بتقولها قدام أمك.'
  ];
  function rejectMessage(rtl, word){
    var list = rtl ? REJECT_AR : REJECT_EN;
    var msg = list[Math.floor(Math.random() * list.length)];
    var tail = rtl
      ? ' احذف كلمة «' + word + '» وجرّب مرة ثانية.'
      : ' Remove “' + word + '” and try again.';
    return msg + tail;
  }

  // ---- storage ------------------------------------------------------------

  function loadLocal(){ return store().getJSON(LOCAL_KEY, []); }
  function saveLocal(list){ store().setJSON(LOCAL_KEY, list.slice(0, 200)); }
  function loadQueue(){ return store().getJSON(QUEUE_KEY, []); }
  function saveQueue(list){ store().setJSON(QUEUE_KEY, list.slice(0, 50)); }
  function loadCache(){ return store().getJSON(CACHE_KEY, {}); }
  function saveCache(map){ store().setJSON(CACHE_KEY, map); }
  function loadReactions(){ return store().getJSON(REACT_KEY, {}); }
  function saveReactions(map){ store().setJSON(REACT_KEY, map); }

  function displayName(){
    var s = window.AAUP_STUDENT ? window.AAUP_STUDENT.get() : null;
    var n = s && (s.name || s.displayName);
    return (n && String(n).trim()) || '';
  }

  // A stable id for this device so a student can delete their own thought
  // from the wall without any account existing. Shared with js/14-storage.js
  // (window.__deviceId) — same identity everywhere it's needed.
  function deviceId(){ return window.__deviceId ? window.__deviceId() : 'd-anon'; }

  var lastPostAt = 0;

  // ---- network ------------------------------------------------------------

  function postThought(item){
    var url = endpoint();
    if(!url) return Promise.reject(new Error('not configured'));
    return fetch(url.replace(/\/$/, '') + '/thoughts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchWall(prefix){
    var url = endpoint();
    if(!url) return Promise.resolve(null);
    return fetch(url.replace(/\/$/, '') + '/thoughts?plan=' + encodeURIComponent(prefix), {
      method: 'GET'
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(data){
      var list = (data && Array.isArray(data.thoughts)) ? data.thoughts : [];
      // Everything from the wire is a stranger's text. It is length-capped and
      // typed here, then escaped at render (thoughtHTML) like every other
      // thought — one escape, in one place, for both sources.
      list = list.slice(0, 200).map(function(t){
        return {
          id: String(t.id || '').slice(0, 60),
          text: String(t.text || '').slice(0, MAX_LEN),
          name: String(t.name || '').slice(0, 40),
          at: Number(t.at) || 0,
          by: String(t.by || '').slice(0, 40),
          up: Number(t.up) || 0,
          down: Number(t.down) || 0
        };
      }).filter(function(t){ return t.text; });
      var cache = loadCache();
      cache[prefix] = { at: Date.now(), list: list };
      saveCache(cache);
      return list;
    });
  }

  // Anything written while offline goes out on the next connection.
  function flushQueue(){
    var q = loadQueue();
    if(!q.length || !endpoint() || !online()) return Promise.resolve(0);
    var sent = 0;
    return q.reduce(function(chain, item){
      return chain.then(function(){
        return postThought(item).then(function(){ sent++; }).catch(function(){});
      });
    }, Promise.resolve()).then(function(){
      // Keep only what genuinely failed.
      saveQueue(q.slice(sent));
      return sent;
    });
  }

  // ---- publishing ---------------------------------------------------------

  // Returns { ok: true, queued: bool } or { ok: false, reason, message }.
  function publish(prefix, text){
    var rtl = isRtl(prefix);
    var raw = String(text || '').trim();

    if(!raw){
      return { ok: false, reason: 'empty',
        message: rtl ? 'اكتب شيئًا أولاً.' : 'Write something first.' };
    }
    if(raw.length > MAX_LEN){
      return { ok: false, reason: 'long',
        message: rtl ? ('أطول من اللازم — الحد ' + MAX_LEN + ' حرفًا.')
                     : ('Too long — ' + MAX_LEN + ' characters is the limit.') };
    }
    // Rule 1: the filter runs before anything is stored or sent.
    var verdict = window.AAUP_WORDFILTER ? window.AAUP_WORDFILTER.check(raw) : { clean: true };
    if(!verdict.clean){
      return { ok: false, reason: 'blocked', word: verdict.word,
        message: rejectMessage(rtl, verdict.word) };
    }
    // The cooldown is checked AFTER the filter on purpose: a student told to
    // "remove that word and try again" must be able to do exactly that
    // straight away. Only a post that actually goes out starts the clock.
    var now = Date.now();
    if(now - lastPostAt < COOLDOWN_MS){
      var wait = Math.ceil((COOLDOWN_MS - (now - lastPostAt)) / 1000);
      return { ok: false, reason: 'slow',
        message: rtl ? ('استنى ' + wait + ' ثانية قبل التالية.')
                     : ('Give it ' + wait + 's before the next one.') };
    }

    // Stored as written. Escaping happens once, at render (thoughtHTML), the
    // same way for a thought from this device and one from the wire — escape
    // it here too and a student who types "<3" reads back "&lt;3".
    var item = {
      id: deviceId() + '-' + now.toString(36),
      plan: prefix,
      text: raw,
      name: displayName(),
      at: now,
      by: deviceId()
    };

    var mine = loadLocal();
    mine.unshift(item);
    saveLocal(mine);
    lastPostAt = now;

    if(!endpoint()){
      return { ok: true, queued: false, local: true, item: item };
    }
    if(!online()){
      var q = loadQueue();
      q.push(item);
      saveQueue(q);
      return { ok: true, queued: true, item: item };
    }
    // Fire-and-forget, but not silent: a failure here (a Worker returning a
    // 500, not just a dropped connection) still has to land the item in the
    // queue AND tell the student — otherwise the UI already said "Posted."
    // and the thought quietly disappears with no correction on screen, which
    // is exactly what made a server-side failure look identical to nothing
    // having happened. `pending` lets the caller react once this settles.
    var pending = postThought(item).catch(function(){
      var q2 = loadQueue();
      q2.push(item);
      saveQueue(q2);
      throw new Error('send failed, queued for retry');
    });
    return { ok: true, queued: false, item: item, pending: pending };
  }

  function removeMine(id){
    saveLocal(loadLocal().filter(function(t){ return t.id !== id; }));
    saveQueue(loadQueue().filter(function(t){ return t.id !== id; }));
    var url = endpoint();
    if(url && online()){
      fetch(url.replace(/\/$/, '') + '/thoughts/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ by: deviceId() })
      }).catch(function(){});
    }
  }

  function postReaction(id, plan, kind){
    var url = endpoint();
    if(!url) return Promise.reject(new Error('not configured'));
    return fetch(url.replace(/\/$/, '') + '/thoughts/' + encodeURIComponent(id) + '/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: plan, by: deviceId(), kind: kind })
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Updates the cached wall's counts and this device's own reaction record —
  // used both for the optimistic tap and to reconcile with what the server
  // actually settled on afterward, since another device's vote landing in
  // between is rare but not impossible and the server's count is the real one.
  function applyReactionLocally(prefix, id, up, down, mine){
    var cache = loadCache();
    var entry = cache[prefix];
    if(entry && Array.isArray(entry.list)){
      entry.list.forEach(function(t){ if(t.id === id){ t.up = up; t.down = down; } });
      saveCache(cache);
    }
    var reactions = loadReactions();
    if(mine){ reactions[id] = mine; } else { delete reactions[id]; }
    saveReactions(reactions);
  }

  // Tapping the same reaction twice clears it — a real "un-react", not just
  // a switch. Renders immediately off the optimistic count so the tap feels
  // instant, then reconciles (or rolls back on failure) once the Worker answers.
  function toggleReaction(prefix, id, kind){
    if(!online() || !endpoint()) return;
    var current = loadReactions()[id] || null;
    var next = (current === kind) ? null : kind;

    var cache = loadCache();
    var entry = cache[prefix];
    var item = entry && Array.isArray(entry.list) && entry.list.filter(function(t){ return t.id === id; })[0];
    var beforeUp = (item && item.up) || 0, beforeDown = (item && item.down) || 0;
    var up = beforeUp, down = beforeDown;
    if(current === 'up') up--; if(current === 'down') down--;
    if(next === 'up') up++; if(next === 'down') down++;
    applyReactionLocally(prefix, id, Math.max(0, up), Math.max(0, down), next);
    render(prefix);

    postReaction(id, prefix, next).then(function(res){
      applyReactionLocally(prefix, id, res.up || 0, res.down || 0, res.mine || null);
      var overlay = document.getElementById('thoughtsModalOverlay');
      if(overlay && overlay.classList.contains('open')) render(prefix);
    }).catch(function(){
      applyReactionLocally(prefix, id, beforeUp, beforeDown, current);
      var overlay = document.getElementById('thoughtsModalOverlay');
      if(overlay && overlay.classList.contains('open')) render(prefix);
    });
  }

  // The wall as it should be shown right now: what the server last gave us,
  // plus anything this device wrote that has not come back yet.
  function wallFor(prefix){
    var cache = loadCache()[prefix];
    var remote = (cache && Array.isArray(cache.list)) ? cache.list : [];
    var seen = Object.create(null);
    remote.forEach(function(t){ seen[t.id] = true; });
    var mine = loadLocal().filter(function(t){
      return t.plan === prefix && !seen[t.id];
    });
    return mine.concat(remote).sort(function(a, b){ return (b.at || 0) - (a.at || 0); });
  }

  // ---- the wall UI --------------------------------------------------------

  function timeAgo(ts, rtl){
    var s = Math.max(0, Math.floor((Date.now() - (ts || 0)) / 1000));
    if(s < 60) return rtl ? 'الآن' : 'just now';
    var m = Math.floor(s / 60);
    if(m < 60) return rtl ? ('قبل ' + m + ' د') : (m + 'm ago');
    var h = Math.floor(m / 60);
    if(h < 24) return rtl ? ('قبل ' + h + ' س') : (h + 'h ago');
    var d = Math.floor(h / 24);
    return rtl ? ('قبل ' + d + ' يوم') : (d + 'd ago');
  }

  // Two letters, not a rendered photo — nothing here has an avatar image to
  // show, and the mockup's own wall gets away with exactly this: initials in
  // a circle. Arabic names split on the same spaces; RTL just reverses which
  // glyph reads first, which initials do not care about.
  function initials(name){
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return '?';
    var first = parts[0].charAt(0);
    var second = parts.length > 1 ? parts[1].charAt(0) : '';
    return (first + second).toUpperCase();
  }

  function thoughtHTML(t, rtl){
    var isMine = t.by === deviceId();
    var name = t.name || (rtl ? 'طالب' : 'A student');
    // Reactions need a real shared wall to mean anything — a device with no
    // server configured only ever sees its own thoughts, so there is nothing
    // to react to.
    var myReaction = endpoint() ? (loadReactions()[t.id] || null) : null;
    return '<div class="th-item' + (isMine ? ' th-mine' : '') + '">' +
      '<div class="th-av" aria-hidden="true">' + esc(initials(name)) + '</div>' +
      '<div class="th-body">' +
        '<div class="th-head">' +
          '<span class="th-who">' + esc(name) + '</span>' +
          '<span class="th-when">' + esc(timeAgo(t.at, rtl)) + '</span>' +
        '</div>' +
        '<p class="th-bubble">' + esc(t.text) + '</p>' +
        (endpoint() ? '<div class="th-react">' +
          '<button type="button" class="th-react-btn' + (myReaction === 'up' ? ' active' : '') + '" data-th-react="up" data-th-id="' + esc(t.id) + '">' + window.AAUP_ICONS.preview('chevronUp', 13) + '<span>' + (t.up || 0) + '</span></button>' +
          '<button type="button" class="th-react-btn' + (myReaction === 'down' ? ' active' : '') + '" data-th-react="down" data-th-id="' + esc(t.id) + '">' + window.AAUP_ICONS.preview('chevron', 13) + '<span>' + (t.down || 0) + '</span></button>' +
        '</div>' : '') +
        (isMine ? '<button type="button" class="th-del" data-th-del="' + esc(t.id) + '">' +
          (rtl ? 'حذف' : 'Delete') + '</button>' : '') +
      '</div>' +
      '</div>';
  }

  function render(prefix, refreshFailed){
    var body = document.getElementById('thoughtsModalBody');
    if(!body) return;
    var rtl = isRtl(prefix);
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    var list = wallFor(prefix);
    var queued = loadQueue().length;

    body.innerHTML =
      // Every other dialog puts its title in an <h2> and passes '' to
      // __backBarHTML — this was the one holdout, passing a title straight
      // into the bar with no heading at all, which rendered as one run-on
      // line ("←Back STUDENT THOUGHTS") instead of a page title.
      window.__backBarHTML('', 'thoughtsModalOverlay', rtl) +
      '<div class="th-topbar">' +
        '<h2 class="mh" style="margin:0;">' + window.AAUP_ICONS.preview('speech', 20) + (rtl ? 'أفكار الطلاب' : 'Student Thoughts') + '</h2>' +
        '<span class="th-live' + (endpoint() ? '' : ' th-live-off') + '"><i></i>' +
          (endpoint() ? (rtl ? 'مباشر' : 'Live') : (rtl ? 'محلي' : 'Local')) + '</span>' +
      '</div>' +
      '<p class="form-note" style="margin-top:2px;">' +
        (rtl
          ? 'اكتب سطرًا يشوفه كل طالب في نفس التخصص. بلا شتائم — الفلتر بيرفضها فورًا.'
          : 'Write one line every student on this plan can see. No abuse — the filter rejects it on the spot.') +
      '</p>' +
      (queued ? '<p class="th-queued">' + (rtl
        ? ('في ' + queued + ' فكرة بانتظار الإرسال — رح تُعاد المحاولة تلقائيًا.')
        : (queued + ' thought' + (queued === 1 ? '' : 's') + ' waiting to send — this device will keep retrying automatically.')) + '</p>' : '') +
      (refreshFailed && endpoint() ? '<p class="th-queued">' + (rtl
        ? 'تعذّر تحديث الحائط من الخادم الآن — جرّب لاحقًا.'
        : 'Could not refresh the wall from the server just now — try again shortly.') + '</p>' : '') +
      '<div class="th-list" id="thList">' +
        (list.length
          ? list.map(function(t){ return thoughtHTML(t, rtl); }).join('')
          : window.__emptyState({ icon: 'speech',
              title: rtl ? 'ما في إشي هون بعد' : 'Nothing here yet',
              text: rtl ? 'ما حدا كتب عن هالفصل لسا. كون أول واحد، بدون اسم.' : 'No one has written here yet. Be the first; it is anonymous.',
              btn: rtl ? 'اكتب إشي' : 'Write something', btnAttr: 'data-th-write' })) +
      '</div>' +
      (endpoint() ? '' : '<p class="form-note th-localnote">' + (rtl
        ? 'الوضع المحلي: أفكارك محفوظة على جهازك فقط، لأن خادم الأفكار غير مُهيّأ بعد.'
        : 'Local mode: your thoughts stay on this device — the thoughts server is not configured yet.') + '</p>') +
      // Pinned to the bottom of the sheet (see the phone-only sticky rule on
      // .th-compose) — the compose box for a message wall belongs where a
      // chat app always puts one, not stacked above the messages it is
      // about to add to.
      '<div class="th-compose">' +
        '<p class="th-error" id="thError" role="alert" hidden></p>' +
        '<div class="th-compose-row">' +
          '<textarea id="thInput" maxlength="' + MAX_LEN + '" rows="1" placeholder="' +
            (rtl ? 'شو رأيك بهالفصل؟' : 'What is on your mind about this semester?') + '"></textarea>' +
          '<button type="button" class="th-send" id="thSend" aria-label="' + (rtl ? 'إرسال' : 'Send') + '">' +
            window.AAUP_ICONS.preview('send', 16) +
          '</button>' +
        '</div>' +
        '<span class="th-count" id="thCount">0 / ' + MAX_LEN + '</span>' +
      '</div>';

    bind(prefix, rtl);
  }

  function bind(prefix, rtl){
    var input = document.getElementById('thInput');
    var send = document.getElementById('thSend');
    var count = document.getElementById('thCount');
    var error = document.getElementById('thError');
    if(!input || !send) return;
    var writeBtn = document.querySelector('[data-th-write]');
    if(writeBtn) writeBtn.addEventListener('click', function(){ input.focus(); });

    // Starts at one row (a chat input, not a form textarea) and grows only
    // as far as an actual multi-line thought needs — capped so one very
    // long line can't push the send button off the bottom of the screen.
    input.addEventListener('input', function(){
      count.textContent = input.value.length + ' / ' + MAX_LEN;
      error.hidden = true;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    });

    send.addEventListener('click', function(){
      var result = publish(prefix, input.value);
      if(!result.ok){
        // Rejected: say why, keep what they wrote so it can be edited.
        error.textContent = result.message;
        error.hidden = false;
        if(result.reason === 'blocked'){ input.focus(); }
        return;
      }
      input.value = '';
      if(count) count.textContent = '0 / ' + MAX_LEN;
      if(window.__showToast){
        window.__showToast(result.queued
          ? (rtl ? 'محفوظة — رح تُعاد المحاولة تلقائيًا.' : 'Saved — sending will retry automatically.')
          : (rtl ? 'تم النشر.' : 'Posted.'));
      }
      render(prefix);
      // The "Posted." toast above is optimistic — it fired the request but
      // did not wait for it. If the Worker comes back with an error a moment
      // later, correct the record rather than leaving "Posted." as the last
      // word: say so and re-render so the queued-count note picks it up
      // immediately instead of only on the next time the wall is opened.
      if(result.pending){
        result.pending.catch(function(){
          if(window.__showToast){
            window.__showToast(rtl ? 'تعذّر الإرسال — رح تُعاد المحاولة تلقائيًا.' : 'Could not send — it will retry automatically.');
          }
          var overlay = document.getElementById('thoughtsModalOverlay');
          if(overlay && overlay.classList.contains('open')) render(prefix);
        });
      }
    });

    document.getElementById('thList').addEventListener('click', function(e){
      var delBtn = e.target.closest('[data-th-del]');
      if(delBtn){ removeMine(delBtn.getAttribute('data-th-del')); render(prefix); return; }
      var reactBtn = e.target.closest('[data-th-react]');
      if(reactBtn){ toggleReaction(prefix, reactBtn.getAttribute('data-th-id'), reactBtn.getAttribute('data-th-react')); }
    });

    bindPullToRefresh(prefix, rtl);
  }

  // ---- pull to refresh (phone) --------------------------------------------
  // Reuses the exact same refresh open() already does in the background —
  // this just gives a student a way to ask for it on demand, with the one
  // gesture every phone already trains for "get me the latest."
  var PULL_THRESHOLD = 64;
  function bindPullToRefresh(prefix, rtl){
    var list = document.getElementById('thList');
    if(!list || !endpoint()) return;   // nothing to pull fresh from
    var startY = 0, pulling = false, dist = 0, active = false;
    var hint = document.createElement('div');
    hint.className = 'th-pull-hint';
    hint.innerHTML = window.AAUP_ICONS.preview('chevron', 13) +
      '<span>' + (rtl ? 'اسحب للتحديث' : 'Pull to refresh') + '</span>';
    list.insertBefore(hint, list.firstChild);

    list.addEventListener('touchstart', function(e){
      if(list.scrollTop > 2 || active || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });
    list.addEventListener('touchmove', function(e){
      if(!pulling) return;
      dist = e.touches[0].clientY - startY;
      if(dist <= 0){ hint.style.removeProperty('--th-pull'); hint.classList.remove('th-pull-ready'); return; }
      hint.style.setProperty('--th-pull', Math.min(dist, PULL_THRESHOLD * 1.5) + 'px');
      hint.classList.toggle('th-pull-ready', dist > PULL_THRESHOLD);
    }, { passive: true });
    list.addEventListener('touchend', function(){
      if(!pulling) return;
      pulling = false;
      if(dist > PULL_THRESHOLD && !active){
        active = true;
        hint.classList.add('th-pull-active');
        hint.textContent = rtl ? 'جارٍ التحديث…' : 'Refreshing…';
        flushQueue().then(function(){ return fetchWall(prefix); })
          .then(function(){ render(prefix); })
          .catch(function(){ render(prefix, true); });
      } else {
        hint.style.removeProperty('--th-pull');
        hint.classList.remove('th-pull-ready');
      }
      dist = 0;
    }, { passive: true });
    list.addEventListener('touchcancel', function(){
      pulling = false; dist = 0;
      hint.style.removeProperty('--th-pull');
      hint.classList.remove('th-pull-ready');
    }, { passive: true });
  }

  function open(prefix){
    var overlay = document.getElementById('thoughtsModalOverlay');
    if(!overlay) return;
    render(prefix);
    overlay.classList.add('open');
    // Refresh from the wall in the background; the cached copy is already on
    // screen, so a slow or missing network changes nothing the student sees
    // right away. A failure used to be swallowed silently, which is exactly
    // why an empty or stale wall looked like "nobody posted" instead of what
    // it actually was — the server could not be reached — so it is now shown.
    flushQueue().then(function(){ return fetchWall(prefix); })
      .then(function(){ render(prefix); })
      .catch(function(){ render(prefix, true); });
  }

  function close(){
    var overlay = document.getElementById('thoughtsModalOverlay');
    if(overlay) overlay.classList.remove('open');
  }

  function bindShell(){
    var overlay = document.getElementById('thoughtsModalOverlay');
    if(!overlay) return;
    var btn = document.getElementById('thoughtsModalClose');
    if(btn) btn.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
    var card = overlay.querySelector('.modal-card');
    if(card) card.addEventListener('click', function(e){ e.stopPropagation(); });
  }
  if(document.readyState === 'complete'){ bindShell(); }
  else { window.addEventListener('load', bindShell); }

  window.addEventListener('online', function(){ flushQueue(); });

  // ---- Settings → Data: where the wall's server lives ---------------------
  // The Worker is deployed by hand, once, by whoever runs the app. Before
  // this existed the only way to point the app at it was to edit
  // js/01-catalogue.js and redeploy the site — which is why the wall still
  // said "local mode" to someone who had already deployed their Worker and
  // put thoughts on it.
  function settingsSectionHtml(r){
    var saved = storedUrl();
    var live = endpoint();
    return '<h3 class="mh" style="margin:18px 0 6px;">' + window.AAUP_ICONS.preview('speech', 18) + (r ? 'خادم الأفكار' : 'Thoughts server') + '</h3>' +
      '<p class="form-note" style="margin-top:0;">' +
      (r ? 'ألصق رابط الـ Worker الخاص بالأفكار ليصير الحائط مشتركًا بين الطلاب. بدونه تبقى أفكارك على جهازك فقط.'
         : 'Paste your thoughts Worker URL to make the wall shared between students. Without it, your thoughts stay on this device.') +
      '</p>' +
      '<div class="form-field-row">' +
      '<div class="form-field"><input type="url" id="thUrlInput" spellcheck="false" dir="ltr" ' +
        'placeholder="https://your-worker.workers.dev" value="' + esc(saved) + '"></div>' +
      '<button type="button" class="home-btn" id="thUrlSave" style="align-self:flex-start;">' +
        (r ? 'حفظ وفحص' : 'Save & test') + '</button>' +
      '</div>' +
      '<p class="form-note" id="thUrlMsg" style="margin-top:4px;">' +
      (live
        ? (r ? 'المستخدم حاليًا: ' : 'Currently using: ') + esc(live) + (saved ? '' : (r ? ' (من ملف الإعدادات)' : ' (from the config file)'))
        : (r ? 'غير مُهيّأ — الوضع المحلي.' : 'Not configured — local mode.')) +
      '</p>';
  }

  function bindSettingsSection(root, prefix){
    var input = root.querySelector('#thUrlInput');
    var save = root.querySelector('#thUrlSave');
    var msg = root.querySelector('#thUrlMsg');
    if(!input || !save || !msg) return;
    var r = root.getAttribute('dir') === 'rtl';
    save.addEventListener('click', function(){
      var v = input.value.trim();
      if(!setServerUrl(v)){
        msg.textContent = r ? 'الرابط لازم يبدأ بـ https://' : 'The URL has to start with https://';
        return;
      }
      if(!v){ msg.textContent = r ? 'تم المسح — الوضع المحلي.' : 'Cleared — local mode.'; return; }
      // Say what actually happened, not what we hope happened: this asks the
      // Worker for a real wall and reports what came back, including the
      // failure.
      msg.textContent = r ? 'جارٍ الفحص…' : 'Testing…';
      fetchWall(prefix || 'ai').then(function(list){
        msg.textContent = r
          ? ('متصل ✓ — الخادم ردّ بـ ' + (list ? list.length : 0) + ' فكرة.')
          : ('Connected ✓ — the server answered with ' + (list ? list.length : 0) + ' thought(s).');
      }).catch(function(e){
        msg.textContent = (r ? 'ما زبطت: ' : 'Could not reach it: ') + String(e && e.message || e) +
          (r ? ' — تأكد أن ALLOWED_ORIGIN في الـ Worker يشمل هذا الموقع.'
             : ' — check the Worker\'s ALLOWED_ORIGIN includes this site.');
      });
    });
  }

  window.AAUP_THOUGHTS = {
    serverUrl: endpoint, storedUrl: storedUrl, setServerUrl: setServerUrl,
    settingsSectionHtml: settingsSectionHtml, bindSettingsSection: bindSettingsSection,
    open: open, close: close, publish: publish, wallFor: wallFor,
    flushQueue: flushQueue, count: function(prefix){ return wallFor(prefix).length; }
  };
})();
