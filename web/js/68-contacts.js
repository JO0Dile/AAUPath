// ==========================
// CONTACTS — a searchable directory of instructors and university offices.
//
// Read-only, offline, bundled with the app exactly like plans.json — no
// live server, no login, nothing a student has to configure. The data
// comes from web/contacts.json, built from data/aaup/contacts.json by
// tools/build-contacts.py, which refuses to write the file at all if a
// phone-number-shaped field sneaks in. Only names, courses/roles and
// @aaup.edu emails ever reach this screen; see that script's comment for
// why phone numbers specifically are kept out of a public, permanently
// crawlable site.
// ==========================
(function(){
  'use strict';

  var cache = null;   // { categories, contacts } once loaded, or 'error'
  var search = '';
  var activeCat = 'all';

  function esc(s){
    var v = String(s == null ? '' : s);
    return window.__cleanText ? window.__cleanText(v) : (window.__escapeHtml ? window.__escapeHtml(v) : v);
  }

  // Categories carry both an iconKey (a drawn line icon) and the emoji they
  // shipped with. Prefer the drawn one, exactly like majors and faculties
  // do — a hand-drawn icon next to an emoji reads as two different apps.
  function catIcon(cat, size){
    if(!cat) return '';
    if(cat.iconKey && window.AAUP_ICONS && window.AAUP_ICONS.preview(cat.iconKey, size)){
      return window.AAUP_ICONS.preview(cat.iconKey, size || 16);
    }
    return esc(cat.icon || '');
  }

  function load(){
    if(cache) return Promise.resolve(cache);
    return fetch('contacts.json').then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(data){
      cache = data;
      return cache;
    }).catch(function(){
      cache = 'error';
      return cache;
    });
  }

  var TX = {
    title: { en: 'Find a Professor', ar: 'ابحث عن محاضر' },
    titleOffices: { en: 'University contacts', ar: 'جهات اتصال الجامعة' },
    copyEmail: { en: 'Copy email', ar: 'انسخ الإيميل' },
    sendEmail: { en: 'Email', ar: 'راسل' },
    mineNote: { en: 'Green: a course you still have to take.', ar: 'الأخضر: مساق لسا لازم تاخذه.' },
    emailOnly: { en: 'Email only: phone numbers aren’t listed here.', ar: 'إيميل بس: أرقام الهواتف مش منشورة هون.' },
    lead: { en: 'Instructors and university offices, straight from the app — no forwarding, no lookup somewhere else.',
            ar: 'المحاضرون ومكاتب الجامعة، مباشرة من التطبيق — بلا تحويل ولا بحث بمكان ثاني.' },
    search: { en: 'Search a name, course, or office…', ar: 'ابحث عن اسم، مساق، أو مكتب…' },
    all: { en: 'All', ar: 'الكل' },
    noEmail: { en: 'No email on file', ar: 'لا يوجد بريد مسجّل' },
    copy: { en: 'Copy', ar: 'نسخ' },
    copied: { en: 'Copied ✓', ar: 'انتسخ ✓' },
    empty: { en: 'Nothing matches that.', ar: 'ما في نتائج.' },
    error: { en: 'Could not load the contacts list.', ar: 'ما قدرنا نحمّل قائمة جهات الاتصال.' },
    noPhones: { en: 'Phone numbers are deliberately not published here — email is the only contact method this screen shows.',
                ar: 'أرقام الهواتف غير منشورة هون عن قصد — البريد الإلكتروني هو وسيلة التواصل الوحيدة بهذه الشاشة.' }
  };
  function t(k, r){ return r ? TX[k].ar : TX[k].en; }

  function matches(c, q){
    if(!q) return true;
    var hay = [c.name, c.role || '', (c.courses || []).join(' '), c.email || ''].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  // Courses this student still has to take, by normalised name, so the
  // professors who teach them stand out. Built once per render from the
  // selected plan; empty when no plan is picked yet.
  var mine = {};
  function normName(n){ return String(n || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim(); }
  function buildMine(prefix){
    mine = {};
    var info = prefix && window.__PLAN_DATA && window.__PLAN_DATA[prefix] ? (window.__PLAN_DATA[prefix].courseInfo || {}) : {};
    var progress = window.__getProgress ? window.__getProgress() : {};
    Object.keys(info).forEach(function(slug){
      var id = window.AAUP_GPA && window.AAUP_GPA.primaryId ? window.AAUP_GPA.primaryId(prefix, slug) : (prefix + '-c-' + slug);
      if(!progress[id]) mine[normName(info[slug].name)] = true;
    });
  }

  function initials(name){
    var parts = String(name || '').replace(/^(dr|prof|mr|ms|mrs|eng)\.?\s+/i, '').split(/\s+/).filter(Boolean);
    return ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
  }

  // One line per person: who, what they teach, and the two things you came
  // to do (copy the address, or write to them). The old card spent a whole
  // box on each, with the address as a link and "Copy" as a second button
  // under it.
  function cardHtml(c, data, rtl){
    var cat = data.categories[c.category] || {};
    var catLabel = rtl ? cat.ar : cat.en;
    var isPerson = c.category === 'instructor';
    var avatar = isPerson ? esc(initials(c.name)).toUpperCase() : (catIcon(cat, 20) || window.AAUP_ICONS.preview('person', 20));
    var sub = c.courses && c.courses.length
      ? '<span class="ct-courses">' + c.courses.map(function(n){
          return '<span class="ct-course' + (mine[normName(n)] ? ' ct-course-mine' : '') + '">' + esc(n) + '</span>';
        }).join('') + '</span>'
      : '<span class="ct-sub">' + esc(c.role || catLabel || '') + '</span>';
    return '<div class="ct-card">' +
      '<span class="ct-avatar' + (isPerson ? ' ct-avatar-initials' : '') + '">' + avatar + '</span>' +
      '<div class="ct-card-main">' +
        '<span class="ct-name">' + esc(c.name) + '</span>' + sub +
        (c.email ? '<span class="ct-email-text" dir="ltr">' + esc(c.email) + '</span>' : '<span class="ct-noemail">' + t('noEmail', rtl) + '</span>') +
      '</div>' +
      (c.email
        ? '<div class="ct-acts">' +
            '<button type="button" class="ct-icbtn" data-ct-copy="' + esc(c.email) + '" title="' + t('copyEmail', rtl) + '" aria-label="' + t('copyEmail', rtl) + ': ' + esc(c.name) + '">' + window.AAUP_ICONS.preview('copy', 20) + '</button>' +
            '<a class="ct-icbtn ct-icbtn-pri" href="mailto:' + esc(c.email) + '" title="' + t('sendEmail', rtl) + '" aria-label="' + t('sendEmail', rtl) + ': ' + esc(c.name) + '">' + window.AAUP_ICONS.preview('mail', 20) + '</a>' +
          '</div>'
        : '') +
      '</div>';
  }

  function chipsHtml(data, rtl){
    // Instructors first — it is what this screen is named for — then All,
    // then the offices in the order contacts.json declares them.
    var order = Object.keys(data.categories);
    var first = order.indexOf('instructor') !== -1 ? ['instructor'] : [];
    var chip = function(key){
      var cat = data.categories[key];
      return '<button type="button" class="ct-chip' + (activeCat === key ? ' ct-chip-on' : '') +
        '" data-ct-cat="' + esc(key) + '">' + esc(rtl ? cat.ar : cat.en) + '</button>';
    };
    var chips = first.map(chip).join('') +
      '<button type="button" class="ct-chip' + (activeCat === 'all' ? ' ct-chip-on' : '') +
      '" data-ct-cat="all">' + t('all', rtl) + '</button>';
    order.filter(function(k){ return first.indexOf(k) === -1; }).forEach(function(key){
      chips += chip(key);
    });
    return chips;
  }

  // A directory, not a stack. 27 identical cards in one flat grid meant
  // finding the registration office was reading every instructor first —
  // the category was on each card as a small avatar icon and nowhere as
  // structure. Grouped under their own headed sections, in the order
  // contacts.json declares its categories, each stating its count.
  //
  // Same shelf treatment the Course Library uses, deliberately: two lists in
  // the same app that group things should not group them two different ways.
  function listHtml(data, rtl){
    var q = search.trim().toLowerCase();
    var rows = data.contacts.filter(function(c){
      return (activeCat === 'all' || c.category === activeCat) && matches(c, q);
    });
    if(!rows.length){
      return '<p class="ct-empty">' + t('empty', rtl) + '</p>';
    }
    var byCat = {};
    rows.forEach(function(c){ (byCat[c.category] = byCat[c.category] || []).push(c); });
    var order = Object.keys(data.categories || {}).filter(function(k){ return byCat[k]; });
    // Anything carrying a category the file does not declare still gets
    // listed, at the end, rather than vanishing from the directory.
    Object.keys(byCat).forEach(function(k){ if(order.indexOf(k) === -1){ order.push(k); } });

    // One section is the flat grid this replaced with a redundant header on
    // top — which is exactly what filtering to a single chip produces.
    if(order.length === 1){
      return '<div class="ct-grid">' + rows.map(function(c){ return cardHtml(c, data, rtl); }).join('') + '</div>';
    }
    return order.map(function(key){
      var cat = (data.categories || {})[key] || {};
      var label = rtl ? (cat.ar || key) : (cat.en || key);
      return '<section class="ct-group">' +
        '<div class="ct-group-head">' +
          '<span class="ct-group-label">' + catIcon(cat, 14) + esc(label) + '</span>' +
          '<span class="ct-group-count">' + byCat[key].length + '</span>' +
        '</div>' +
        '<div class="ct-grid">' + byCat[key].map(function(c){ return cardHtml(c, data, rtl); }).join('') + '</div>' +
        '</section>';
    }).join('');
  }

  function render(prefix){
    var body = document.getElementById('contactsBody');
    if(!body) return;
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    buildMine(prefix);
    // A full page, not a pop-up: the directory is something you read down,
    // and it was squeezed into a 420px card with the list starting half-way
    // down the first screen.
    body.innerHTML =
      (window.__backBarHTML ? window.__backBarHTML('', 'contactsOverlay', rtl) : '') +
      '<div class="ct-head"><span class="ct-head-ic">' + window.AAUP_ICONS.preview(activeCat === 'instructor' ? 'cap' : 'people', 26) + '</span>' +
        '<h2 class="ct-title" id="ctTitle">' + t(activeCat === 'instructor' || activeCat === 'all' ? 'title' : 'titleOffices', rtl) + '</h2></div>' +
      '<div class="ct-loading">' + (window.__skeletonHTML ? window.__skeletonHTML('card', 5, rtl) : (rtl ? 'جارٍ التحميل…' : 'Loading…')) + '</div>';

    load().then(function(data){
      if(data === 'error'){
        body.querySelector('.ct-loading').outerHTML = '<p class="ct-empty">' + t('error', rtl) + '</p>';
        return;
      }
      var loading = body.querySelector('.ct-loading');
      if(loading) loading.remove();
      body.insertAdjacentHTML('beforeend',
        '<label class="ct-search-wrap"><span class="ct-search-ic" aria-hidden="true">' + window.AAUP_ICONS.preview('search', 22) + '</span>' +
          '<input type="search" id="ctSearch" class="ct-search" aria-label="' + t('search', rtl) + '" placeholder="' + t('search', rtl) + '" value="' + esc(search) + '"></label>' +
        '<div class="ct-chips" id="ctChips">' + chipsHtml(data, rtl) + '</div>' +
        '<div id="ctList">' + listHtml(data, rtl) + '</div>' +
        '<p class="ct-foot">' + window.AAUP_ICONS.preview('lock', 16) + '<span>' + t('emailOnly', rtl) +
          (Object.keys(mine).length ? ' ' + t('mineNote', rtl) : '') + '</span></p>');
      bind(prefix, data, rtl);
    });
  }

  function refreshList(data, rtl){
    var list = document.getElementById('ctList');
    if(list) list.innerHTML = listHtml(data, rtl);
    bindCopy();
  }

  function bindCopy(){
    document.querySelectorAll('[data-ct-copy]').forEach(function(btn){
      if(btn.__ctBound) return;
      btn.__ctBound = true;
      btn.addEventListener('click', function(){
        var email = btn.getAttribute('data-ct-copy');
        var rtl = document.getElementById('contactsBody').getAttribute('dir') === 'rtl';
        var ok = function(){
          btn.innerHTML = window.AAUP_ICONS.preview('check', 20);
          btn.classList.add('is-done');
          if(window.__showToast) window.__showToast(t('copied', rtl));
          setTimeout(function(){ btn.innerHTML = window.AAUP_ICONS.preview('copy', 20); btn.classList.remove('is-done'); }, 1500);
        };
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(email).then(ok, function(){});
        }
      });
    });
  }

  function bind(prefix, data, rtl){
    var search_ = document.getElementById('ctSearch');
    if(search_){
      search_.addEventListener('input', function(){
        search = search_.value;
        refreshList(data, rtl);
      });
    }
    var chips = document.getElementById('ctChips');
    if(chips){
      chips.addEventListener('click', function(e){
        var btn = e.target.closest ? e.target.closest('[data-ct-cat]') : null;
        if(!btn) return;
        activeCat = btn.getAttribute('data-ct-cat');
        chips.querySelectorAll('.ct-chip').forEach(function(c){ c.classList.remove('ct-chip-on'); });
        btn.classList.add('ct-chip-on');
        var title = document.getElementById('ctTitle');
        if(title) title.textContent = t(activeCat === 'instructor' || activeCat === 'all' ? 'title' : 'titleOffices', rtl);
        refreshList(data, rtl);
      });
    }
    bindCopy();
  }

  // opts.category / opts.query open it already narrowed — "Find a Professor"
  // lands on Instructors, and a name picked from the home search lands on
  // that one person. Left out, it opens however it was last left.
  function open(prefix, opts){
    var overlay = document.getElementById('contactsOverlay');
    if(!overlay) return;
    if(opts && opts.category) activeCat = opts.category;
    if(opts && typeof opts.query === 'string') search = opts.query;
    render(prefix);
    overlay.classList.add('open');
  }

  function bindOverlay(){
    var overlay = document.getElementById('contactsOverlay');
    if(!overlay) return;
    var close = function(){ overlay.classList.remove('open'); };
    var closeBtn = document.getElementById('contactsClose');
    if(closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    var card = overlay.querySelector('.modal-card');
    if(card) card.addEventListener('click', function(e){ e.stopPropagation(); });
  }
  if(document.readyState === 'complete'){ bindOverlay(); }
  else { window.addEventListener('load', bindOverlay); }

  window.AAUP_CONTACTS = { open: open, data: load };
})();
