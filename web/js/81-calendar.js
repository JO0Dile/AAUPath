// ==========================
// SEMESTER → CALENDAR (.ics)
//
// One file, and the phone already has somewhere to put it.
//
// What this deliberately does NOT do: invent class times. The catalogue this
// app is built from publishes courses, hours and prerequisites — it does not
// publish when anything meets, and the university only issues that at
// registration. So the file carries what is actually known: the semester as a
// dated block, with its course list inside it. The sheet says so in one line
// rather than exporting empty 09:00 slots that would look like real times.
//
// The dates come from the student, because the app does not know those either
// — no term calendar ships with it, and guessing "Fall starts in September"
// would be the same kind of made-up data.
// ==========================
(function(){
  'use strict';

  var SEM = { s1: { en: 'First semester', ar: 'الفصل الأول' },
              s2: { en: 'Second semester', ar: 'الفصل الثاني' },
              s3: { en: 'Summer', ar: 'الصيفي' } };

  var TX = {
    title:   { en: 'Add a semester to your calendar', ar: 'أضف فصلًا إلى تقويمك' },
    sub:     { en: 'Download one file, open it, and the semester’s courses appear in your calendar.',
               ar: 'نزّل ملف واحد وافتحه، وبتطلع مساقات الفصل على تقويمك.' },
    usual:   { en: 'These are the usual dates for that semester. Change them if yours are different.',
               ar: 'هاي التواريخ المعتادة لهذا الفصل. غيّرها إذا فصلك مختلف.' },
    courses: { en: 'courses', ar: 'مساقات' },
    hours:   { en: 'hours', ar: 'ساعة' },
    which:   { en: 'Which semester', ar: 'أي فصل' },
    from:    { en: 'First day', ar: 'أول يوم' },
    to:      { en: 'Last day', ar: 'آخر يوم' },
    note:    { en: 'AAUPath doesn’t know your class times. The university gives those out at registration. Add the times in your calendar once you have them.',
               ar: 'التطبيق ما بيعرف أوقات محاضراتك، الجامعة بتطلعها وقت التسجيل. ضيف الأوقات بتقويمك لما توصلك.' },
    go:      { en: 'Download calendar file', ar: 'نزّل ملف التقويم' },
    cancel:  { en: 'Cancel', ar: 'إلغاء' },
    needDates:{ en: 'Pick both dates first.', ar: 'اختر التاريخين الأول.' },
    badRange:{ en: 'The last day is before the first.', ar: 'آخر يوم قبل أول يوم.' },
    empty:   { en: 'That semester has no courses in it.', ar: 'هذا الفصل ما فيه مساقات.' },
    saved:   { en: 'Calendar file saved.', ar: 'تم حفظ ملف التقويم.' }
  };
  function t(k, r){ return r ? TX[k].ar : TX[k].en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }

  function planFor(prefix){
    return (window.AAUP_IMPORTED && window.AAUP_IMPORTED.loadImportedPlans()[prefix]) || null;
  }

  // Every (year, semester) in the plan that actually holds courses, with the
  // count and hours the student will recognise from the plan itself.
  function semestersOf(prefix, rtl){
    var p = planFor(prefix);
    if(!p || !p.structure || !p.structure.years) return [];
    var out = [];
    p.structure.years.forEach(function(y, i){
      ['s1', 's2', 's3'].forEach(function(s){
        if(s === 's3' && !y.hasSummer) return;
        var courses = (p.courses || []).filter(function(c){
          return c.yearId === y.id && c.semester === s;
        });
        if(!courses.length) return;
        var hours = courses.reduce(function(a, c){ return a + (parseFloat(c.creditHours) || 0); }, 0);
        out.push({
          key: y.id + '|' + s,
          label: (rtl ? 'سنة ' + (i + 1) : 'Year ' + (i + 1)) + ' · ' + (rtl ? SEM[s].ar : SEM[s].en),
          courses: courses, hours: hours
        });
      });
    });
    return out;
  }

  // ---- the file ------------------------------------------------------------

  function fold(line){
    // RFC 5545 wants lines under 75 octets, continued with a leading space.
    if(line.length <= 74) return line;
    var out = line.slice(0, 74), rest = line.slice(74);
    while(rest.length){ out += '\r\n ' + rest.slice(0, 73); rest = rest.slice(73); }
    return out;
  }
  function icsText(s){
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  function ymd(dateStr){ return String(dateStr || '').replace(/-/g, ''); }
  function dayAfter(dateStr){
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  function stamp(){
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  }

  function buildIcs(prefix, sem, from, to, rtl){
    var p = planFor(prefix) || {};
    var planName = (p.majorName && p.majorName.en && (p.majorName.en.big || p.majorName.en)) || prefix;
    var lines = (sem.courses || []).map(function(c){
      var nm = (rtl && c.ar) ? c.ar : (c.name || c.id);
      var num = c.courseNumber && c.courseNumber !== '-' ? c.courseNumber + ' · ' : '';
      return '• ' + nm + ' (' + num + (parseFloat(c.creditHours) || 0) + 'H)';
    });
    var summary = planName + ' · ' + sem.label + ' (' + sem.courses.length + ' courses · ' + sem.hours + 'H)';
    var body = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AAUPath//Study plan//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + prefix + '-' + sem.key.replace('|', '-') + '-' + Date.now() + '@aaupath',
      'DTSTAMP:' + stamp(),
      'DTSTART;VALUE=DATE:' + ymd(from),
      'DTEND;VALUE=DATE:' + dayAfter(to),      // DTEND is exclusive for all-day events
      'SUMMARY:' + icsText(summary),
      'DESCRIPTION:' + icsText(lines.join('\n') + '\n\n' + t('note', rtl)),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return body.map(fold).join('\r\n') + '\r\n';
  }

  function download(text, filename){
    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  // ---- the sheet -----------------------------------------------------------

  // Roughly when each AAUP semester runs, as [month, day] pairs (months are
  // 1-based). Only a starting point so most students can press Download
  // straight away; both fields stay editable and the sheet says so.
  var USUAL = { s1: [[9, 1], [1, 20]], s2: [[2, 10], [6, 10]], s3: [[6, 25], [8, 20]] };
  function iso(y, md){ return y + '-' + (md[0] < 10 ? '0' : '') + md[0] + '-' + (md[1] < 10 ? '0' : '') + md[1]; }
  // The next time that semester runs: the one in progress, or the coming one.
  function usualDates(semKey){
    var type = String(semKey || '').split('|')[1];
    var r = USUAL[type];
    if(!r) return null;
    var now = new Date();
    var today = iso(now.getFullYear(), [now.getMonth() + 1, now.getDate()]);
    for(var y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++){
      var endYear = r[1][0] < r[0][0] ? y + 1 : y;
      var from = iso(y, r[0]), to = iso(endYear, r[1]);
      if(to >= today) return { from: from, to: to };
    }
    return null;
  }

  function open(prefix){
    var overlay = document.getElementById('devModalOverlay');
    var body = document.getElementById('devModalBody');
    if(!overlay || !body) return;
    var rtl = window.__isRtl ? window.__isRtl(prefix) : false;
    var sems = semestersOf(prefix, rtl);
    if(!sems.length){
      if(window.__showToast) window.__showToast(t('empty', rtl));
      return;
    }

    body.innerHTML =
      '<div class="cal-sheet">' +
      '<div class="cal-head"><span class="cal-head-ic">' + window.AAUP_ICONS.preview('calendar', 18) + '</span>' +
        '<h2 class="cal-title">' + esc(t('title', rtl)) + '</h2></div>' +
      '<p class="cal-sub">' + esc(t('sub', rtl)) + '</p>' +
      '<div class="form-field"><label for="icsSem">' + esc(t('which', rtl)) + '</label>' +
        '<select id="icsSem">' + sems.map(function(s){
          return '<option value="' + esc(s.key) + '">' + esc(s.label) + ' · ' + s.courses.length + ' ' + esc(t('courses', rtl)) +
            ' · ' + s.hours + ' ' + esc(t('hours', rtl)) + '</option>';
        }).join('') + '</select></div>' +
      '<div class="cal-dates">' +
        '<div class="form-field"><label for="icsFrom">' + esc(t('from', rtl)) + '</label>' +
          '<input type="date" id="icsFrom"></div>' +
        '<div class="form-field"><label for="icsTo">' + esc(t('to', rtl)) + '</label>' +
          '<input type="date" id="icsTo"></div>' +
      '</div>' +
      '<p class="cal-usual" id="icsUsual" hidden>' + esc(t('usual', rtl)) + '</p>' +
      '<div class="cal-note">' + window.AAUP_ICONS.preview('help', 15) + '<span>' + esc(t('note', rtl)) + '</span></div>' +
      '<div class="cal-actions">' +
        '<button type="button" class="cal-btn" id="icsCancel">' + esc(t('cancel', rtl)) + '</button>' +
        '<button type="button" class="cal-btn cal-btn-primary" id="icsGo">' +
          window.AAUP_ICONS.preview('download', 15) + esc(t('go', rtl)) + '</button>' +
      '</div></div>';
    overlay.classList.add('open');

    // Fill the usual dates for whichever semester is picked, until the
    // student types their own — after that, switching semester leaves
    // their dates alone.
    var fromEl = document.getElementById('icsFrom'), toEl = document.getElementById('icsTo');
    var semEl = document.getElementById('icsSem'), usualEl = document.getElementById('icsUsual');
    var touched = false;
    function fillUsual(){
      if(touched) return;
      var d = usualDates(semEl.value);
      fromEl.value = d ? d.from : '';
      toEl.value = d ? d.to : '';
      usualEl.hidden = !d;
    }
    [fromEl, toEl].forEach(function(el){ el.addEventListener('input', function(){ touched = true; usualEl.hidden = true; }); });
    semEl.addEventListener('change', fillUsual);
    fillUsual();

    document.getElementById('icsCancel').addEventListener('click', function(){
      overlay.classList.remove('open');
    });
    document.getElementById('icsGo').addEventListener('click', function(){
      var key = document.getElementById('icsSem').value;
      var from = document.getElementById('icsFrom').value;
      var to = document.getElementById('icsTo').value;
      if(!from || !to){ if(window.__showToast) window.__showToast(t('needDates', rtl)); return; }
      if(to < from){ if(window.__showToast) window.__showToast(t('badRange', rtl)); return; }
      var sem = sems.filter(function(s){ return s.key === key; })[0];
      if(!sem) return;
      download(buildIcs(prefix, sem, from, to, rtl),
               (prefix + '-' + sem.key.replace('|', '-') + '.ics'));
      overlay.classList.remove('open');
      if(window.__showToast) window.__showToast(t('saved', rtl));
    });
  }

  window.AAUP_CALENDAR = { open: open, semestersOf: semestersOf, buildIcs: buildIcs };
})();
