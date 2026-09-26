// ==========================
// PREREQUISITE LINE EDITOR — student corrections to the arrows
// ==========================
// The plans are transcribed by hand from university PDFs, so an arrow can be
// missed or read wrong. This lets a student fix that themselves, on the
// official built-in plans as well as their own imported ones, without waiting
// for an app release. Edits live in the window.__applyPrereqEdits overlay
// (never in the shipped plan), so each one is individually reversible and a
// future update that rewrites the base plan keeps them applied.
(function(){
  function isRtl(prefix){ return window.__isRtl ? window.__isRtl(prefix) : false; }
  function infoFor(prefix){ return (window.__PLAN_DATA[prefix] || {}).courseInfo || {}; }
  function nameFor(prefix, slug, rtl){
    var meta = infoFor(prefix)[slug];
    if(!meta) return slug;
    return (rtl && meta.ar) ? meta.ar : (meta.name || slug);
  }
  function editsFor(prefix){
    var m = window.__loadPrereqEdits()[prefix] || {};
    return { added: m.added || [], removed: m.removed || [] };
  }
  function saveEditsFor(prefix, e){
    var all = window.__loadPrereqEdits();
    if(!e.added.length && !e.removed.length){ delete all[prefix]; }
    else { all[prefix] = { added: e.added, removed: e.removed }; }
    window.__savePrereqEdits(all);
  }
  function isUserAdded(prefix, a, b){
    var k = window.__prereqPairKey(a, b);
    return editsFor(prefix).added.some(function(p){ return window.__prereqPairKey(p[0], p[1]) === k; });
  }

  // Adding an arrow that closes a loop would make every course in that loop
  // permanently "unavailable" (each waiting on the other), so it's rejected
  // rather than silently corrupting the plan.
  function wouldCycle(prefix, from, to){
    var unlocks = (window.__PLAN_DATA[prefix] || {}).unlocksMap || {};
    if(from === to) return true;
    var seen = {}, stack = [to];
    while(stack.length){
      var cur = stack.pop();
      if(cur === from) return true;
      if(seen[cur]) continue;
      seen[cur] = true;
      (unlocks[cur] || []).forEach(function(n){ if(!seen[n]) stack.push(n); });
    }
    return false;
  }

  function afterChange(prefix){
    window.__rebuildPlanData(prefix);
    if(window.__refreshPlanUI){ window.__refreshPlanUI(prefix); }
    render(prefix);
  }

  function addLine(prefix, from, to){
    var rtl = isRtl(prefix);
    var info = infoFor(prefix);
    if(!from || !to){
      if(window.__showToast){ window.__showToast((rtl ? 'اختر المساقين أولًا.' : 'Pick both courses first.')); }
      return;
    }
    if(!info[from] || !info[to]){
      if(window.__showToast){ window.__showToast((rtl ? 'مساق غير معروف.' : 'Unknown course.')); }
      return;
    }
    if(from === to){
      if(window.__showToast){ window.__showToast((rtl ? 'لا يمكن ربط المساق بنفسه.' : 'A course can’t be its own prerequisite.')); }
      return;
    }
    var existing = (window.__PLAN_DATA[prefix] || {}).prereqs || [];
    var k = window.__prereqPairKey(from, to);
    if(existing.some(function(p){ return window.__prereqPairKey(p[0], p[1]) === k; })){
      if(window.__showToast){ window.__showToast((rtl ? 'هذا الخط موجود بالفعل.' : 'That line already exists.')); }
      return;
    }
    if(wouldCycle(prefix, from, to)){
      if(window.__showToast){
        window.__showToast((rtl
          ? 'هذا الربط يُنشئ حلقة مغلقة — سيجعل المساقين مستحيلي التسجيل.'
          : 'That link would create a loop — both courses could never become available.'));
      }
      return;
    }
    var e = editsFor(prefix);
    // If they'd previously removed this exact official line, adding it back is
    // just dropping the removal — keeps the overlay minimal and honest.
    var wasRemoved = e.removed.indexOf(k) !== -1;
    if(wasRemoved){ e.removed = e.removed.filter(function(x){ return x !== k; }); }
    else { e.added.push([from, to]); }
    saveEditsFor(prefix, e);
    afterChange(prefix);
    if(window.__showToast){ window.__showToast(rtl ? 'تمت إضافة الخط.' : 'Line added.'); }
  }

  function removeLine(prefix, from, to){
    var rtl = isRtl(prefix);
    var k = window.__prereqPairKey(from, to);
    var e = editsFor(prefix);
    var addedIdx = -1;
    e.added.forEach(function(p, i){ if(window.__prereqPairKey(p[0], p[1]) === k) addedIdx = i; });
    if(addedIdx !== -1){ e.added.splice(addedIdx, 1); }
    else if(e.removed.indexOf(k) === -1){ e.removed.push(k); }
    saveEditsFor(prefix, e);
    afterChange(prefix);
    if(window.__showToast){ window.__showToast(rtl ? 'تمت إزالة الخط.' : 'Line removed.'); }
  }

  function resetAll(prefix){
    var rtl = isRtl(prefix);
    var msg = rtl
      ? 'إعادة كل خطوط المتطلبات إلى الخطة الرسمية؟ ستفقد تعديلاتك على الخطوط في هذه الخطة.'
      : 'Reset every prerequisite line back to the official plan? Your line edits for this plan will be lost.';
    var doIt = function(){
      var all = window.__loadPrereqEdits();
      delete all[prefix];
      window.__savePrereqEdits(all);
      afterChange(prefix);
      if(window.__showToast){ window.__showToast(rtl ? 'تمت الإعادة إلى الخطة الرسمية.' : 'Reset to the official plan.'); }
    };
    if(window.__showConfirmDialog){ window.__showConfirmDialog(msg, doIt, rtl); }
    else { doIt(); }
  }

  function courseOptionsHtml(prefix, rtl){
    var info = infoFor(prefix);
    var esc = window.__escapeHtml;
    return Object.keys(info).sort(function(a, b){
      return nameFor(prefix, a, rtl).localeCompare(nameFor(prefix, b, rtl));
    }).map(function(slug){
      var num = info[slug] && info[slug].num && info[slug].num !== '-' ? ' (' + info[slug].num + ')' : '';
      // nameFor()/num both come from courseInfo, already HTML-escaped once
      // by the sync sanitizer — esc()'ing again would show a literal "&amp;".
      return '<option value="' + esc(slug) + '">' + nameFor(prefix, slug, rtl) + num + '</option>';
    }).join('');
  }

  function render(prefix){
    var body = document.getElementById('devModalBody');
    if(!body) return;
    var rtl = isRtl(prefix);
    var esc = window.__escapeHtml;
    var data = window.__PLAN_DATA[prefix] || {};
    var lines = (data.prereqs || []).slice().sort(function(p, q){
      return nameFor(prefix, p[1], rtl).localeCompare(nameFor(prefix, q[1], rtl));
    });
    var e = editsFor(prefix);
    var opts = courseOptionsHtml(prefix, rtl);

    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML =
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('link', 20) + (rtl ? 'خطوط المتطلبات السابقة' : 'Prerequisite lines') + '</h2>' +
      '<p class="form-note">' + (rtl
        ? 'إذا لاحظت أن مساقًا ينقصه خط، أو أن خطًا غير صحيح، صحّحه هنا. تعديلاتك محفوظة على جهازك ولا تغيّر الخطة الرسمية لبقية الطلاب.'
        : 'If a course is missing a line, or a line looks wrong, correct it here. Your edits are saved on your device and don’t change the official plan for anyone else.') + '</p>' +
      '<div class="line-add-row">' +
        '<label>' + (rtl ? 'المتطلب السابق' : 'Prerequisite') +
          '<select id="lineFromSelect"><option value="">' + (rtl ? '— اختر —' : '— pick —') + '</option>' + opts + '</select></label>' +
        '<span class="line-arrow" aria-hidden="true">→</span>' +
        '<label>' + (rtl ? 'المساق الذي يحتاجه' : 'Course that needs it') +
          '<select id="lineToSelect"><option value="">' + (rtl ? '— اختر —' : '— pick —') + '</option>' + opts + '</select></label>' +
        '<button type="button" class="home-btn" id="lineAddBtn">' + (rtl ? 'إضافة خط' : 'Add line') + '</button>' +
      '</div>' +
      '<div class="line-list-head">' +
        '<span>' + (rtl ? 'الخطوط الحالية' : 'Current lines') + ' (' + lines.length + ')</span>' +
        ((e.added.length || e.removed.length)
          ? '<button type="button" class="home-btn line-reset-btn" id="lineResetBtn">' + (rtl ? 'إعادة للرسمي' : 'Reset to official') + '</button>'
          : '') +
      '</div>' +
      '<div class="line-list">' +
        (lines.length
          ? lines.map(function(p){
              var added = isUserAdded(prefix, p[0], p[1]);
              return '<div class="line-item">' +
                '<span class="line-text">' + nameFor(prefix, p[0], rtl) + ' <b>→</b> ' + nameFor(prefix, p[1], rtl) + '</span>' +
                (added ? '<span class="line-badge">' + (rtl ? 'مضاف' : 'added by you') + '</span>' : '') +
                '<button type="button" class="line-remove" data-from="' + esc(p[0]) + '" data-to="' + esc(p[1]) + '" aria-label="' + (rtl ? 'إزالة' : 'Remove') + '">✕</button>' +
                '</div>';
            }).join('')
          : '<p class="ex-note">' + (rtl ? 'لا توجد خطوط.' : 'No lines yet.') + '</p>') +
      '</div>' +
      (e.removed.length
        ? '<p class="form-note">' + (rtl
            ? ('أزلت ' + e.removed.length + ' من خطوط الخطة الرسمية.')
            : ('You’ve removed ' + e.removed.length + ' official line' + (e.removed.length === 1 ? '' : 's') + '.')) + '</p>'
        : '') +
      '<div class="form-actions"><button type="button" class="home-btn" id="lineCloseBtn">' + (rtl ? 'إغلاق' : 'Close') + '</button></div>';

    var closeBtn = document.getElementById('lineCloseBtn');
    if(closeBtn){
      closeBtn.addEventListener('click', function(){
        var ov = document.getElementById('devModalOverlay');
        if(ov) ov.classList.remove('open');
      });
    }
    var addBtn = document.getElementById('lineAddBtn');
    if(addBtn){
      addBtn.addEventListener('click', function(){
        var f = document.getElementById('lineFromSelect');
        var t = document.getElementById('lineToSelect');
        addLine(prefix, f ? f.value : '', t ? t.value : '');
      });
    }
    var resetBtn = document.getElementById('lineResetBtn');
    if(resetBtn){ resetBtn.addEventListener('click', function(){ resetAll(prefix); }); }
    body.querySelectorAll('.line-remove').forEach(function(btn){
      btn.addEventListener('click', function(){
        removeLine(prefix, btn.getAttribute('data-from'), btn.getAttribute('data-to'));
      });
    });
  }

  function open(prefix){
    var overlay = document.getElementById('devModalOverlay');
    if(!overlay) return;
    render(prefix);
    overlay.classList.add('open');
  }

  window.AAUP_LINKS = { open: open, addLine: addLine, removeLine: removeLine };
})();
