// ==========================
// ONE BOX FOR EVERYTHING (round 8, idea 14) and THE PLAN AS A SPREADSHEET
// (idea 18).
//
// Ctrl+K (⌘K on a Mac) opens a box anywhere in the app. Type what you want:
// a screen ("grades", "my week"), a course ("calc 2"), a professor, a major,
// or an action ("edit mode", "excel", "undo"). Enter does it. For a course in
// your own plan it offers Open and Mark passed right there. It is the Home
// search underneath (js/90-task-home.js), so the two always agree, with the
// app's actions added. The "/" key still goes to Home's own search.
//
// Send this plan → As a spreadsheet saves an .xlsx file: every course with
// its year, semester, hours, category, status and grade, in the app's
// language. Written here without a library: an .xlsx is a zip of a few small
// XML files, stored uncompressed.
// ==========================
(function(){
  'use strict';

  function ar(){ return !!(window.AAUP_LANG && window.AAUP_LANG.isAr()); }
  function L(en, a){ return ar() ? a : en; }
  function esc(s){ return window.__escapeHtml ? window.__escapeHtml(String(s == null ? '' : s)) : String(s); }
  var decoder = document.createElement('textarea');
  function plain(s){ decoder.innerHTML = String(s == null ? '' : s); return decoder.value; }
  function norm(s){ return plain(s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function plans(){ return window.AAUP_IMPORTED ? window.AAUP_IMPORTED.loadImportedPlans() : {}; }
  function selectedPlan(){
    var host = document.getElementById('importedPlanView');
    var page = host && host.style.display !== 'none' ? host.querySelector('.sheet-plan[id^="page-"]') : null;
    if(page) return page.id.slice(5);
    return window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.selected ? window.AAUP_TASK_HOME.selected() : null;
  }
  function editingPage(){ return document.querySelector('.sheet-plan.editing[id^="page-"]'); }
  function pid(planId, slug){ return window.AAUP_GPA && window.AAUP_GPA.primaryId ? window.AAUP_GPA.primaryId(planId, slug) : planId + '-c-' + slug; }
  function isDone(planId, slug){ var pr = window.__getProgress ? window.__getProgress() : {}; return !!pr[pid(planId, slug)]; }
  function isMac(){ return /Mac|iPhone|iPad/.test(navigator.platform || ''); }
  function modKey(){ return isMac() ? '⌘' : 'Ctrl'; }

  // ---- the app's own actions ----------------------------------------------------
  function openPlan(id){ if(id && window.AAUP_DASHBOARD) window.AAUP_DASHBOARD.openStudyPlan(id); }
  var ACTIONS = [
    { en: 'Edit Mode', ar: 'وضع التعديل', words: 'edit change move تعديل عدل', key: 'E', plan: true,
      run: function(id){
        var page = document.getElementById('page-' + id);
        var host = document.getElementById('importedPlanView');
        if(!page || !host || host.style.display === 'none') openPlan(id);
        setTimeout(function(){ if(window.AAUP_IMPORTED) window.AAUP_IMPORTED.toggleEdit(id); }, 60);
      } },
    { en: 'My Plan', ar: 'خطتي', words: 'plan courses خطة مواد', plan: true, run: openPlan },
    { en: 'Grades and GPA', ar: 'العلامات والمعدل', words: 'grades gpa average علامات معدل', plan: true,
      run: function(id){ openPlan(id); if(window.AAUP_AUDIT) window.AAUP_AUDIT.open(id); } },
    { en: 'My Week', ar: 'أسبوعي', words: 'week class times timetable أسبوع محاضرات', plan: true,
      run: function(id){ if(window.AAUP_TIMETABLE) window.AAUP_TIMETABLE.open(id); } },
    { en: 'Save my plan as a spreadsheet (Excel)', ar: 'احفظ خطتي كجدول (Excel)', words: 'excel xlsx spreadsheet export csv sheet جدول اكسل', plan: true,
      run: function(id){ exportXlsx(id); } },
    { en: 'Present my plan on a big screen', ar: 'اعرض خطتي على شاشة كبيرة', words: 'present projector big screen slides عرض شاشة بروجكتر', plan: true,
      run: function(id){ if(window.AAUP_STAFF) window.AAUP_STAFF.present(id); } },
    { en: 'Undo the last change', ar: 'تراجع عن آخر تغيير', words: 'undo تراجع', key: modKey() + ' Z', when: function(){ return !!editingPage(); },
      run: function(){ if(window.AAUP_EDIT_POWER) window.AAUP_EDIT_POWER.undo(); } },
    { en: 'Browse Courses beside the plan', ar: 'تصفّح المساقات جنب الخطة', words: 'browse library courses تصفح مكتبة', when: function(){ return !!editingPage(); },
      run: function(){ if(window.AAUP_EDIT_POWER) window.AAUP_EDIT_POWER.openPanel(); } },
    { en: 'Fold or open the sidebar', ar: 'صغّر أو كبّر القائمة', words: 'sidebar fold menu قائمة', when: function(){ return !!document.getElementById('sbFoldBtn'); },
      run: function(){ var b = document.getElementById('sbFoldBtn'); if(b) b.click(); } },
    { en: 'Home', ar: 'الرئيسية', words: 'home start رئيسية', run: function(){ if(window.AAUP_TASK_HOME) window.AAUP_TASK_HOME.show(); } },
    { en: 'Settings', ar: 'الإعدادات', words: 'settings preferences theme إعدادات', run: function(){ if(window.AAUP_SIDEBAR) window.AAUP_SIDEBAR.openSettings(); } },
    { en: 'Switch to العربية', ar: 'Switch to English', words: 'language arabic english لغة عربي انجليزي', run: function(){ if(window.AAUP_LANG) window.AAUP_LANG.toggle(); } },
    { en: 'Keyboard shortcuts', ar: 'اختصارات لوحة المفاتيح', words: 'keyboard shortcuts keys اختصارات', key: '?',
      run: function(){ if(window.AAUP_SHORTCUTS) window.AAUP_SHORTCUTS.openHelp(); } }
  ];
  function actionHits(q, id){
    return ACTIONS.filter(function(a){
      if(a.plan && !id) return false;
      if(a.when && !a.when()) return false;
      if(!q) return true;
      var hay = norm(a.en + ' ' + a.ar + ' ' + a.words);
      return q.split(' ').every(function(w){ return hay.indexOf(w) !== -1; });
    });
  }

  // ---- the box ---------------------------------------------------------------------
  var box = null, rows = [], at = 0;
  function build(){
    box = document.createElement('div');
    box.className = 'cmdk';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<div class="cmdk-card">' +
      '<input class="cmdk-in" type="text" role="combobox" aria-expanded="true" aria-controls="cmdkList" aria-autocomplete="list" autocomplete="off" spellcheck="false">' +
      '<div class="cmdk-list" id="cmdkList" role="listbox"></div>' +
      '<div class="cmdk-foot"></div></div>';
    document.body.appendChild(box);
    var input = box.querySelector('.cmdk-in');
    input.addEventListener('input', function(){ at = 0; draw(input.value); });
    input.addEventListener('keydown', function(e){
      if(e.key === 'ArrowDown'){ e.preventDefault(); move(1); }
      else if(e.key === 'ArrowUp'){ e.preventDefault(); move(-1); }
      else if(e.key === 'Enter'){ e.preventDefault(); run(at); }
      else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
    });
    box.addEventListener('mousedown', function(e){ if(e.target === box) close(); });
    box.querySelector('.cmdk-list').addEventListener('click', function(e){
      var r = e.target.closest('[data-cmdk]');
      if(r) run(+r.getAttribute('data-cmdk'));
    });
    box.querySelector('.cmdk-list').addEventListener('mousemove', function(e){
      var r = e.target.closest('[data-cmdk]');
      if(r && +r.getAttribute('data-cmdk') !== at){ at = +r.getAttribute('data-cmdk'); paintActive(); }
    });
  }
  var backTo = null;
  function open(){
    if(!box) build();
    backTo = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    box.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    box.setAttribute('aria-label', L('Search and actions', 'بحث وأوامر'));
    var input = box.querySelector('.cmdk-in');
    input.placeholder = L('Type a course, a screen or an action…', 'اكتب مساق، شاشة أو أمر…');
    input.setAttribute('aria-label', input.placeholder);
    box.querySelector('.cmdk-foot').innerHTML =
      '<span><kbd>↑</kbd><kbd>↓</kbd> ' + esc(L('choose', 'اختار')) + '</span>' +
      '<span><kbd>Enter</kbd> ' + esc(L('do it', 'نفّذ')) + '</span>' +
      '<span><kbd>Esc</kbd> ' + esc(L('close', 'سكّر')) + '</span>';
    box.classList.add('open');
    input.value = '';
    at = 0;
    draw('');
    input.focus();
  }
  // Focus goes back where it was, so the page's own keys (?, /, E, arrows)
  // work again straight away.
  function close(){
    if(!box) return;
    box.classList.remove('open');
    var inp = box.querySelector('.cmdk-in');
    if(document.activeElement === inp){
      if(backTo && document.contains(backTo) && backTo.focus) backTo.focus({ preventScroll: true });
      else inp.blur();
    }
    backTo = null;
  }
  function isOpen(){ return !!(box && box.classList.contains('open')); }

  function draw(raw){

    var q = norm(raw), id = selectedPlan();
    rows = [];
    var groups = [];
    var add = function(title, list){ if(list.length) groups.push({ title: title, list: list }); };

    var acts = actionHits(q, id).map(function(a){
      return { title: L(a.en, a.ar), key: a.key, run: function(){ a.run(id); } };
    });

    var found = q && window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.search ? window.AAUP_TASK_HOME.search(raw) : { answer: null, results: [] };
    if(found.answer){
      add(L('Answer', 'الجواب'), [{ title: found.answer.label + ': ' + found.answer.big, sub: found.answer.sub,
        run: function(){ window.AAUP_TASK_HOME.runResult('f:' + found.answer.go, raw); } }]);
    }
    // Courses in your own plan get the two things you'd do with them.
    var courseRows = [], otherRows = [];
    found.results.forEach(function(r){
      var code = r.go;
      if(code.indexOf('c:') === 0){
        var val = code.slice(2), bar = val.indexOf('|'), page = val.slice(0, bar), slug = val.slice(bar + 1);
        if(courseRows.length >= 12) return;
        courseRows.push({ title: r.title, sub: r.sub, run: function(){ window.AAUP_TASK_HOME.runResult(code, raw); } });
        // Only when it can be ticked: a locked course can't be (the app
        // refuses until its prerequisites are passed), so it isn't offered.
        var locked = window.AAUP_COURSE_DETAIL && window.AAUP_COURSE_DETAIL.status && window.AAUP_COURSE_DETAIL.status(page, slug) === 'locked';
        if(page === id && courseRows.length <= 6 && !locked){
          var done = isDone(page, slug);
          courseRows.push({ title: done ? L('Mark "' + r.title + '" not passed', 'علّم «' + r.title + '» مش ناجح') : L('Mark "' + r.title + '" passed', 'علّم «' + r.title + '» ناجح'),
            sub: '', indent: true,
            run: function(){
              if(window.AAUP_IMPORTED && window.AAUP_IMPORTED.toggle){ window.AAUP_IMPORTED.toggle(page, slug); }
              if(window.AAUP_TASK_HOME && window.AAUP_TASK_HOME.visible && window.AAUP_TASK_HOME.visible()) window.AAUP_TASK_HOME.render();
            } });
        }
      } else if(otherRows.length < 8){
        otherRows.push({ title: r.title, sub: r.sub, run: function(){ window.AAUP_TASK_HOME.runResult(code, raw); } });
      }
    });
    // What you can do comes first when it matches: "edit" should mean Edit
    // Mode before it means a course with "edit" somewhere in its name.
    if(q){ add(L('Do', 'أوامر'), acts); add(L('Courses', 'مساقات'), courseRows); add(L('More results', 'نتائج تانية'), otherRows); }
    else add(L('Do', 'أوامر'), acts);
    if(q){
      add('', [{ title: L('Ask AAUPath: “' + raw.trim() + '”', 'اسأل AAUPath: «' + raw.trim() + '»'), ask: true,
        run: function(){ window.AAUP_TASK_HOME.runResult('ask', raw); } }]);
    }

    var html = '';
    groups.forEach(function(g){
      if(g.title) html += '<div class="cmdk-h">' + esc(g.title) + '</div>';
      g.list.forEach(function(r){
        var i = rows.length;
        rows.push(r);
        html += '<div class="cmdk-row' + (r.indent ? ' is-sub' : '') + (r.ask ? ' is-ask' : '') + '" role="option" id="cmdk-' + i + '" data-cmdk="' + i + '">' +
          '<span class="cmdk-t"><b>' + esc(r.title) + '</b>' + (r.sub ? '<span>' + esc(r.sub) + '</span>' : '') + '</span>' +
          (r.key ? '<kbd>' + esc(r.key) + '</kbd>' : '') + '</div>';
      });
    });
    var list = box.querySelector('.cmdk-list');
    list.innerHTML = html || '<p class="cmdk-none">' + esc(L('Nothing matches that.', 'ما في إشي بهالاسم.')) + '</p>';
    if(at >= rows.length) at = 0;
    paintActive();
  }
  function paintActive(){
    var input = box.querySelector('.cmdk-in');
    [].forEach.call(box.querySelectorAll('.cmdk-row'), function(el){
      var on = +el.getAttribute('data-cmdk') === at;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if(on){ input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    });
  }
  function move(step){ if(!rows.length) return; at = (at + step + rows.length) % rows.length; paintActive(); }
  function run(i){
    var r = rows[i];
    if(!r) return;
    close();
    setTimeout(function(){ try{ r.run(); }catch(e){ if(window.console) console.error('Ctrl+K:', e); } }, 0);
  }

  document.addEventListener('keydown', function(e){
    if((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')){
      e.preventDefault();
      if(isOpen()) close(); else open();
    }
  });

  // ---- 18 · the plan as an .xlsx ----------------------------------------------------
  var CRC = (function(){
    var t = [];
    for(var n = 0; n < 256; n++){
      var c = n;
      for(var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes){
    var c = 0xFFFFFFFF;
    for(var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files){
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var u16 = function(v){ return [v & 255, (v >>> 8) & 255]; };
    var u32 = function(v){ return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function(f){
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(33), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), common));
      parts.push(local, name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var cdSize = central.reduce(function(n, p){ return n + p.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  // Control characters aren't allowed in the sheet's XML at all.
  function noCtl(s){ return Array.prototype.filter.call(s, function(ch){ var c = ch.charCodeAt(0); return c > 31 || c === 9 || c === 10 || c === 13; }).join(''); }
  function xml(s){ return noCtl(String(s == null ? '' : s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function colName(i){ var s = ''; i++; while(i > 0){ var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(table, rtl){
    var body = table.map(function(row, r){
      return '<row r="' + (r + 1) + '">' + row.map(function(v, c){
        var ref = colName(c) + (r + 1);
        var style = r === 0 ? ' s="1"' : '';
        if(typeof v === 'number') return '<c r="' + ref + '"' + style + '><v>' + v + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('');
    var widths = [8, 16, 40, 30, 8, 22, 14, 8];
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"' + (rtl ? ' rightToLeft="1"' : '') + '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + widths.map(function(w, i){ return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' +
      '<sheetData>' + body + '</sheetData></worksheet>';
  }
  var CAT = {
    en: { skills: 'Skills', core: 'Core', math: 'Math', dept: 'Department', eng: 'English', uni: 'University', free: 'Free elective' },
    ar: { skills: 'مهارات', core: 'إجباري', math: 'رياضيات', dept: 'تخصص', eng: 'إنجليزي', uni: 'متطلب جامعة', free: 'متطلب حر' }
  };
  function exportXlsx(planId){
    var p = plans()[planId];
    if(!p){ if(window.__showToast) window.__showToast(L('Open a plan first.', 'افتح خطة أول.')); return; }
    var rtl = ar();
    var grades = window.AAUP_GPA ? window.AAUP_GPA.loadGrades() : {};
    var statuses = window.AAUP_GPA ? window.AAUP_GPA.loadStatuses() : {};
    var years = (p.structure && p.structure.years) || [];
    var yearNo = {};
    years.forEach(function(y, i){ yearNo[y.id] = i + 1; });
    var semNo = { s1: 1, s2: 2, s3: 3 };
    var semTx = { s1: L('First', 'الأول'), s2: L('Second', 'الثاني'), s3: L('Summer', 'الصيفي') };
    var head = rtl
      ? ['السنة', 'الفصل', 'المساق', 'الاسم الآخر', 'الساعات', 'التصنيف', 'الحالة', 'العلامة']
      : ['Year', 'Semester', 'Course', 'Other name', 'Hours', 'Category', 'Status', 'Grade'];
    var list = (p.courses || []).slice().sort(function(a, b){
      return ((yearNo[a.yearId] || 99) - (yearNo[b.yearId] || 99)) || ((semNo[a.semester] || 9) - (semNo[b.semester] || 9));
    });
    var table = [head].concat(list.map(function(c){
      var k = pid(planId, c.id), done = isDone(planId, c.id);
      var st = done ? L('Passed', 'ناجح') : statuses[k] === 'in_progress' ? L('In progress', 'قيد الدراسة') : statuses[k] === 'planned' ? L('Planned', 'مخطط') : L('Not started', 'ما بلّش');
      var g = grades[k] ? (window.AAUP_GPA.gradeShort ? window.AAUP_GPA.gradeShort(grades[k]) : grades[k]) : '';
      return [
        yearNo[c.yearId] || '', semTx[c.semester] || '',
        plain(rtl && c.ar ? c.ar : c.name), plain(rtl ? c.name : (c.ar || '')),
        parseFloat(c.creditHours) || 0, (CAT[rtl ? 'ar' : 'en'][c.category] || c.category || ''), st, g
      ];
    }));
    var mn = p.majorName || {}, pick = typeof mn === 'string' ? mn : ((rtl && mn.ar) || mn.en || '');
    if(pick && typeof pick === 'object') pick = [pick.big, pick.small].filter(Boolean).join(' ');
    var title = plain(pick) || planId;
    var blob = zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xml(L('My plan', 'خطتي')) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml(table, rtl) }
    ]);
    var file = (title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'plan') + '.xlsx';
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    if(window.__showToast) window.__showToast(L('Saved "' + file + '"', 'انحفظ «' + file + '»'));
  }

  window.AAUP_COMMAND = { open: open, close: close };
  window.AAUP_EXPORT = { xlsx: exportXlsx };
})();
