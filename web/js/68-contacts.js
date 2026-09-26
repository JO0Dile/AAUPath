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
    title: { en: 'Contacts', ar: 'جهات الاتصال' },
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

  function cardHtml(c, data, rtl){
    var cat = data.categories[c.category] || {};
    var catLabel = rtl ? cat.ar : cat.en;
    var subtitle = c.courses && c.courses.length
      ? c.courses.map(esc).join(' · ')
      : esc(c.role || catLabel || '');
    return '<div class="ct-card">' +
      '<div class="ct-card-top">' +
        '<span class="ct-avatar">' + (catIcon(cat, 17) || window.AAUP_ICONS.preview('person', 17)) + '</span>' +
        '<div class="ct-card-main">' +
          '<span class="ct-name">' + esc(c.name) + '</span>' +
          '<span class="ct-sub">' + subtitle + '</span>' +
        '</div>' +
      '</div>' +
      (c.email
        ? '<div class="ct-email-row">' +
            '<a class="ct-email" href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' +
            '<button type="button" class="ct-copy" data-ct-copy="' + esc(c.email) + '">' + t('copy', rtl) + '</button>' +
          '</div>'
        : '<div class="ct-noemail">' + t('noEmail', rtl) + '</div>') +
      '</div>';
  }

  function chipsHtml(data, rtl){
    var order = Object.keys(data.categories);
    var chips = '<button type="button" class="ct-chip' + (activeCat === 'all' ? ' ct-chip-on' : '') +
      '" data-ct-cat="all">' + t('all', rtl) + '</button>';
    order.forEach(function(key){
      var cat = data.categories[key];
      chips += '<button type="button" class="ct-chip' + (activeCat === key ? ' ct-chip-on' : '') +
        '" data-ct-cat="' + esc(key) + '">' + catIcon(cat, 13) + esc(rtl ? cat.ar : cat.en) + '</button>';
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
    body.innerHTML =
      (window.__backBarHTML ? window.__backBarHTML('', 'contactsOverlay', rtl) : '') +
      '<h2 class="mh" style="margin-top:0;">' + window.AAUP_ICONS.preview('people', 20) + t('title', rtl) + '</h2>' +
      '<p class="form-note" style="margin-top:0;">' + t('lead', rtl) + '</p>' +
      '<p class="ct-privacy">' + window.AAUP_ICONS.preview('lock', 14) + ' ' + t('noPhones', rtl) + '</p>' +
      '<div class="ct-loading">' + (window.__skeletonHTML ? window.__skeletonHTML('card', 5, rtl) : (rtl ? 'جارٍ التحميل…' : 'Loading…')) + '</div>';

    load().then(function(data){
      if(data === 'error'){
        body.querySelector('.ct-loading').outerHTML = '<p class="ct-empty">' + t('error', rtl) + '</p>';
        return;
      }
      var loading = body.querySelector('.ct-loading');
      if(loading) loading.remove();
      body.insertAdjacentHTML('beforeend',
        '<input type="search" id="ctSearch" class="ct-search" placeholder="' + t('search', rtl) + '" value="' + esc(search) + '">' +
        '<div class="ct-chips" id="ctChips">' + chipsHtml(data, rtl) + '</div>' +
        '<div id="ctList">' + listHtml(data, rtl) + '</div>');
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
        var ok = function(){ btn.textContent = t('copied', rtl); setTimeout(function(){ btn.textContent = t('copy', rtl); }, 1500); };
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
