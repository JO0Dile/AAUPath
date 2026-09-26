// ==========================
// COACH MARKS — one sentence, at the moment it means something
//
// This used to be three guided tours: eight to ten spotlit steps, played
// end-to-end the first time each screen was reached. Tours have one problem
// that no amount of fixing the steps solves — they teach everything before
// any of it means anything, and they are the screen people skip hardest. The
// step counter alone was reported as a bug three separate times, and it was
// never really a numbering bug: it was the tour insisting on being a
// sequence when a student only wanted the one thing in front of them.
//
// So the sequence is gone, and with it advance(), the step index, the
// counter, the Skip/Next pair and the interactive-step gating. What is left
// is one mark: a spotlight, one sentence, one "Got it".
//
// TWO KINDS OF MARK
//
// ARRIVAL marks (MARKS below) fire the first time a screen is reached, keyed
// by the screen — the same keys the old tours used, so a student who has
// already been through the tours is not shown any of this again. Exactly one
// per screen, so a screen can never turn back into a tour by accretion.
//
// MOMENT marks (MOMENTS below) fire the first time a particular thing is
// DONE rather than the first time a screen is seen. They are what the extra
// tour steps became: "hold a year to see what is open to you" now appears
// the first time someone opens a year, not thirty seconds before they have
// opened one, and it teaches the same thing at the moment it is useful.
//
// A mark shows once, ever, per browser, and Settings still replays them.
// Marks are also suppressed while any other dialog is open, and a mark whose
// target has left the screen gives up rather than pointing at nothing — the
// two failure modes the tours actually hit in practice.
//
// The spotlight positioning below is the tours' own, kept intact: it is the
// part that was correct, and it is what took the reported off-screen tooltip
// and mid-scroll spotlight bugs to fix.
// ==========================
(function(){
  var KEY_PREFIX = 'aaup_tut_';
  var active = null; // { id, steps, index }
  var shownThisVisit = false;

  function done(id){
    try{ return localStorage.getItem(KEY_PREFIX + id) === '1'; }catch(e){ return true; }
  }
  function markDone(id){
    try{ localStorage.setItem(KEY_PREFIX + id, '1'); }catch(e){}
  }
  function clearDone(id){
    try{ localStorage.removeItem(KEY_PREFIX + id); }catch(e){}
  }

  // The one element every plan page (built-in or imported) currently on
  // screen — used to scope step targets so a hidden major elsewhere in the
  // DOM never gets matched instead of the one actually visible.
  function visiblePlanRoot(){
    var candidates = document.querySelectorAll('.plan-page, #importedPlanView');
    for(var i = 0; i < candidates.length; i++){
      if(candidates[i].offsetParent !== null) return candidates[i];
    }
    return document;
  }
  // The first match that is actually on screen. Several selectors in this
  // file hit a legacy element that is still in the DOM but hidden at the
  // current width — the dashboard keeps its old desktop stat cards behind
  // the phone hero strip, so "#dashboard .dash-card" finds a display:none
  // Progress card long before it finds the one a student can see, and the
  // mark would be dropped for pointing at nothing.
  function firstVisible(sel, root){
    var list = (root || document).querySelectorAll(sel);
    for(var i = 0; i < list.length; i++){
      if(list[i].offsetParent !== null) return list[i];
    }
    return null;
  }

  // The custom/imported plan editor always renders into this one fixed
  // host regardless of which plan is open — unlike visiblePlanRoot()'s
  // built-in majors, there's only ever one candidate, so this just needs
  // to confirm it's actually the thing on screen right now.
  function importedEditRoot(){
    var host = document.getElementById('importedPlanView');
    return (host && host.offsetParent !== null) ? host : document;
  }

  // Calls fn once the page has stopped scrolling — measured, not timed.
  // Reads the target's own position each frame and fires when it has held
  // still for two consecutive frames, with a cap so a page that never
  // settles cannot leave a step hanging.
  function afterScrollSettles(el, fn){
    var MAX_WAIT = 800, started = Date.now();
    var lastTop = null, stable = 0;
    (function tick(){
      var top = Math.round(el.getBoundingClientRect().top);
      stable = (top === lastTop) ? stable + 1 : 0;
      lastTop = top;
      if(stable >= 2 || Date.now() - started > MAX_WAIT){ fn(); return; }
      requestAnimationFrame(tick);
    })();
  }


  // ---------------------------------------------------------------------
  // ARRIVAL MARKS — one per screen, the first time it is reached.
  //
  // Each is the single thing that, not knowing it, makes the screen hard to
  // use. Everything else the old tours narrated is either self-evident from
  // the screen or has become a MOMENT mark below.
  var MARKS = {
    home: {
      target: function(){ return firstVisible('#taskHome .hm-search'); },
      title: { en: 'Start with what you need', ar: 'ابدأ باللي بدك إياه' },
      text: { en: 'Type anything here — a course, a professor, your GPA — or tap one of the cards below. Nothing has to come first.',
              ar: 'اكتب أي إشي هون — مساق، محاضر، معدلك — أو اضغط وحدة من البطاقات تحت. ما في إشي لازم يكون أول.' }
    },
    studyplan: {
      target: function(){ return visiblePlanRoot().querySelector('.now-tag') || visiblePlanRoot().querySelector('.imp-year-toggle'); },
      title: { en: 'Tick a course once you have passed it', ar: 'علّم المساق لما تنجح فيه' },
      text: { en: 'That tick is what feeds everything else: your progress, GPA and what opens next. Tap a year to see inside it.',
              ar: 'هاي العلامة هي اللي بتغذّي كل إشي: تقدّمك ومعدلك وشو بيفتحلك بعدها. اضغط سنة تشوف جوّاتها.' }
    },
    planEditor: {
      target: function(){ return importedEditRoot().querySelector('.imp-exit-edit-btn'); },
      title: { en: 'This is your copy', ar: 'هاي نسختك أنت' },
      text: { en: 'Add, remove and drag anything — every change saves as you go. Press Done at the bottom when you have finished. Nothing is shared until you choose to Send it.',
              ar: 'ضيف واحذف واسحب زي ما بدك — كل تغيير بينحفظ أول بأول. اضغط «تم» تحت لما تخلص. ما بينشارك إشي إلا لما تختار ترسله.' }
    },
    devEdit: {
      target: function(){ return visiblePlanRoot().querySelector('.emb-exit'); },
      title: { en: 'This edits the shared plan', ar: 'هاد بيعدّل الخطة المشتركة' },
      text: { en: 'Changes here affect every student on this major, not just you. Reordering only — the course list itself stays exactly what the university publishes.',
              ar: 'التعديلات هون بتأثر على كل طالب بهذا التخصص، مش عليك بس. ترتيب فقط — قائمة المساقات بتضل زي ما الجامعة بتنشرها.' }
    }
  };

  // ---------------------------------------------------------------------
  // MOMENT MARKS — the first time something is DONE, not seen.
  //
  // These are the tour steps that were worth keeping, moved to their real
  // trigger. Each carries its own key, so they are independent of the
  // arrival marks and of each other: a student who never opens a year never
  // sees the hold-to-focus one, which is correct.
  // Fewer, better-timed tips: the hold-a-year and hold-a-card tips were
  // tricks, not things needed on day one, and they fired while students were
  // busy doing something else. The assistant answers "what does holding do?"
  // (js/41-assistant-kb.js) for anyone who wants them.
  var MOMENTS = {};

  function resolve(mark){
    return typeof mark.target === 'function' ? mark.target() : document.querySelector(mark.target);
  }
  function rtl(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function side(o){ return rtl() ? (o.ar || o.en) : o.en; }

  // The tours had two observers here: one that waited for a student to
  // perform a gesture before relabelling Next, and one that repositioned the
  // tooltip when a step's target revealed more content. Both existed to make
  // a SEQUENCE behave; a mark has nowhere to advance to and nothing to
  // relabel, so both are gone. What remains is the reflow the spotlight
  // needs when the page moves under it, which is just render().

  function render(){
    if(!active) return;
    var mark = active.mark;
    var el = mark && resolve(mark);
    if(!el || el.offsetParent === null){
      // The target is not on screen. A tour dropped the step and moved to the
      // next one; a mark has no next one, so it gives up — and, crucially,
      // does NOT mark itself seen, so it gets another chance the next time
      // the student is on this screen with the thing actually visible.
      dismiss(false);
      return;
    }
    // The words go up before the scroll, not after it: waiting for the
    // scroll to settle is right for POSITIONING and wrong for text, which
    // then sat blank for the whole of the scroll.
    document.getElementById('tutTitle').textContent = side(mark.title);
    document.getElementById('tutText').textContent = side(mark.text);

    // ONLY when the mark first appears. render() also runs on every reflow —
    // window resize, and every scroll event in the capture phase, which means
    // every scroll of every scrollable element on the page. Scrolling there
    // put the target back in the centre the instant the student scrolled away
    // from it: a course popup with a paused mark behind it could not be
    // scrolled at all, because each gesture was undone before it finished.
    // Reflow exists to move the spotlight to where the target now IS, not to
    // move the target back to where the spotlight was.
    if(!active._scrolled){
      active._scrolled = true;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    // Two animation frames used to be the whole wait. That is fine for a
    // target already on screen and wrong for one that is not: a smooth
    // scroll takes a few hundred milliseconds, so the rect was read while
    // the page was still moving and the spotlight got pinned to where the
    // target HAD been. On a long plan that put it below the fold with its
    // tooltip — and its Next button — off the bottom of the screen.
    //
    // Waiting for the rect to stop changing covers both cases without
    // guessing a duration.
    afterScrollSettles(el, function(){
      (function(){
        // Re-check: enough has happened for finish() to have run (e.g. a
        // rapid plan switch) and cleared `active` out from under this
        // already-scheduled callback — without this guard the stale closure
        // reads off a null `active`.
        if(!active) return;
        var r = el.getBoundingClientRect();
        var pad = 6;
        var spot = document.getElementById('tutSpotlight');
        spot.style.top = Math.max(0, r.top - pad) + 'px';
        spot.style.left = Math.max(0, r.left - pad) + 'px';
        spot.style.width = (r.width + pad * 2) + 'px';
        spot.style.height = (r.height + pad * 2) + 'px';
        spot.classList.toggle('no-dim', !!mark.noDim);

        var tip = document.getElementById('tutTooltip');
        tip.style.left = '';
        var tipWidth = 300;
        var left = r.left + r.width / 2 - tipWidth / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - tipWidth - 12));
        tip.style.left = left + 'px';
        var belowEdge = r.bottom;
        // Vertical placement used a fixed 180px guess for "is there room
        // below" and never clamped the result, so a tooltip taller than the
        // guess — or one on a phone, where the floating tab bar owns the
        // last ~90px — was positioned partly or entirely under the edge of
        // the screen with its buttons unreachable. Measure the tooltip, ask
        // whether it actually fits, and clamp into the visible band either
        // way.
        var tipH = tip.offsetHeight;
        var bar = document.getElementById('sbTabBar');
        var barTop = (bar && bar.offsetParent !== null) ? bar.getBoundingClientRect().top : window.innerHeight;
        var bottomLimit = Math.min(window.innerHeight, barTop) - 12;
        var below = belowEdge + pad + 12;
        var above = r.top - pad - 12 - tipH;
        var top;
        if(below + tipH <= bottomLimit){ top = below; }
        else if(above >= 12){ top = above; }
        else {
          // Fits nowhere clear of the target — take whichever side has more
          // room and clamp, so it is always fully on screen and tappable.
          top = (bottomLimit - belowEdge) >= r.top ? below : above;
        }
        tip.style.top = Math.max(12, Math.min(top, bottomLimit - tipH)) + 'px';
      })();
    });
  }

  var paused = false;
  // A paused mark is one hidden behind a real dialog. It must not reposition
  // itself against a page it cannot see, and above all it must not run
  // render() for every scroll event that dialog produces.
  function reflow(){ if(active && !paused) render(); }

  // Closing a mark. `seen` is false only when the mark gave up because its
  // own target was not on screen — in that case it has not been read, so it
  // is not recorded as read and gets another chance later.
  function dismiss(seen){
    if(!active) return;
    if(seen !== false) markDone(active.id);
    document.getElementById('tutLayer').classList.remove('open', 'paused');
    window.removeEventListener('resize', reflow);
    window.removeEventListener('scroll', reflow, true);
    paused = false;
    active = null;
  }

  // Every step's spotlighted element is genuinely tappable (see the
  // pointer-events comment on .tut-layer in the stylesheet) — a step's own
  // text ("tap a course to see its details") is telling the student to do
  // that right now. When that tap opens a REAL modal (course details,
  // achievements, etc.) underneath this layer, fighting it with a dark
  // overlay and a spotlight pointing at now-covered coordinates is worse
  // than just getting out of the way: hide the tour layer for as long as
  // that modal stays open, then treat closing it as "step done" and move
  // on, same reward-the-interaction logic the hold-to-trace step already
  // uses.
  function anyOtherModalOpen(){
    return !!document.querySelector('.modal-overlay.open:not(#tutLayer)');
  }
  // Runs on every real DOM class-change while a tour is active — modal
  // open/close is the common case, but it's also the one place broad
  // enough to catch a step's target disappearing for some OTHER reason
  // with nothing to pause for, e.g. a step whose whole point is "tap this
  // real button" and that real button's own action (Exit Edit Mode) is
  // exactly what removes it from the page. render() already has the "my
  // target is gone, skip it" self-heal (needed for the tour-to-tour case
  // in start() above) — it just needs a trigger beyond the tour's own
  // scroll/resize/step-change calls to notice something changed for a
  // reason that had nothing to do with this tour at all.
  function checkHealth(){
    if(!active) return;
    var blocked = anyOtherModalOpen();
    if(blocked && !paused){
      paused = true;
      document.getElementById('tutLayer').classList.add('paused');
      return;
    }
    if(!blocked && paused){
      // A tour treated closing the modal as "step done" and advanced. There
      // is nothing to advance to, and the mark has now been sitting hidden
      // behind a dialog rather than read — so it comes back, in place.
      paused = false;
      document.getElementById('tutLayer').classList.remove('paused');
      render();
      return;
    }
    var el = active.mark && resolve(active.mark);
    if(!el || el.offsetParent === null){ dismiss(false); }
  }
  // Coalesced to at most one check per animation frame — the interactive
  // trace step alone can fire dozens of class-attribute mutations in a
  // single burst (every related SVG path + course node), and this only
  // ever needs to notice things settling, not react to each one.
  var healthCheckScheduled = false;
  function scheduleHealthCheck(){
    if(healthCheckScheduled) return;
    healthCheckScheduled = true;
    requestAnimationFrame(function(){ healthCheckScheduled = false; checkHealth(); });
  }
  var tutorialWatcher = new MutationObserver(function(){ scheduleHealthCheck(); });
  tutorialWatcher.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

  // ---------------------------------------------------------------------
  // Showing a mark. `id` is the storage key; `mark` is what to show. Both
  // kinds of mark come through here, which is why there is only one of it.
  function show(id, mark){
    // A mark's spotlighted element is genuinely tappable (see the
    // pointer-events comment on .tut-layer in the stylesheet), and some of
    // those taps navigate somewhere else — which calls show() for the next
    // screen's mark in the same synchronous tick, before the observer below
    // has had a chance to notice the old one's target is gone. Without this
    // check the departed mark would block the arriving one forever.
    if(active && active.id !== id){
      var staleEl = resolve(active.mark);
      if(!staleEl || staleEl.offsetParent === null){ dismiss(false); }
    }
    if(active || done(id)) return;
    if(!mark) return;
    // Never two tips in one visit: the second waits for the next time the
    // app is opened, instead of stacking on top of whatever the student is
    // doing now.
    if(shownThisVisit) return;
    shownThisVisit = true;
    active = { id: id, mark: mark };
    document.getElementById('tutLayer').classList.add('open');
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    render();
  }

  function start(id){ show(id, MARKS[id]); }

  // A mark should not open behind, or on top of, the welcome dialog or any
  // other modal — wait until nothing is blocking, then show it.
  function startWhenClear(id){
    if(done(id)) return;
    var tries = 0;
    (function attempt(){
      tries++;
      var blocked = document.querySelector('.modal-overlay.open, #studentInfoOverlay.open');
      if(blocked && tries < 20){ setTimeout(attempt, 400); return; }
      start(id);
    })();
  }

  // ---------------------------------------------------------------------
  // MOMENT marks. Callers say what just happened; this decides whether that
  // is the first time and whether there is anything to say about it. Keyed
  // separately from the arrival marks so that replaying one screen's mark
  // does not drag six others back with it.
  //
  // courseOpen is the exception that has to wait: it fires from inside a
  // dialog that is itself a .modal-overlay.open, which is exactly what
  // startWhenClear() refuses to draw over — so its mark points INTO the
  // open dialog and is shown directly, on the next frame, once that
  // dialog's own markup exists.
  var MOMENT_PREFIX = 'moment_';
  function moment(name){
    var key = MOMENT_PREFIX + name;
    var mark = MOMENTS[name];
    if(!mark || done(key)) return;
    requestAnimationFrame(function(){ show(key, mark); });
  }

  // ---------------------------------------------------------------------
  // Settings' "show the tips again". Clearing one screen's key is what the
  // three existing menu rows ask for; clearing everything, moments included,
  // is what "again" ought to mean when nothing is named.
  function replay(id){
    dismiss(false);
    if(id){
      clearDone(id);
      setTimeout(function(){ start(id); }, 50);
      return;
    }
    Object.keys(MARKS).forEach(clearDone);
    Object.keys(MOMENTS).forEach(function(n){ clearDone(MOMENT_PREFIX + n); });
  }

  function bind(){
    var next = document.getElementById('tutNext');
    if(next) next.addEventListener('click', function(){ dismiss(true); });
  }
  if(document.readyState === 'complete'){ bind(); }
  else { window.addEventListener('load', bind); }

  window.AAUP_TUTORIAL = {
    start: start, startWhenClear: startWhenClear, replay: replay, hasSeen: done,
    // Callers announce a moment; this module decides whether it is worth a
    // sentence. AAUP_TUTORIAL.moment('yearOpen') and friends.
    moment: moment
  };
})();
