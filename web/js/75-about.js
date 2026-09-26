// ==========================
// ABOUT US
// ==========================
// The home footer carried three lines of prose — an unofficial-project
// disclaimer, a made-in-Palestine line, and a row of links — under every
// screen of the picker. It is one button now, and this is what opens.
//
// Everything factual about the university here — its name, website, campus
// switchboards, fax lines and public inbox — comes from
// data/aaup/university.json via APP_UNIVERSITIES, so it cannot drift from
// the rest of the app. Those are institutional numbers the university
// publishes itself; the Contacts screen still ships no phone number at all,
// because the numbers there would belong to individual people. The credits
// and the maintainer's own number are given deliberately.
(function(){
  'use strict';

  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }
  function ic(key, size){ return window.AAUP_ICONS ? window.AAUP_ICONS.preview(key, size || 16) : ''; }

  // Phone numbers are given as tel: links so a tap dials rather than
  // making someone copy digits out of a paragraph.
  var MAKER = {
    name: 'AL-Hammam Natsha',
    handles: ['JO0Dile', 'Dile'],
    discord: '_dile_',
    phone: '0543443896'
  };

  var T = {
    en: {
      title: 'About AAUPath',
      what: 'AAUPath is a free, offline-first study planner for AAUP students. It is an unofficial student project — always confirm anything it tells you with your academic advisor.',
      madeIn: 'Made by students in Palestine, for students everywhere.',
      uniLabel: 'The university',
      makerLabel: 'Made by',
      reachLabel: 'Get in touch',
      discord: 'Discord',
      phone: 'Phone',
      uniPhone: 'University switchboard',
      uniEmail: 'University email',
      fax: 'fax',
      more: 'More ways to reach us are coming.'
    },
    ar: {
      title: 'عن AAUPath',
      what: 'AAUPath مخطِّط دراسي مجاني يعمل بدون إنترنت لطلبة الجامعة العربية الأمريكية. هذا مشروع طلابي غير رسمي — تأكّد دائمًا من أي معلومة مع مرشدك الأكاديمي.',
      madeIn: 'صُنع بأيدي طلبة في فلسطين، لطلبة العالم.',
      uniLabel: 'الجامعة',
      makerLabel: 'من إعداد',
      reachLabel: 'للتواصل',
      discord: 'ديسكورد',
      phone: 'هاتف',
      uniPhone: 'مقسم الجامعة',
      uniEmail: 'بريد الجامعة',
      fax: 'فاكس',
      more: 'وسائل تواصل أخرى قريبًا.'
    }
  };

  function uni(){
    var all = window.APP_UNIVERSITIES || {};
    return all.aaup || all[Object.keys(all)[0]] || null;
  }

  // The record carries the university's name in both languages; the Arabic
  // screen should read the Arabic one when there is one.
  function uniName(u, rtl){
    var n = u.name;
    if(!n) return '';
    if(typeof n === 'string') return n;
    return (rtl && n.ar) ? n.ar : (n.en || n.ar || '');
  }

  // A tel: href must not carry spaces; the visible text keeps them, because
  // that is the form the university prints and the form people recognise.
  function telLink(num){
    var n = String(num);
    return '<a href="tel:' + esc(n.replace(/[^+0-9]/g, '')) + '">' + esc(n) + '</a>';
  }

  // The classes are abt-*, not ab-*: the Settings restore points
  // (js/84-autobackup.js) already own .ab-row, and its boxed,
  // space-between rows were being applied here too — which is what pushed
  // every value on this page to the far edge.
  function row(iconKey, label, valueHtml){
    return '<div class="abt-row">' +
      '<span class="abt-row-ic">' + ic(iconKey, 16) + '</span>' +
      '<span class="abt-row-body"><span class="abt-row-label">' + esc(label) + '</span>' +
      '<span class="abt-row-value">' + valueHtml + '</span></span></div>';
  }

  // Drawn, not the 🇵🇸 emoji: Windows has no flag emoji and printed the two
  // letters "PS" in its place.
  var FLAG = '<svg class="abt-flag-mark" width="22" height="15" viewBox="0 0 30 20" aria-hidden="true" focusable="false">' +
    '<rect width="30" height="20" fill="#fff"/><rect width="30" height="6.67" fill="#000"/>' +
    '<rect y="13.33" width="30" height="6.67" fill="#149954"/><path d="M0 0L12 10L0 20z" fill="#e4312b"/></svg>';

  function render(rtl){
    var t = T[rtl ? 'ar' : 'en'];
    var u = uni();
    var site = u && u.website ? String(u.website) : '';
    // Only ever an https link to the university's own site, and the visible
    // text is the bare host rather than the raw URL.
    var host = site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    var siteHtml = /^https:\/\//.test(site)
      ? '<a href="' + esc(site) + '" target="_blank" rel="noopener noreferrer">' + esc(host) + '</a>'
      : esc(host);

    // A campus contributes one row: its switchboard as a tel: link, with the
    // fax number under it when the record carries one. A campus with no
    // phone on file is skipped rather than printed as an empty row.
    var campuses = (u && u.contacts && u.contacts.campuses) || [];
    var campusRows = '';
    for(var i = 0; i < campuses.length; i++){
      var cm = campuses[i];
      if(!cm || !cm.phone) continue;
      var cname = rtl && cm.nameAr ? cm.nameAr : (cm.name || '');
      var value = telLink(cm.phone);
      if(cm.fax){
        value += '<br><span class="abt-sub">' + esc(t.fax) + ' ' + esc(cm.fax) + '</span>';
      }
      campusRows += row('mobile', cname || t.uniPhone, value);
    }

    var uniEmail = u && u.contacts && u.contacts.email;
    var emailRow = uniEmail
      ? row('mail', t.uniEmail,
          '<a href="mailto:' + esc(uniEmail) + '">' + esc(uniEmail) + '</a>')
      : '';

    return (window.__backBarHTML ? window.__backBarHTML('', 'aboutOverlay', rtl) : '') +
      '<div class="abt-head"><span class="abt-head-ic">' + ic('help', 18) + '</span>' +
        '<h2 class="abt-title">' + esc(t.title) + '</h2></div>' +
      '<p class="abt-lead">' + esc(t.what) + '</p>' +
      '<p class="abt-flag">' + FLAG + esc(t.madeIn) + '</p>' +
      // Two groups — the university, and whoever made this — side by side
      // on a wide screen, one after the other on a phone.
      '<div class="abt-cols">' +
        '<div class="abt-rows">' +
          (u ? row('university', t.uniLabel,
            '<b>' + esc(uniName(u, rtl)) + '</b><br>' + siteHtml) : '') +
          campusRows +
          emailRow +
        '</div>' +
        '<div class="abt-rows">' +
          row('person', t.makerLabel,
            '<b>' + esc(MAKER.name) + '</b><br><span class="abt-sub">' + esc(MAKER.handles.join(' · ')) + '</span>') +
          row('speech', t.discord, '<code>' + esc(MAKER.discord) + '</code>') +
          row('mobile', t.phone, telLink(MAKER.phone)) +
        '</div>' +
      '</div>' +
      '<p class="abt-more">' + esc(t.more) + '</p>';
  }

  function open(){
    var overlay = document.getElementById('aboutOverlay');
    var body = document.getElementById('aboutBody');
    if(!overlay || !body) return;
    var rtl = document.documentElement.getAttribute('lang') === 'ar';
    body.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    body.innerHTML = render(rtl);
    overlay.classList.add('open');
  }

  function close(){
    var overlay = document.getElementById('aboutOverlay');
    if(overlay) overlay.classList.remove('open');
  }

  function init(){
    var overlay = document.getElementById('aboutOverlay');
    var closeBtn = document.getElementById('aboutClose');
    if(closeBtn){ closeBtn.addEventListener('click', close); }
    if(overlay){
      overlay.addEventListener('click', function(e){ if(e.target === overlay){ close(); } });
    }
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && overlay && overlay.classList.contains('open')){ close(); }
    });
  }
  if(document.readyState === 'complete'){ init(); }
  else { window.addEventListener('load', init); }

  window.AAUP_ABOUT = { open: open, close: close };
})();
