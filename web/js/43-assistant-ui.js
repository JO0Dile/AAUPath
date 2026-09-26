// ==========================
// ASSISTANT UI + GUIDED MODE
// ==========================
// The chat window, and the walkthrough mode it can hand off to.
//
// Guided Mode exists because "Settings is in the menu, bottom left" is a
// worse answer than pointing at it. When a student asks "how do I…" or
// "where is…", the assistant dims the page, lights up the one real control
// they need, and waits for them to actually use it before moving on — one
// step at a time, never two things highlighted at once.
//
// It is deliberately separate from the onboarding tours in js/32-tutorial.js.
// Those are fixed, once-per-device introductions with their own seen/unseen
// bookkeeping; this is on demand, driven by a question, and repeatable.
// Sharing one engine would mean one of the two behaving oddly to suit the
// other.
(function () {
  var KB = window.AAUP_ASSISTANT_KB;
  var ENGINE = window.AAUP_ASSISTANT;

  function el(id) { return document.getElementById(id); }
  function lang() { return (window.__anyVisiblePageIsRtl && window.__anyVisiblePageIsRtl()) ? 'ar' : 'en'; }

  // ---------------------------------------------------------------
  // CHAT WINDOW
  // ---------------------------------------------------------------
  var lastLang = 'en';

  function scrollDown() {
    var log = el('asstLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  // Everything rendered here goes through textContent, never innerHTML.
  // The student's own words come back on screen, and a plan's course names
  // can have arrived from another student's device via the plans feed.
  function addBubble(who, node) {
    var log = el('asstLog');
    if (!log) return null;
    var row = document.createElement('div');
    row.className = 'asst-msg asst-' + who;
    row.appendChild(node);
    log.appendChild(row);
    scrollDown();
    return row;
  }

  function addUser(text) {
    var b = document.createElement('div');
    b.className = 'asst-bubble';
    b.textContent = text;
    addBubble('user', b);
  }

  function addPlain(text, dir) {
    var b = document.createElement('div');
    b.className = 'asst-bubble';
    b.textContent = text;
    if (dir) b.setAttribute('dir', dir);
    addBubble('bot', b);
  }

  // A language model writes markdown whether or not you ask it to — **bold**
  // and "- " bullets come back constantly. Rendered as plain text those show
  // up as literal asterisks, so this converts the two that actually appear.
  //
  // Built from DOM nodes rather than innerHTML, deliberately: this text comes
  // off the network, and an assistant that pasted model output into innerHTML
  // would be a script-injection hole wearing a chat bubble.
  function appendInline(node, text) {
    String(text).split(/\*\*(.+?)\*\*/g).forEach(function (part, i) {
      if (!part) return;
      if (i % 2 === 1) {
        var strong = document.createElement('strong');
        strong.textContent = part;
        node.appendChild(strong);
      } else {
        node.appendChild(document.createTextNode(part));
      }
    });
  }

  function appendBlock(container, block) {
    var list = null;
    String(block).split('\n').forEach(function (raw) {
      var line = raw.trim().replace(/^#{1,6}\s+/, '');
      if (!line) return;
      var bullet = line.match(/^[-*•]\s+(.*)$/);
      if (bullet) {
        if (!list) {
          list = document.createElement('ul');
          list.className = 'asst-list';
          container.appendChild(list);
        }
        var li = document.createElement('li');
        appendInline(li, bullet[1]);
        list.appendChild(li);
        return;
      }
      list = null; // a plain line ends the current bullet run
      var p = document.createElement('p');
      appendInline(p, line);
      container.appendChild(p);
    });
  }

  function addReply(r, replyLang) {
    var dir = replyLang === 'ar' ? 'rtl' : 'ltr';
    var b = document.createElement('div');
    b.className = 'asst-bubble';
    b.setAttribute('dir', dir);

    if (r.title) {
      var h = document.createElement('div');
      h.className = 'asst-title';
      h.textContent = r.title;
      b.appendChild(h);
    }
    (r.lines || []).forEach(function (line) { appendBlock(b, line); });

    // An editing proposal: the change is described above, and nothing at all
    // happens until this button is pressed.
    if (r.confirm) {
      if (r.confirm.warn) {
        var warn = document.createElement('p');
        warn.className = 'asst-warn';
        warn.textContent = '⚠️ ' + r.confirm.warn;
        b.appendChild(warn);
      }
      var actions = document.createElement('div');
      actions.className = 'asst-actions';
      var go = document.createElement('button');
      go.type = 'button';
      // asst-act-confirm distinguishes "change my data" from the "Show me"
      // button, which shares the same primary styling.
      go.className = 'asst-act asst-act-primary asst-act-confirm';
      go.textContent = r.confirm.label;
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'asst-act';
      cancel.textContent = replyLang === 'ar' ? 'إلغاء' : 'Cancel';
      go.addEventListener('click', function () {
        go.disabled = true; cancel.disabled = true;
        var result;
        try { result = r.confirm.run(); }
        catch (e) { result = replyLang === 'ar' ? 'تعذّر تنفيذ التغيير.' : 'That change could not be applied.'; }
        addPlain(result, dir);
      });
      cancel.addEventListener('click', function () {
        go.disabled = true; cancel.disabled = true;
        addPlain(replyLang === 'ar' ? 'تمام، لم أغيّر شيئًا.' : 'Okay — nothing was changed.', dir);
      });
      actions.appendChild(go);
      actions.appendChild(cancel);
      b.appendChild(actions);
    }

    // A walkthrough is available for this answer.
    if (r.guide && KB.guides[r.guide]) {
      var ga = document.createElement('div');
      ga.className = 'asst-actions';
      var show = document.createElement('button');
      show.type = 'button';
      show.className = 'asst-act asst-act-primary';
      show.textContent = '👉 ' + (KB.say.guideOffer[replyLang] || KB.say.guideOffer.en);
      show.addEventListener('click', function () { startGuide(r.guide, replyLang); });
      ga.appendChild(show);
      b.appendChild(ga);
    }

    addBubble('bot', b);

    if (r.chips && r.chips.length) { addChips(r.chips); }
    // Auto-started walkthroughs stay quiet when nothing they point at is on
    // screen: the written answer is already above, and following it with
    // "I can't show you that right now" reads as a failure when the student
    // never asked to be shown in the first place. The "Show me" button is
    // still there if they want to try.
    if (r.autoGuide && r.guide && KB.guides[r.guide]) { startGuide(r.guide, replyLang, true); }
  }

  function addChips(list) {
    var log = el('asstLog');
    if (!log) return;
    var wrap = document.createElement('div');
    wrap.className = 'asst-chips';
    list.forEach(function (text) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'asst-chip';
      c.textContent = text;
      c.addEventListener('click', function () { send(text); });
      wrap.appendChild(c);
    });
    log.appendChild(wrap);
    scrollDown();
  }

  // The three dots while the online brain is thinking. The offline one
  // answers in under a millisecond and never shows this.
  function addTyping() {
    var log = el('asstLog');
    if (!log) return null;
    var row = document.createElement('div');
    row.className = 'asst-msg asst-bot';
    var b = document.createElement('div');
    b.className = 'asst-bubble asst-typing';
    for (var i = 0; i < 3; i++) b.appendChild(document.createElement('span'));
    row.appendChild(b);
    log.appendChild(row);
    scrollDown();
    return row;
  }

  function localAnswer(text, replyLang) {
    try {
      return ENGINE.ask(text);
    } catch (e) {
      // A thrown assistant is still an assistant that must answer.
      if (window.console && console.error) { console.error('Assistant failed to answer:', e); }
      return { lines: [replyLang === 'ar'
        ? 'حدث خطأ عندي أثناء الإجابة. جرّب صياغة أخرى.'
        : 'Something went wrong on my side. Try asking a different way.'] };
    }
  }

  function send(text) {
    var t = String(text || '').trim();
    if (!t) return;
    addUser(t);
    var replyLang = ENGINE.langFor(t);
    lastLang = replyLang;
    var dir = replyLang === 'ar' ? 'rtl' : 'ltr';

    var AI = window.AAUP_ASSISTANT_AI;
    if (!AI || !AI.enabled()) { addReply(localAnswer(t, replyLang), replyLang); return; }

    var typing = addTyping();
    AI.ask(t, replyLang).then(function (r) {
      if (typing) typing.remove();
      addReply(r, replyLang);
    }, function (e) {
      // The smart brain is unavailable — quota, connection, anything. The
      // question still gets answered, by the brain that cannot go away.
      if (typing) typing.remove();
      addReply(localAnswer(t, replyLang), replyLang);
      addPlain('ℹ️ ' + AI.fallbackNote(e, replyLang), dir);
    });
  }

  // ---------------------------------------------------------------
  // SMART MODE — opt-in, because it is the one thing that sends anything
  // ---------------------------------------------------------------
  // The app's promise is that nothing leaves the device. The smart assistant
  // breaks that promise for the students who choose it, so it is off until
  // asked for, the question spells out exactly what travels and what never
  // does, and it can be switched back off at any time.
  var CONSENT = {
    title: { en: 'Want smarter answers?', ar: 'بدك إجابات أذكى؟' },
    // The question itself, in two lines. The details below are every word
    // the card used to show, one tap away under "What gets sent?" — they
    // are what makes the choice an informed one, so they stay, folded.
    lead: {
      en: 'Let me go online and I’ll understand your questions better and take you to the right screen. It’s free, and you can turn it off any time.',
      ar: 'خليني أتصل بالإنترنت وبفهم أسئلتك أحسن وبوصلك للشاشة الصح. مجاني، وبتقدر توقفه بأي وقت.'
    },
    more: { en: 'What gets sent?', ar: 'شو اللي بينبعت؟' },
    body: {
      en: ['I can answer much better questions if I’m allowed to go online — I’ll understand how you actually phrase things, and I can take you to the right screen myself.',
           'Sent when you ask something: your question, your open plan, its courses and prerequisites, which ones you’ve completed, and your GPA number.',
           'Never sent: your name, your student ID, your individual grades, your assessment marks, or your notes.',
           'It’s free, and you can turn it off any time. Say no and I stay fully offline — I just understand less.'],
      ar: ['أستطيع الإجابة عن أسئلة أفضل بكثير إذا سُمح لي بالاتصال — سأفهم صياغتك الطبيعية، ويمكنني نقلك إلى الشاشة الصحيحة بنفسي.',
           'يُرسَل عند سؤالك: سؤالك، وخطتك المفتوحة، ومساقاتها ومتطلباتها، وما أنجزته منها، ورقم معدّلك.',
           'لا يُرسَل أبدًا: اسمك، ولا رقمك الجامعي، ولا علاماتك التفصيلية، ولا تقييماتك، ولا ملاحظاتك.',
           'مجاني، ويمكنك إيقافه في أي وقت. وإن رفضت أبقى دون اتصال تمامًا — لكنني أفهم أقل.']
    },
    yes: { en: 'Turn it on', ar: 'فعّله' },
    no: { en: 'Stay offline', ar: 'ابقَ دون اتصال' }
  };

  function offerSmartMode(l) {
    var dir = l === 'ar' ? 'rtl' : 'ltr';
    var b = document.createElement('div');
    b.className = 'asst-bubble asst-consent';
    b.setAttribute('dir', dir);
    var h = document.createElement('div');
    h.className = 'asst-title';
    h.innerHTML = (window.AAUP_ICONS ? window.AAUP_ICONS.preview('bolt', 15) : '') +
      window.__escapeHtml(CONSENT.title[l] || CONSENT.title.en);
    b.appendChild(h);
    var lead = document.createElement('p');
    lead.textContent = CONSENT.lead[l] || CONSENT.lead.en;
    b.appendChild(lead);
    var details = document.createElement('details');
    details.className = 'asst-consent-more';
    var sum = document.createElement('summary');
    sum.textContent = CONSENT.more[l] || CONSENT.more.en;
    details.appendChild(sum);
    (CONSENT.body[l] || CONSENT.body.en).forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      details.appendChild(p);
    });
    b.appendChild(details);
    var actions = document.createElement('div');
    actions.className = 'asst-actions';
    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'asst-act asst-act-primary';
    yes.textContent = CONSENT.yes[l] || CONSENT.yes.en;
    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'asst-act';
    no.textContent = CONSENT.no[l] || CONSENT.no.en;
    yes.addEventListener('click', function () {
      window.AAUP_ASSISTANT_AI.setMode('on');
      yes.disabled = true; no.disabled = true;
      paintMode();
      addPlain(l === 'ar' ? 'تم — اسألني بأي صياغة تريد.' : 'Done — ask me anything, however you like.', dir);
    });
    no.addEventListener('click', function () {
      window.AAUP_ASSISTANT_AI.setMode('off');
      yes.disabled = true; no.disabled = true;
      paintMode();
      addPlain(l === 'ar' ? 'تمام، أبقى دون اتصال.' : 'Okay — I’ll stay offline.', dir);
    });
    actions.appendChild(yes);
    actions.appendChild(no);
    b.appendChild(actions);
    addBubble('bot', b);
  }

  // The header toggle: shows which brain is answering, and switches it.
  function paintMode() {
    var btn = el('asstMode');
    if (!btn) return;
    var AI = window.AAUP_ASSISTANT_AI;
    if (!AI || !AI.configured()) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    var on = AI.mode() === 'on';
    // A bolt when it is allowed online, a moon when it is not — the two
    // states of one switch, drawn, rather than two unrelated emoji.
    btn.innerHTML = window.AAUP_ICONS ? window.AAUP_ICONS.preview(on ? 'bolt' : 'clock', 15) : (on ? '' : '');
    btn.classList.toggle('asst-mode-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on
      ? (lang() === 'ar' ? 'المساعد الذكي مُفعَّل — اضغط لإيقافه' : 'Smart assistant on — tap to turn off')
      : (lang() === 'ar' ? 'المساعد الذكي متوقف — اضغط لتفعيله' : 'Smart assistant off — tap to turn on');
  }

  function toggleMode() {
    var AI = window.AAUP_ASSISTANT_AI;
    if (!AI || !AI.configured()) return;
    var l = lang();
    var turningOn = AI.mode() !== 'on';
    if (turningOn && !AI.asked()) { offerSmartMode(l); return; }
    AI.setMode(turningOn ? 'on' : 'off');
    paintMode();
    addPlain(turningOn
      ? (l === 'ar' ? 'تم تفعيل المساعد الذكي.' : 'Smart assistant on.')
      : (l === 'ar' ? 'تم إيقافه — أعمل الآن دون اتصال بالكامل.' : 'Turned off — I’m fully offline now.'),
      l === 'ar' ? 'rtl' : 'ltr');
  }

  function open() {
    var panel = el('asstPanel');
    if (!panel) return;
    panel.classList.add('open');
    paintMode();
    var log = el('asstLog');
    if (log && !log.childNodes.length) {
      var l = lang();
      lastLang = l;
      addPlain(ENGINE.greeting(l), l === 'ar' ? 'rtl' : 'ltr');
      var AI = window.AAUP_ASSISTANT_AI;
      // Asked once, on the first visit to the chat, and never again.
      if (AI && AI.configured() && !AI.asked()) { offerSmartMode(l); }
      else { addChips(ENGINE.suggestions(l)); }
    }
    var input = el('asstInput');
    if (input) setTimeout(function () { input.focus(); }, 80);
  }

  function close() {
    var panel = el('asstPanel');
    if (panel) panel.classList.remove('open');
  }

  function toggle() {
    var panel = el('asstPanel');
    if (panel && panel.classList.contains('open')) close(); else open();
  }

  // ---------------------------------------------------------------
  // GUIDED MODE
  // ---------------------------------------------------------------
  var active = null; // { steps, index, lang, reopen }

  function resolveTarget(step) {
    try {
      var t = step.target;
      var found = (typeof t === 'function') ? t() : document.querySelector(t);
      return (found && found.offsetParent !== null) ? found : null;
    } catch (e) { return null; }
  }

  function place() {
    if (!active) return;
    var step = active.steps[active.index];
    var target = step && resolveTarget(step);
    if (!target) { skipStep(); return; }

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Two frames: one for the scroll to be applied, one for layout to settle
    // before the spotlight is measured against it.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!active) return;
        var r = target.getBoundingClientRect();
        var pad = 8;
        var spot = el('guideSpot');
        var tip = el('guideTip');
        if (!spot || !tip) return;

        spot.style.top = Math.max(0, r.top - pad) + 'px';
        spot.style.left = Math.max(0, r.left - pad) + 'px';
        spot.style.width = (r.width + pad * 2) + 'px';
        spot.style.height = (r.height + pad * 2) + 'px';

        el('guideText').textContent = step.text[active.lang] || step.text.en;
        el('guideStep').textContent = (active.index + 1) + ' / ' + active.steps.length;

        // A step that is waiting on a real interaction offers "Skip" instead
        // of "Next": the student is supposed to do the thing, and the
        // walkthrough advances by itself the moment they do.
        var waiting = !!step.waitFor;
        var next = el('guideNext');
        next.textContent = waiting
          ? (active.lang === 'ar' ? 'تخطَّ' : 'Skip')
          : (active.index === active.steps.length - 1
              ? (active.lang === 'ar' ? 'تم' : 'Got it')
              : (active.lang === 'ar' ? 'التالي' : 'Next'));

        var tipW = Math.min(320, window.innerWidth - 24);
        tip.style.width = tipW + 'px';
        var left = r.left + r.width / 2 - tipW / 2;
        tip.style.left = Math.max(12, Math.min(left, window.innerWidth - tipW - 12)) + 'px';
        var below = window.innerHeight - r.bottom;
        if (below > 170 || r.top < 170) {
          tip.style.top = (r.bottom + pad + 12) + 'px';
        } else {
          tip.style.top = Math.max(12, r.top - pad - 12 - tip.offsetHeight) + 'px';
        }
      });
    });
  }

  // Polling rather than a MutationObserver: a step completes for all sorts of
  // reasons (a class flips, a panel opens, a page swaps, a value is typed),
  // and 250ms of latency on "did they do it yet" is imperceptible while
  // being immune to whichever of those the step actually used.
  var watchTimer = null;
  function watch() {
    stopWatching();
    var step = active && active.steps[active.index];
    if (!step || !step.waitFor) return;
    watchTimer = setInterval(function () {
      if (!active) { stopWatching(); return; }
      var done = false;
      try { done = !!step.waitFor(); } catch (e) { done = false; }
      if (done) { stopWatching(); advance(); }
    }, 250);
  }
  function stopWatching() {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  }

  function advance() {
    if (!active) return;
    stopWatching();
    active.index++;
    if (active.index >= active.steps.length) { finish(true); return; }
    place();
    watch();
  }

  // A step whose target is not on screen is dropped rather than stalling the
  // walkthrough — the student may already be past it, or on a screen where
  // that control does not exist.
  function skipStep() {
    if (!active) return;
    stopWatching();
    var wasIndex = active.index;
    active.index++;
    if (active.index >= active.steps.length) {
      // Nothing in the whole walkthrough could be pointed at.
      var noneShown = wasIndex === 0;
      finish(!noneShown);
      if (noneShown) { addPlain(KB.say.guideUnavailable[lastLang] || KB.say.guideUnavailable.en); }
      return;
    }
    place();
    watch();
  }

  function finish(reopenChat) {
    if (!active) return;
    var l = active.lang;
    var reopen = active.reopen && reopenChat !== false;
    stopWatching();
    active = null;
    var layer = el('guideLayer');
    if (layer) layer.classList.remove('open');
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    if (reopen) {
      open();
      addPlain(l === 'ar' ? 'انتهت الجولة. هل من شيء آخر؟' : 'That’s it. Anything else?', l === 'ar' ? 'rtl' : 'ltr');
    }
  }

  function startGuide(id, guideLang, silentIfUnavailable) {
    var guide = KB.guides[id];
    if (!guide) return;
    var l = guideLang || lastLang || 'en';

    // Every step is kept, including ones whose target does not exist yet: a
    // walkthrough can create its own next target ("turn on Edit Mode" is what
    // makes the "+" appear), and pre-filtering those broke the chain before it
    // could start. A step whose target never arrives is skipped at runtime.
    var steps = guide.steps;
    if (!canGuide(id)) {
      if (!silentIfUnavailable) {
        addPlain(KB.say.guideUnavailable[l] || KB.say.guideUnavailable.en, l === 'ar' ? 'rtl' : 'ltr');
      }
      return false;
    }

    var wasOpen = !!(el('asstPanel') && el('asstPanel').classList.contains('open'));
    close(); // the chat window would cover the very thing being pointed at

    active = { steps: steps, index: 0, lang: l, reopen: wasOpen };
    var layer = el('guideLayer');
    if (layer) layer.classList.add('open');
    var title = el('guideTitle');
    if (title) title.textContent = guide.title[l] || guide.title.en;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    place();
    watch();
    return true;
  }

  // Can this walkthrough get off the ground from the screen we are on? At
  // least one step has to be pointable-at right now; the rest can appear as
  // the student follows along.
  function canGuide(id) {
    var guide = KB.guides[id];
    if (!guide) return false;
    return guide.steps.some(function (s) { return !!resolveTarget(s); });
  }

  // ---------------------------------------------------------------
  // BINDING
  // ---------------------------------------------------------------
  function bind() {
    var closeBtn = el('asstClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    var modeBtn = el('asstMode');
    if (modeBtn) modeBtn.addEventListener('click', toggleMode);
    paintMode();

    var form = el('asstForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = el('asstInput');
        if (!input) return;
        var text = input.value;
        input.value = '';
        send(text);
      });
    }

    var next = el('guideNext');
    if (next) next.addEventListener('click', advance);
    var end = el('guideEnd');
    if (end) end.addEventListener('click', function () { finish(true); });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (active) { finish(true); return; }
      var panel = el('asstPanel');
      if (panel && panel.classList.contains('open')) close();
    });
  }

  if (document.readyState === 'complete') { bind(); }
  else { window.addEventListener('load', bind); }

  window.AAUP_ASSISTANT_UI = {
    open: open, close: close, toggle: toggle,
    send: send, startGuide: startGuide, canGuide: canGuide,
    toggleMode: toggleMode,
    isGuiding: function () { return !!active; }
  };
})();
