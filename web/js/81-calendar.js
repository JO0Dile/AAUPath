// ==========================
// SEMESTER → CALENDAR (.ics)
//
// One file, and the phone already has somewhere to put it.
//
// The file holds the student's own class times (js/102-timetable.js): each
// class on its days, at its times, with its room, repeating every week from
// the first day to the last. Nothing else — it used to add the semester as
// one all-day block running for months, which covered every day of the
// calendar and said nothing useful. With no class times entered for that
// semester there is nothing worth putting in a calendar, so the sheet asks
// for the times first instead of exporting a file.
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
    sub:     { en: 'Download one file, open it, and your classes appear in your calendar every week.',
               ar: 'نزّل ملف واحد وافتحه، وبتطلع محاضراتك على تقويمك كل أسبوع.' },
    usual:   { en: 'These are the usual dates for that semester. Change them if yours are different.',
               ar: 'هاي التواريخ المعتادة لهذا الفصل. غيّرها إذا فصلك مختلف.' },
    courses: { en: 'courses', ar: 'مساقات' },
    hours:   { en: 'hours', ar: 'ساعة' },
    which:   { en: 'Which semester', ar: 'أي فصل' },
    from:    { en: 'First day', ar: 'أول يوم' },
    to:      { en: 'Last day', ar: 'آخر يوم' },
    noTimes: { en: 'Add your class times first. Each class then goes into your calendar on its days and times, every week until the last day.',
               ar: 'ضيف أوقات محاضراتك أول. بعدها كل محاضرة بتنحط بتقويمك بأيامها وساعاتها، كل أسبوع لآخر يوم.' },
    addTimes:{ en: 'Add class times', ar: 'ضيف أوقات المحاضرات' },
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
  function stamp(){
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  }

  // The weekly meetings that belong in this semester's file: the times kept
  // for its own courses, plus the other classes the student added (picked
  // or typed) when this is the semester they are in now.
  var BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  function meetingsFor(prefix, sem){
    var T = window.AAUP_TIMETABLE;
    if(!T || !T.forPlan) return [];
    var map = T.forPlan(prefix), out = [], seen = {};
    var list = (sem.courses || []).slice();
    var own = {};
    list.forEach(function(c){ own[c.id] = 1; });
    var now = T.courses ? T.courses(prefix) : [];
    var isCurrent = now.some(function(c){ return own[c.id]; });
    if(isCurrent) now.forEach(function(c){ if(!own[c.id]) list.push(c); });
    list.forEach(function(c){
      if(seen[c.id]) return;
      seen[c.id] = 1;
      (map[c.id] || []).forEach(function(m){ if(m && m.d && m.d.length && m.s && m.e) out.push({ c: c, m: m }); });
    });
    return out;
  }
  function hhmmss(t){ var p = String(t).split(':'); return (p[0].length < 2 ? '0' : '') + p[0] + p[1] + '00'; }
  // The first date on or after `from` that falls on one of these weekdays.
  function firstOn(from, days){
    var d = new Date(from + 'T00:00:00Z');
    for(var i = 0; i < 7; i++){
      if(days.indexOf(d.getUTCDay()) >= 0) return d.toISOString().slice(0, 10).replace(/-/g, '');
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return ymd(from);
  }

  function buildIcs(prefix, sem, from, to, rtl){
    var events = [];
    meetingsFor(prefix, sem).forEach(function(x, i){
      var c = x.c, m = x.m;
      var nm = (rtl && c.ar) ? c.ar : (c.name || c.id);
      var num = c.courseNumber && c.courseNumber !== '-' ? c.courseNumber : '';
      var day = firstOn(from, m.d);
      // Floating local times (no time zone): 08:00 means 08:00 wherever the
      // phone is, which is what a class timetable means.
      events.push(
        'BEGIN:VEVENT',
        'UID:' + prefix + '-' + sem.key.replace('|', '-') + '-' + i + '-' + Date.now() + '@aaupath',
        'DTSTAMP:' + stamp(),
        'DTSTART:' + day + 'T' + hhmmss(m.s),
        'DTEND:' + day + 'T' + hhmmss(m.e),
        'RRULE:FREQ=WEEKLY;BYDAY=' + m.d.map(function(d){ return BYDAY[d]; }).join(',') + ';UNTIL=' + ymd(to) + 'T235959',
        'SUMMARY:' + icsText(nm),
        (m.r ? 'LOCATION:' + icsText(m.r) : ''),
        (num ? 'DESCRIPTION:' + icsText(num + ' · ' + (parseFloat(c.creditHours) || 0) + 'H') : ''),
        'END:VEVENT'
      );
    });
    var body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AAUPath//Class times//EN', 'CALSCALE:GREGORIAN']
      .concat(events.filter(Boolean), ['END:VCALENDAR']);
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
      // The weekly times live in their own window (js/102-timetable.js);
      // this is the obvious place to look for them.
      (window.AAUP_TIMETABLE ? '<button type="button" class="home-btn cal-tt-btn" data-tt-open>' + window.AAUP_ICONS.preview('clock', 15) +
        esc(rtl ? 'أوقات محاضراتك الأسبوعية' : 'Your weekly class times') + '</button>' : '') +
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
      '<div class="cal-note" id="icsNote">' + window.AAUP_ICONS.preview('help', 15) + '<span id="icsNoteTx"></span></div>' +
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
    // Start on the semester the student is in now, not always Year 1.
    var nowIds = (window.AAUP_TIMETABLE && window.AAUP_TIMETABLE.courses ? window.AAUP_TIMETABLE.courses(prefix) : []).map(function(c){ return c.id; });
    var nowSem = sems.filter(function(x){ return x.courses.some(function(c){ return nowIds.indexOf(c.id) >= 0; }); })[0];
    if(nowSem) semEl.value = nowSem.key;
    var touched = false;
    function fillUsual(){
      if(touched) return;
      var d = usualDates(semEl.value);
      fromEl.value = d ? d.from : '';
      toEl.value = d ? d.to : '';
      usualEl.hidden = !d;
    }
    [fromEl, toEl].forEach(function(el){ el.addEventListener('input', function(){ touched = true; usualEl.hidden = true; }); });
    // How many weekly classes the file would carry; with none, the main
    // button opens the class times instead of saving an empty file.
    var goEl = document.getElementById('icsGo'), noteTx = document.getElementById('icsNoteTx');
    var goLabel = goEl.innerHTML;
    function current(){ return sems.filter(function(s){ return s.key === semEl.value; })[0]; }
    function refreshNote(){
      var sem = current(), n = sem ? meetingsFor(prefix, sem).length : 0;
      goEl.setAttribute('data-need-times', n ? '0' : '1');
      if(n){
        var names = {};
        meetingsFor(prefix, sem).forEach(function(x){ names[x.c.id] = 1; });
        var k = Object.keys(names).length;
        noteTx.textContent = rtl
          ? k + ' مساقات بأوقاتها وقاعاتها، بتتكرر كل أسبوع لآخر يوم.'
          : k + ' course' + (k === 1 ? '' : 's') + ' with their times and rooms, repeating every week until the last day.';
        goEl.innerHTML = goLabel;
      } else {
        noteTx.textContent = t('noTimes', rtl);
        goEl.innerHTML = window.AAUP_ICONS.preview('clock', 15) + esc(t('addTimes', rtl));
      }
    }
    semEl.addEventListener('change', function(){ fillUsual(); refreshNote(); });
    fillUsual();
    refreshNote();

    document.getElementById('icsCancel').addEventListener('click', function(){
      overlay.classList.remove('open');
    });
    document.getElementById('icsGo').addEventListener('click', function(){
      if(goEl.getAttribute('data-need-times') === '1'){
        // On top of this sheet, not instead of it: closing a window and
        // opening another in the same tap lets the back-button handling
        // (js/60-backbar.js) close the new one too. Back here, the note and
        // button update to the times just added.
        if(!window.AAUP_TIMETABLE) return;
        window.AAUP_TIMETABLE.open(prefix);
        var tt = document.getElementById('ttOverlay');
        if(tt) new MutationObserver(function(l, o){
          if(tt.classList.contains('open')) return;
          o.disconnect(); refreshNote();
        }).observe(tt, { attributes: true, attributeFilter: ['class'] });
        return;
      }
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
