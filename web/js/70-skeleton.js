// ==========================
// SKELETON LOADING — placeholder shapes instead of "Loading…" text, plus a
// rotating tip underneath.
//
// Almost everything in this app is precached, so a real wait is rare and
// usually under a second (Contacts, the Thoughts wall). A skeleton earns its
// keep anyway: it shows the shape of what's coming instead of a blank flash
// of text that's gone before anyone reads it, and the tip underneath gives
// that same instant something worth glancing at rather than nothing at all.
// ==========================
(function(){
  'use strict';

  var TIPS_EN = [
    'Tip: tap any course card to see its full description and prerequisites.',
    'Tip: the round button in the corner runs a health check on the app.',
    '"Show only what I can take" hides everything you cannot register for yet.',
    'Your theme — and now your own colors — live in Settings.',
    'Degree Audit shows exactly how many hours are left in each category.',
    'A course card turns green the moment every prerequisite is done.',
    'Fun fact: this whole app works with no internet connection at all.',
    '"What if…" answers "what grade do I need next semester" in one tap.',
    'Tip: press and hold a course for its planning shortcuts.',
    '"When do I graduate?" is an estimate — it does not know your real enrollment date.'
  ];
  var TIPS_AR = [
    'نصيحة: اضغط على أي مساق لترى وصفه الكامل والمتطلبات السابقة.',
    'نصيحة: الزر الدائري بالزاوية يفحص صحة التطبيق.',
    '"أظهر ما يمكنني أخذه فقط" يخفي كل شي ما بتقدر تسجله لسه.',
    'شكل التطبيق — وألوانك الخاصة كمان — موجودين بالإعدادات.',
    'تدقيق الخطة يوريك بالضبط كم ساعة باقيلك بكل قسم.',
    'المساق بيصير أخضر لما تخلص كل متطلباته السابقة.',
    'معلومة: التطبيق كله بيشتغل بدون أي انترنت.',
    '"ماذا لو…" بيجاوبك بلمح البصر شو العلامة اللي لازمك الفصل الجاي.',
    'نصيحة: اضغط مطولاً على مساق لاختصارات التخطيط.',
    '"متى أتخرّج؟" مجرد تقدير — التطبيق ما بيعرف تاريخ تسجيلك الحقيقي.'
  ];

  function tip(rtl){
    var list = rtl ? TIPS_AR : TIPS_EN;
    return list[Math.floor(Math.random() * list.length)];
  }

  // 'card' — an avatar + two lines, the shape of a contact/course card.
  // 'line' — one bare placeholder line, for simpler lists.
  function shapeHTML(kind){
    if(kind === 'line') return '<div class="skel-line"></div>';
    return '<div class="skel-card">' +
      '<div class="skel-avatar"></div>' +
      '<div class="skel-lines"><div class="skel-line skel-line-a"></div><div class="skel-line skel-line-b"></div></div>' +
      '</div>';
  }

  function block(kind, count, rtl){
    var html = '<div class="skel-wrap" role="status" aria-live="polite">';
    for(var i = 0; i < count; i++){ html += shapeHTML(kind); }
    html += '<p class="skel-tip">' + tip(rtl) + '</p></div>';
    return html;
  }

  window.__skeletonHTML = block;
})();
