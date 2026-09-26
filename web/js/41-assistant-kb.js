// ==========================
// ASSISTANT KNOWLEDGE BASE
// ==========================
// Everything the in-app assistant is allowed to say about the app itself,
// in English and Arabic. Content only — the matching and answering logic
// lives in js/42-assistant.js, and the chat window in js/43-assistant-ui.js.
//
// This file is the reason the assistant cannot make things up. It is not a
// language model and has no training data: it can only return a topic
// written here, or a fact read live out of the app's own state (the plan
// registry, the prerequisite graph, the student's progress). A question
// that matches neither gets the "not part of this website" answer rather
// than a guess. That is a deliberate trade — a smaller assistant that is
// always right about this app beats a bigger one that is confidently wrong
// about a student's degree.
//
// ADDING A TOPIC: append an entry below. `tags` are the words a student
// might actually type (both languages, including common misspellings and
// the Arabic term students really use). `body` is a list of short lines —
// they render as bullets. `guide` optionally names a walkthrough in GUIDES
// so the answer can offer "show me" instead of only describing it.
(function () {

  // ---------------------------------------------------------------
  // GUIDED MODE WALKTHROUGHS
  // ---------------------------------------------------------------
  // Each step points at a real element that must be on screen. `target`
  // returns the element (or null — a step whose target is missing is
  // skipped rather than stalling the walkthrough). `waitFor` makes the step
  // interactive: the walkthrough waits for the student to actually do the
  // thing before offering the next step, instead of racing ahead.
  function q(sel) { return function () { return document.querySelector(sel); }; }

  // Several controls exist in more than one place — Settings is a sidebar
  // item inside a plan, a ☰ menu button on a phone, and a footer link on the
  // plan picker — and only one of them is on screen at a time. Picking the
  // first that EXISTS would return a hidden one and the step would be
  // skipped as unreachable, so pick the first that is actually visible.
  function firstVisible(selectors) {
    return function () {
      for (var i = 0; i < selectors.length; i++) {
        var found = document.querySelector(selectors[i]);
        if (found && found.offsetParent !== null) return found;
      }
      return null;
    };
  }

  function visiblePlanRoot() {
    var candidates = document.querySelectorAll('.plan-page, #importedPlanView');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].offsetParent !== null) return candidates[i];
    }
    return null;
  }
  function inPlan(sel) {
    return function () {
      var root = visiblePlanRoot();
      return root ? root.querySelector(sel) : null;
    };
  }
  // Visible, not merely present. The app keeps whole screens in the DOM with
  // display:none — the study-plan view is built and hidden the moment a plan
  // is opened from the Dashboard — so `querySelector` alone answers "is this
  // on screen?" with a confident, wrong yes.
  function shown(sel) {
    var el = document.querySelector(sel);
    return !!(el && el.offsetParent !== null);
  }

  function sheetOpen() {
    var el = document.getElementById('hmSheetOverlay');
    return !!(el && el.classList.contains('open'));
  }

  function homeVisible() {
    var home = document.getElementById('home');
    return !!(home && home.offsetParent !== null);
  }

  var GUIDES = {
    findPlan: {
      title: { en: 'Finding your study plan', ar: 'الوصول إلى خطتك الدراسية' },
      steps: [
        { target: q('#taskHome .hm-search'),
          text: { en: 'Know your major already? Type its name here — it finds it straight away.',
                  ar: 'تعرف تخصصك؟ اكتب اسمه هنا — بيلاقيه على طول.' } },
        { target: q('#taskHome .hm-card[data-hm-go="plan"]'),
          text: { en: 'Otherwise tap here to pick it from the list.',
                  ar: 'أو اضغط هنا واختاره من القائمة.' },
          waitFor: sheetOpen },
        { target: q('#hmSheetList [data-hm-college]'),
          text: { en: 'First your college — the faculty your major belongs to.',
                  ar: 'أولًا كليتك — الكلية اللي بينتمي إلها تخصصك.' },
          waitFor: function () { return !!document.querySelector('#hmSheetList [data-hm-major]'); } },
        { target: q('#hmSheetList [data-hm-major]'),
          text: { en: 'And then your major. That opens your plan, and AAUPath remembers it.',
                  ar: 'وبعدين تخصصك. هيك بتفتح خطتك، وAAUPath بيتذكرها.' } }
      ]
    },
    settings: {
      title: { en: 'Opening Settings', ar: 'فتح الإعدادات' },
      steps: [
        { target: firstVisible(['.sb-item[data-sb-key="settings"]', '#sbToggleBtn', '[onclick*="openSettings"]']),
          text: { en: 'Settings lives here — theme, language, backup, accounts.',
                  ar: 'الإعدادات هنا — السمة واللغة والنسخ الاحتياطي والحسابات.' },
          waitFor: function () { return !!document.querySelector('#devModalOverlay.open'); } },
        { target: q('#setThemeBtn'),
          text: { en: 'That is the settings panel. Everything below is inside it.',
                  ar: 'هذه هي لوحة الإعدادات. كل ما يلي موجود بداخلها.' } }
      ]
    },
    backup: {
      title: { en: 'Backing up your progress', ar: 'حفظ نسخة من تقدّمك' },
      steps: [
        { target: firstVisible(['.sb-item[data-sb-key="settings"]', '#sbToggleBtn', '[onclick*="openSettings"]']),
          text: { en: 'Open Settings first.', ar: 'افتح الإعدادات أولًا.' },
          waitFor: function () { return !!document.querySelector('#devModalOverlay.open'); } },
        { target: q('#setExportBtn'),
          text: { en: 'Save a backup writes a file with everything you have checked off. Keep it somewhere safe — it is the only copy besides this browser.',
                  ar: '«احفظ نسخة» يحفظ ملفًا بكل ما أنجزته. احتفظ به في مكان آمن — فهو النسخة الوحيدة غير هذا المتصفح.' } },
        { target: q('#setImportBtn'),
          text: { en: 'And Restore from file brings it back later, on any device.',
                  ar: 'و«استرجع من ملف» يستعيده لاحقًا على أي جهاز.' } }
      ]
    },
    markCourse: {
      title: { en: 'Marking a course completed', ar: 'تعليم مساق كمكتمل' },
      steps: [
        { target: firstVisible(['.sb-item[data-sb-key="studyplan"]']),
          text: { en: 'Open My Study Plan.', ar: 'افتح «خطتي الدراسية».' },
          optional: true,
          waitFor: function () { return !!visiblePlanRoot(); } },
        { target: inPlan('.course[id] .course-check, .course[id] input[type="checkbox"]'),
          text: { en: 'Tick a course’s box once you have passed it. Progress, GPA, and what unlocks next all update from this.',
                  ar: 'ضع علامة في مربع المساق بعد اجتيازه. يتحدّث التقدّم والمعدّل والمساقات التي تُفتح بناءً على ذلك.' } }
      ]
    },
    gpa: {
      title: { en: 'Entering a grade for your GPA', ar: 'إدخال علامة لحساب المعدّل' },
      steps: [
        { target: inPlan('.course[id]'),
          text: { en: 'Tap the course you want to grade — not the checkbox, the card itself.',
                  ar: 'اضغط على المساق الذي تريد إدخال علامته — على البطاقة نفسها لا على المربع.' },
          waitFor: function () {
            var fp = document.getElementById('floatPopup');
            return !!(fp && fp.style.display !== 'none') || !!document.querySelector('.modal-overlay.open');
          } },
        { target: firstVisible(['#floatPopupBody select', '#floatPopupBody input',
                                '#impCourseModalBody select', '#impCourseModalBody input']),
          text: { en: 'Enter your grade here. Your GPA on the Dashboard recalculates immediately.',
                  ar: 'أدخل علامتك هنا. سيُعاد حساب معدّلك في لوحة التحكم فورًا.' } }
      ]
    },
    nextSemester: {
      title: { en: 'Planning your next semester', ar: 'التخطيط للفصل القادم' },
      steps: [
        { target: inPlan('.ynx'),
          text: { en: 'Under "You are here" the plan suggests what to take next, ranked by what each course unlocks. "Plan the whole semester" opens the full picker.',
                  ar: 'تحت «أنت هنا» بتقترح الخطة شو تاخد بعدين، مرتّب حسب اللي بيفتحه كل مساق. و«خطط الفصل كامل» بيفتح الشاشة الكاملة.' } }
      ]
    },
    audit: {
      title: { en: 'Checking graduation requirements', ar: 'مراجعة متطلبات التخرّج' },
      steps: [
        { target: q('.sb-item[data-sb-key="audit"]'),
          text: { en: 'Degree Audit & GPA breaks your degree into categories and shows how many hours are left in each.',
                  ar: '«التدقيق الأكاديمي والمعدّل» يقسم درجتك إلى فئات ويعرض الساعات المتبقية في كل فئة.' } }
      ]
    },
    achievements: {
      title: { en: 'Finding your achievements', ar: 'الوصول إلى إنجازاتك' },
      steps: [
        { target: q('.sb-item[data-sb-key="achievements"]'),
          text: { en: 'Every achievement, locked and unlocked, is here.',
                  ar: 'كل الإنجازات، المفتوحة والمقفلة، موجودة هنا.' } }
      ]
    },
    searchCourse: {
      title: { en: 'Finding a course', ar: 'البحث عن مساق' },
      steps: [
        { target: inPlan('.course-search-wrap .search-box'),
          text: { en: 'Search by course name or course number — it scrolls straight to it.',
                  ar: 'ابحث باسم المساق أو رقمه — سينتقل إليه مباشرة.' } }
      ]
    },
    legend: {
      title: { en: 'What the colours mean', ar: 'معاني الألوان' },
      steps: [
        { target: inPlan('.legend'),
          text: { en: 'One swatch per requirement this degree counts — university, college, specialization, elective. Every card takes its colour from the requirement it satisfies.',
                  ar: 'مربّع لكل متطلب تحسبه الخطة — جامعة، كلية، تخصص، اختياري. ولون كل بطاقة يتبع المتطلب الذي تحققه.' } }
      ]
    },
    newPlan: {
      title: { en: 'Creating your own plan', ar: 'إنشاء خطة خاصة بك' },
      steps: [
        { target: q('#taskHome .hm-card[data-hm-go="plan"]'),
          text: { en: 'Open the list of majors from here.',
                  ar: 'افتح قائمة التخصصات من هون.' },
          waitFor: sheetOpen },
        { target: q('[data-hm-newplan]'),
          text: { en: 'If your major is not listed, build it here — years, semesters, courses, prerequisites.',
                  ar: 'إذا تخصصك مش موجود، ابنيه من هون — السنوات والفصول والمساقات والمتطلبات.' } }
      ]
    },
    switchPlan: {
      title: { en: 'Changing plan', ar: 'تغيير الخطة' },
      steps: [
        { target: q('.sb-item[data-sb-key="switch"]'),
          text: { en: 'Change plan asks which: move to another major (and see what carries over), or just open another of your plans. Nothing is lost either way.',
                  ar: '«تغيير الخطة» بيسأل أي واحدة: تنتقل لتخصص ثاني (وتشوف شو بينحسب إلك)، أو تفتح خطة ثانية عندك. ما بضيع إشي بالحالتين.' } }
      ]
    },
    menu: {
      title: { en: 'Opening the menu', ar: 'فتح القائمة' },
      steps: [
        { target: q('#sbToggleBtn'),
          text: { en: 'On a phone the menu hides behind this button — Dashboard, Study Plan, Audit, and Advanced for the rest.',
                  ar: 'على الهاتف تختفي القائمة خلف هذا الزر — لوحة التحكم والخطة والتدقيق والإنجازات والإعدادات.' } }
      ]
    },
    addCourse: {
      title: { en: 'Adding a course', ar: 'إضافة مساق' },
      steps: [
        { target: firstVisible(['.sb-item[data-sb-key="studyplan"]']),
          text: { en: 'First open your study plan — courses are added there.',
                  ar: 'افتح خطتك الدراسية أولًا — تُضاف المساقات من هناك.' },
          optional: true,
          waitFor: function () { return shown('#importedPlanView .home-btn[onclick*="toggleEdit"]'); } },
        { target: firstVisible(['#importedPlanView .home-btn[onclick*="toggleEdit"]:not(.imp-exit-edit-btn)']),
          text: { en: 'Turn on Edit Mode. Everything you change is yours and saves as you go.',
                  ar: 'فعّل «وضع التعديل». كل ما تغيّره يخصّك ويُحفظ تلقائيًا.' },
          optional: true,
          waitFor: function () { return shown('#importedPlanView .imp-add-course-card'); } },
        { target: firstVisible(['#importedPlanView .imp-add-course-card']),
          text: { en: 'Now tap + in any semester — name, credit hours, category, even prerequisites. Try it.',
                  ar: 'الآن اضغط + في أي فصل — الاسم والساعات والفئة وحتى المتطلبات السابقة. جرّب.' } },
        { target: firstVisible(['#importedPlanView .home-btn[onclick*="openLibrary"]']),
          text: { en: 'Or skip the typing: Browse Courses copies a course straight from another plan.',
                  ar: 'أو تجنّب الكتابة: «تصفّح المساقات» تنسخ مساقًا جاهزًا من خطة أخرى.' } }
      ]
    },
    editPlan: {
      title: { en: 'Editing your plan', ar: 'تعديل خطتك' },
      steps: [
        { target: firstVisible(['.sb-item[data-sb-key="studyplan"]']),
          text: { en: 'Open your study plan first.', ar: 'افتح خطتك الدراسية أولًا.' },
          optional: true,
          waitFor: function () { return shown('#importedPlanView .home-btn[onclick*="toggleEdit"]'); } },
        { target: firstVisible(['#importedPlanView .home-btn[onclick*="toggleEdit"]:not(.imp-exit-edit-btn)']),
          text: { en: 'Turn on Edit Mode — nothing is shared with anyone unless you Export or Contribute it.',
                  ar: 'فعّل «وضع التعديل» — لا يُشارك شيء مع أحد إلا إذا صدّرته أو ساهمت به.' },
          optional: true,
          waitFor: function () { return shown('#importedPlanView .imp-add-course-card'); } },
        { target: firstVisible(['#importedPlanView .imp-add-course-card']),
          text: { en: '+ adds a course to that semester.', ar: '«+» يضيف مساقًا إلى ذلك الفصل.' } },
        { target: firstVisible(['#importedPlanView .imp-edit-course-btn']),
          text: { en: 'The pencil fixes a course’s name, hours, or category.',
                  ar: 'القلم يعدّل اسم المساق أو ساعاته أو فئته.' } },
        { target: firstVisible(['#importedPlanView .imp-remove-course-btn']),
          text: { en: 'The ✕ removes it — you always get an "are you sure" first.',
                  ar: '«✕» يحذفه — ويُسألك دائمًا للتأكيد أولًا.' } },
        { target: firstVisible(['#importedPlanView .imp-exit-edit-btn']),
          text: { en: 'Tap here when you’re done. There is nothing to save — it already has been.',
                  ar: 'اضغط هنا عند الانتهاء. لا شيء لحفظه — فقد حُفظ بالفعل.' } }
      ]
    },
    fix: {
      title: { en: 'Using the Fix button', ar: 'استخدام زر الإصلاح' },
      steps: [
        { target: q('#fixLauncher'),
          text: { en: 'This button is always here. It checks the app and your saved data for problems and repairs what it safely can.',
                  ar: 'هذا الزر موجود دائمًا. يفحص التطبيق وبياناتك المحفوظة بحثًا عن مشاكل ويصلح ما يمكن إصلاحه بأمان.' } }
      ]
    }
  };

  // ---------------------------------------------------------------
  // TOPICS
  // ---------------------------------------------------------------
  var TOPICS = [
    {
      id: 'start',
      tags: { en: ['start', 'begin', 'how to use', 'new here', 'getting started', 'first time', 'what is this', 'what can you do', 'help'],
              ar: ['ابدأ', 'كيف استخدم', 'جديد', 'البداية', 'مساعدة', 'شو هذا', 'ايش هذا'] },
      title: { en: 'Getting started', ar: 'البداية' },
      body: {
        en: ['The home screen asks what you need: search anything, or tap one of the cards.',
             'The first time something needs your major, you pick it once — your college, then your major.',
             'Tick off courses you have already passed — your GPA, progress and everything else update from that.'],
        ar: ['الشاشة الرئيسية بتسألك شو بدك: دوّر على أي إشي، أو اضغط وحدة من البطاقات.',
             'أول مرة بتحتاج ميزة تخصصك، بتختاره مرة وحدة — كليتك، بعدين تخصصك.',
             'علّم المساقات اللي خلّصتها — معدلك وتقدّمك وكل إشي تاني بيتحدّث منها.']
      },
      guide: 'findPlan'
    },
    {
      id: 'universities',
      tags: { en: ['university', 'universities', 'school', 'college', 'faculty', 'which universities', 'aaup', 'birzeit'],
              ar: ['جامعة', 'جامعات', 'كلية', 'كليات'] },
      title: { en: 'Universities and colleges', ar: 'الجامعات والكليات' },
      body: {
        en: ['Majors are listed by college: pick your college, then your major.',
             'Only the universities loaded in this app are available — I list the exact ones if you ask "what universities are there".'],
        ar: ['التخصصات مرتبة حسب الكلية: اختر كليتك، ثم تخصصك.',
             'تتوفر فقط الجامعات المحمّلة في هذا التطبيق — اسألني «ما الجامعات المتوفرة» لأعرضها لك.']
      },
      guide: 'findPlan'
    },
    {
      id: 'dashboard',
      tags: { en: ['dashboard', 'degree progress', 'overview screen'],
              ar: ['لوحة', 'تقدمي الدراسي', 'لوحة التحكم'] },
      title: { en: 'The Dashboard', ar: 'لوحة التحكم' },
      body: {
        en: ['Your plan\'s summary — "Degree Progress" on the home screen opens it.',
             'Progress: completed credit hours out of your degree total.',
             'GPA: calculated from the grades you have entered.',
             'Achievements and "What can I take next" are one tap away.'],
        ar: ['ملخّص خطتك — «تقدّمي الدراسي» في الشاشة الرئيسية بيفتحه.',
             'التقدّم: الساعات المعتمدة المنجزة من إجمالي درجتك.',
             'المعدّل: يُحسب من العلامات التي أدخلتها.',
             'الإنجازات و«ما الذي يمكنني أخذه» على بعد ضغطة واحدة.']
      }
    },
    {
      id: 'menu',
      tags: { en: ['menu', 'sidebar', 'navigation', 'navigate', 'where is the menu', 'buttons on the side', 'go home', 'back to home', 'main menu'],
              ar: ['قائمة', 'الشريط الجانبي', 'تنقل'] },
      title: { en: 'The menu', ar: 'القائمة' },
      body: {
        en: ['Home is at the top, and so is the plan’s name: both take you back to “What do you need?”.',
             'Then everything about your plan: Edit Mode · Dashboard · My Study Plan · Degree Audit & GPA · My Schedule · Achievements · Send this plan.',
             'Advanced holds the rest: Student Thoughts, Find a Professor, Browse Courses and About.',
             'At the bottom: Settings and Change plan.',
             'On a phone it is behind the menu button in the corner.'],
        ar: ['«الرئيسية» في الأعلى، واسم الخطة كمان: الاثنين بيرجعوك لـ«شو بدك؟».',
             'بعدها كل ما يخص خطتك: وضع التعديل · لوحة التحكم · خطتي الدراسية · التدقيق والمعدّل · جدولي · الإنجازات · إرسال هذه الخطة.',
             'وتحت «متقدم» الباقي: أفكار الطلبة وابحث عن محاضر وتصفّح المساقات وعن التطبيق.',
             'في الأسفل: الإعدادات وتغيير الخطة.',
             'على الهاتف تجدها خلف زر القائمة في الزاوية.']
      },
      guide: 'menu'
    },
    {
      id: 'studyplan',
      tags: { en: ['study plan', 'plan page', 'course map', 'years', 'semesters', 'semester', 'my plan'],
              ar: ['خطة', 'الخطة الدراسية', 'خريطة المساقات', 'سنوات', 'فصول', 'فصل'] },
      title: { en: 'The study plan page', ar: 'صفحة الخطة الدراسية' },
      body: {
        en: ['Your whole degree laid out year by year, semester by semester.',
             'Each box is a course. Arrows between them are prerequisites.',
             'Summer semesters appear only where the plan actually has them.'],
        ar: ['درجتك كاملة موزّعة سنة بسنة وفصلًا بفصل.',
             'كل مربع هو مساق. والأسهم بينها هي المتطلبات السابقة.',
             'الفصول الصيفية تظهر فقط حيث تحتويها الخطة فعلًا.']
      }
    },
    {
      id: 'prerequisites',
      tags: { en: ['prerequisite', 'prerequisites', 'prereq', 'requires', 'arrows', 'lines', 'before i can take', 'depends'],
              ar: ['متطلب', 'متطلبات', 'متطلب سابق', 'اسهم', 'أسهم', 'خطوط'] },
      title: { en: 'Prerequisites', ar: 'المتطلبات السابقة' },
      body: {
        en: ['An arrow from A to B means you must pass A before taking B.',
             'Press and hold a course (or hover it on a computer) to light up everything it needs and everything it unlocks.',
             'Ask me "what does <course> need" or "why is <course> locked" for a specific course.'],
        ar: ['السهم من (أ) إلى (ب) يعني أن عليك اجتياز (أ) قبل أخذ (ب).',
             'اضغط مطوّلًا على مساق (أو مرّر فوقه على الحاسوب) لإضاءة ما يحتاجه وما يفتحه.',
             'اسألني «ما متطلبات <المساق>» أو «لماذا <المساق> مقفل» لمساق محدد.']
      }
    },
    {
      id: 'locked',
      tags: { en: ['locked', 'lock', 'why cant i take', 'greyed', 'gray', 'not available', 'blocked', 'cant take'],
              ar: ['مقفل', 'مغلق', 'لماذا لا استطيع', 'غير متاح', 'مو متاح'] },
      title: { en: 'Locked courses', ar: 'المساقات المقفلة' },
      body: {
        en: ['A course is locked while any of its prerequisites is still unchecked.',
             'Some courses also need a minimum number of completed credit hours.',
             'Ask "why is <course> locked" and I will list exactly what is missing.'],
        ar: ['يبقى المساق مقفلًا ما دام أي من متطلباته السابقة غير مكتمل.',
             'بعض المساقات تحتاج أيضًا حدًا أدنى من الساعات المعتمدة المنجزة.',
             'اسأل «لماذا <المساق> مقفل» وسأذكر لك بالضبط ما الناقص.']
      }
    },
    {
      id: 'available',
      tags: { en: ['available', 'what can i take', 'next semester', 'register', 'unlocked', 'can take now', 'eligible'],
              ar: ['متاح', 'ماذا اخذ', 'الفصل القادم', 'تسجيل', 'مفتوح'] },
      title: { en: 'Available courses', ar: 'المساقات المتاحة' },
      body: {
        en: ['A course turns Available the moment every prerequisite is checked off.',
             '"What Can I Take Next" on the Dashboard lists them all.',
             'The plan itself suggests the next semester under "You are here", ranked by what each course unlocks; "Plan the whole semester" there builds a full 15–18 hour load.'],
        ar: ['يصبح المساق «متاحًا» فور اكتمال كل متطلباته السابقة.',
             '«ما الذي يمكنني أخذه» في لوحة التحكم يعرضها كلها.',
             '«خطّط لفصلي القادم» يذهب أبعد ويبني حملًا من 15–18 ساعة، مفضّلًا المساقات التي تفتح أكبر عدد من المساقات اللاحقة.']
      },
      guide: 'nextSemester'
    },
    {
      id: 'completed',
      tags: { en: ['complete', 'completed', 'mark', 'check off', 'checkbox', 'tick', 'passed', 'finished course', 'done'],
              ar: ['مكتمل', 'انجزت', 'أنجزت', 'تعليم', 'مربع', 'نجحت', 'خلصت'] },
      title: { en: 'Marking courses completed', ar: 'تعليم المساقات كمكتملة' },
      body: {
        en: ['Tick the small box on a course card once you have passed it.',
             'That single tick drives progress, unlocking, achievements, and the audit.',
             'A course you took but failed should be marked with an F grade — it then counts as taken, but not as passed.'],
        ar: ['ضع علامة في المربع الصغير على بطاقة المساق بعد اجتيازه.',
             'هذه العلامة وحدها تحرّك التقدّم وفتح المساقات والإنجازات والتدقيق.',
             'المساق الذي أخذته ورسبت فيه يُسجَّل بعلامة F — عندها يُحتسب كمأخوذ لا كمُجتاز.']
      },
      guide: 'markCourse'
    },
    {
      id: 'gpa',
      tags: { en: ['gpa', 'grade', 'grades', 'average', 'points', 'gpa calculator', 'calculate gpa', 'my gpa'],
              ar: ['معدل', 'المعدّل', 'علامة', 'علامات', 'درجات', 'حساب المعدل'] },
      title: { en: 'The GPA calculator', ar: 'حاسبة المعدّل' },
      body: {
        en: ['Open a course, enter your grade, and your GPA updates everywhere at once.',
             'GPA = sum of (grade points × credit hours) ÷ sum of credit hours, over graded courses only.',
             'Courses with no grade entered are simply not counted — they do not drag your average down.'],
        ar: ['افتح مساقًا وأدخل علامتك، فيتحدّث معدّلك في كل مكان فورًا.',
             'المعدّل = مجموع (نقاط العلامة × الساعات المعتمدة) ÷ مجموع الساعات، للمساقات المُقيَّمة فقط.',
             'المساقات بلا علامة لا تُحتسب أصلًا — ولا تخفض معدّلك.']
      },
      guide: 'gpa'
    },
    {
      id: 'assessments',
      tags: { en: ['assessment', 'assessments', 'midterm', 'final', 'quiz', 'marks', 'breakdown', 'exam'],
              ar: ['تقييم', 'تقييمات', 'نصفي', 'نهائي', 'امتحان', 'علامات المساق'] },
      title: { en: 'Assessment marks', ar: 'علامات التقييم' },
      body: {
        en: ['Instead of typing one final number, you can enter each piece: midterm, final, coursework, and so on.',
             'The app adds them up, converts the total to a letter using your plan’s own grading scale, and feeds that into your GPA.',
             'Leave it alone and nothing changes — it is optional detail, not a requirement.'],
        ar: ['بدل كتابة رقم نهائي واحد، يمكنك إدخال كل جزء: النصفي والنهائي وأعمال الفصل وغيرها.',
             'يجمعها التطبيق ويحوّل المجموع إلى علامة حرفية وفق سلّم العلامات الخاص بخطتك، ثم يدخلها في معدّلك.',
             'إن تركتها فلن يتغيّر شيء — فهي تفصيل اختياري لا إلزامي.']
      }
    },
    {
      id: 'gradingscale',
      tags: { en: ['grading scale', 'pass mark', 'passing', 'scale', '50', '60', 'letter grade', 'a b c d f'],
              ar: ['سلم العلامات', 'علامة النجاح', 'النجاح', 'سلّم'] },
      title: { en: 'Grading scales', ar: 'سلالم العلامات' },
      body: {
        en: ['Each plan carries its own grading scale — the pass mark and the letter bands are not the same everywhere.',
             'The app uses whichever scale the plan you opened actually ships with; nothing is hardcoded to one faculty.',
             'Ask "what is the pass mark for my plan" and I will read it out of your current plan.'],
        ar: ['كل خطة تحمل سلّم علاماتها الخاص — علامة النجاح ونطاقات الحروف ليست واحدة في كل مكان.',
             'يستخدم التطبيق السلّم المرفق بالخطة التي فتحتها؛ لا شيء مثبّت لكلية واحدة.',
             'اسأل «ما علامة النجاح في خطتي» وسأقرأها من خطتك الحالية.']
      }
    },
    {
      id: 'audit',
      tags: { en: ['audit', 'degree audit', 'graduate', 'graduation', 'requirements', 'left to graduate', 'remaining', 'how many hours left'],
              ar: ['تدقيق', 'تخرج', 'التخرّج', 'متطلبات التخرج', 'كم باقي', 'المتبقي'] },
      title: { en: 'Degree Audit', ar: 'التدقيق الأكاديمي' },
      body: {
        en: ['Breaks your degree into its categories — core, department electives, university requirements, free electives — and shows completed vs required hours in each.',
             'That is the fastest answer to "how much is actually left".',
             'Some plans do not have their official total credit hours confirmed yet; when that is the case the app says so instead of inventing a number.'],
        ar: ['يقسّم درجتك إلى فئاتها — إجباري، اختياري تخصص، متطلبات جامعة، اختياري حر — ويعرض المنجز مقابل المطلوب في كل فئة.',
             'هذه أسرع إجابة عن «كم تبقّى فعلًا».',
             'بعض الخطط لم يُثبَّت مجموع ساعاتها الرسمي بعد؛ وعندها يقول التطبيق ذلك بدل اختراع رقم.']
      },
      guide: 'audit'
    },
    {
      id: 'credits',
      tags: { en: ['credit', 'credits', 'credit hours', 'hours', 'how many hours'],
              ar: ['ساعة', 'ساعات', 'ساعات معتمدة'] },
      title: { en: 'Credit hours', ar: 'الساعات المعتمدة' },
      body: {
        en: ['Every course carries a credit-hour value, shown on its card and used for progress, GPA weighting, and the audit.',
             'A typical full semester is 15–18 hours — that is the range the next-semester suggestions aim for.'],
        ar: ['لكل مساق قيمة بالساعات المعتمدة تظهر على بطاقته وتُستخدم في التقدّم ووزن المعدّل والتدقيق.',
             'الفصل الكامل المعتاد 15–18 ساعة — وهو النطاق الذي يستهدفه «خطّط لفصلي القادم».']
      }
    },
    {
      id: 'electives',
      tags: { en: ['elective', 'electives', 'free elective', 'university elective', 'optional course', 'choose course'],
              ar: ['اختياري', 'اختيارية', 'اختياري حر', 'متطلب جامعة اختياري'] },
      title: { en: 'Electives', ar: 'المساقات الاختيارية' },
      body: {
        en: ['Elective slots are placeholders — you choose what fills them.',
             'Open an elective slot and pick from the list; the app remembers your choice and counts its hours.',
             'University elective pools are per-university, so the list you see belongs to your own school.'],
        ar: ['خانات الاختياري هي أماكن فارغة — أنت تختار ما يملؤها.',
             'افتح خانة اختيارية واختر من القائمة؛ سيحفظ التطبيق اختيارك ويحتسب ساعاته.',
             'قوائم المتطلبات الاختيارية خاصة بكل جامعة، فما تراه يخصّ جامعتك أنت.']
      }
    },
    {
      id: 'legend',
      tags: { en: ['legend', 'colors', 'colours', 'what does the color mean', 'category', 'categories'],
              ar: ['مفتاح', 'الوان', 'ألوان', 'فئة', 'فئات'] },
      title: { en: 'Course colours', ar: 'ألوان المساقات' },
      body: {
        en: ['Each colour is a category: core, maths, department elective, university requirement, university elective, free elective, English.',
             'The legend on the plan page spells out every one — tap it to expand on a phone.'],
        ar: ['كل لون يمثّل فئة: إجباري، رياضيات، اختياري تخصص، متطلب جامعة، اختياري جامعة، اختياري حر، إنجليزي.',
             'مفتاح الألوان في صفحة الخطة يوضّحها كلها — اضغط عليه لتوسيعه على الهاتف.']
      },
      guide: 'legend'
    },
    {
      id: 'search',
      tags: { en: ['search', 'find', 'look for', 'cant find', 'where is course', 'find course'],
              ar: ['بحث', 'ابحث', 'دور', 'وين', 'اين'] },
      title: { en: 'Search', ar: 'البحث' },
      body: {
        en: ['On the home screen: one box finds features, professors, courses and majors.',
             'Inside a plan: search for a course by name or course number — it scrolls straight to it and highlights it.',
             'You can also just ask me here, in either language.'],
        ar: ['في الشاشة الرئيسية: مربّع واحد بيلاقي الميزات والمحاضرين والمساقات والتخصصات.',
             'داخل الخطة: ابحث عن مساق بالاسم أو رقم المساق — سينتقل إليه ويبرزه.',
             'أو اسألني هنا مباشرة بأي من اللغتين.']
      },
      guide: 'searchCourse'
    },
    {
      id: 'achievements',
      tags: { en: ['achievement', 'achievements', 'badge', 'badges', 'trophy', 'rewards', 'unlock badge'],
              ar: ['انجاز', 'إنجاز', 'إنجازات', 'انجازات', 'شارة', 'جوائز'] },
      title: { en: 'Achievements', ar: 'الإنجازات' },
      body: {
        en: ['Small milestones that unlock as you progress — first course, a finished year, a full semester, and so on.',
             'They are generated from whatever plan you actually opened, so every major has a working set.',
             'Locked ones show what you still need.'],
        ar: ['محطات صغيرة تُفتح مع تقدّمك — أول مساق، سنة مكتملة، فصل كامل، وغيرها.',
             'تُولَّد من الخطة التي فتحتها فعلًا، فلكل تخصص مجموعته.',
             'المقفلة منها تعرض ما ينقصك للوصول إليها.']
      },
      guide: 'achievements'
    },
    {
      id: 'stats',
      tags: { en: ['statistics', 'stats', 'progress', 'percent', 'percentage', 'how far', 'my progress'],
              ar: ['احصائيات', 'إحصائيات', 'تقدم', 'التقدّم', 'نسبة', 'وين وصلت'] },
      title: { en: 'Progress and statistics', ar: 'التقدّم والإحصائيات' },
      body: {
        en: ['The My Progress panel counts completed courses and credit hours, and shows your percentage.',
             'It only ever counts courses you have actually checked off — nothing is estimated.',
             'Ask me "how am I doing" for the numbers from your current plan.'],
        ar: ['لوحة «تقدّمي» تحسب المساقات والساعات المنجزة وتعرض نسبتك المئوية.',
             'تحتسب فقط ما وضعت عليه علامة فعلًا — لا تقدير ولا تخمين.',
             'اسألني «كيف تقدّمي» لأعرض أرقام خطتك الحالية.']
      }
    },
    {
      id: 'retakes',
      tags: { en: ['retake', 'retakes', 'repeat', 'failed', 'fail', 'f grade', 'take again'],
              ar: ['اعادة', 'إعادة', 'رسبت', 'راسب', 'اعيد'] },
      title: { en: 'Retakes', ar: 'إعادة المساقات' },
      body: {
        en: ['Give a course an F and the app offers to schedule a retake in a later semester.',
             'The retake is what counts from then on — the failed attempt stops counting toward completed hours, so nothing is double-counted.'],
        ar: ['أعطِ المساق علامة F وسيعرض التطبيق جدولة إعادة له في فصل لاحق.',
             'الإعادة هي ما يُحتسب بعد ذلك — والمحاولة الراسبة تتوقف عن احتساب ساعاتها، فلا ازدواج في العد.']
      }
    },
    {
      id: 'notes',
      tags: { en: ['note', 'notes', 'rating', 'difficulty', 'hard', 'workload', 'personal'],
              ar: ['ملاحظة', 'ملاحظات', 'تقييم', 'صعوبة', 'صعب'] },
      title: { en: 'Notes and difficulty ratings', ar: 'الملاحظات وتقييم الصعوبة' },
      body: {
        en: ['You can leave yourself a note on any course and rate how hard it was.',
             'Those ratings are private to you, and "Plan My Next Semester" uses them to warn you when a suggested load looks heavy for your own history.'],
        ar: ['يمكنك ترك ملاحظة على أي مساق وتقييم صعوبته.',
             'هذه التقييمات خاصة بك، ويستخدمها «خطّط لفصلي القادم» لتحذيرك عندما يبدو الحمل المقترح ثقيلًا وفق تجربتك أنت.']
      }
    },
    {
      id: 'export',
      tags: { en: ['export', 'import', 'backup', 'restore', 'save', 'transfer', 'another phone', 'new phone', 'lose data',
                   'export my progress', 'import my progress', 'backup my progress', 'save my progress'],
              ar: ['تصدير', 'استيراد', 'نسخة احتياطية', 'استعادة', 'حفظ', 'جهاز اخر', 'تصدير تقدمي', 'حفظ تقدمي'] },
      title: { en: 'Backup, export and import', ar: 'النسخ الاحتياطي والتصدير والاستيراد' },
      body: {
        en: ['Settings → My data → Backup → Save a backup writes a file containing everything you have saved.',
             'Restore from file, in the same box, reads it back — that is how you move to a new phone.',
             'Your data lives only in this browser, so this file is the only backup that exists.'],
        ar: ['الإعدادات ← بياناتي ← نسخة احتياطية ← «احفظ نسخة» يكتب ملفًا يحوي كل ما حفظته.',
             'و«استرجع من ملف» بنفس المربع يعيد قراءته — وهكذا تنتقل إلى هاتف جديد.',
             'بياناتك موجودة في هذا المتصفح فقط، لذا هذا الملف هو النسخة الاحتياطية الوحيدة.']
      },
      guide: 'backup'
    },
    {
      id: 'reset',
      tags: { en: ['reset', 'delete all', 'clear', 'erase', 'start over', 'wipe',
                   'reset my progress', 'clear my progress', 'delete my progress'],
              ar: ['مسح', 'حذف الكل', 'تصفير', 'البدء من جديد', 'مسح تقدمي'] },
      title: { en: 'Resetting your data', ar: 'مسح بياناتك' },
      body: {
        en: ['Settings → My data → Danger zone → Reset all data clears progress, grades, notes, and your own plans on this device. It asks you to type RESET first.',
             'It cannot be undone, so export a backup first.',
             'To clear just one plan’s progress, use that plan’s own reset instead of this.'],
        ar: ['الإعدادات ← بياناتي ← منطقة الخطر ← «مسح كل البيانات» يمسح التقدّم والعلامات والملاحظات وخططك على هذا الجهاز. بيطلب منك تكتب RESET أولًا.',
             'لا يمكن التراجع عنه، فصدّر نسخة احتياطية أولًا.',
             'لمسح تقدّم خطة واحدة فقط، استخدم زر التصفير الخاص بتلك الخطة.']
      }
    },
    {
      id: 'accounts',
      tags: { en: ['account', 'accounts', 'profile', 'profiles', 'switch user', 'two people', 'share device'],
              ar: ['حساب', 'حسابات', 'ملف شخصي', 'مستخدم'] },
      title: { en: 'Accounts on this device', ar: 'الحسابات على هذا الجهاز' },
      body: {
        en: ['Each account keeps its own plans, progress, and GPA, all on this device.',
             'Useful when a device is shared, or for a second profile of your own.',
             'These are local profiles, not online accounts — there is no login and no password.'],
        ar: ['كل حساب يحتفظ بخططه وتقدّمه ومعدّله بشكل منفصل على هذا الجهاز.',
             'مفيد عند مشاركة الجهاز، أو لملف شخصي ثانٍ لك.',
             'هذه ملفات محلية لا حسابات على الإنترنت — لا تسجيل دخول ولا كلمة مرور.']
      }
    },
    {
      id: 'settings',
      tags: { en: ['settings', 'setting', 'options', 'preferences', 'configure', 'gear', 'where is settings'],
              ar: ['اعدادات', 'إعدادات', 'خيارات', 'ضبط', 'تفضيلات'] },
      title: { en: 'Settings', ar: 'الإعدادات' },
      body: {
        en: ['Theme, language, backup and restore, accounts, and the walkthrough tours all live in Settings.',
             'From inside a plan it is at the bottom of the menu; from the plan picker it is the ⚙️ link in the footer.'],
        ar: ['السمة واللغة والنسخ الاحتياطي والاستعادة والحسابات والجولات التعريفية كلها في الإعدادات.',
             'من داخل خطة تجدها أسفل القائمة؛ ومن شاشة اختيار الخطط هي رابط ⚙️ في الأسفل.']
      },
      guide: 'settings'
    },
    {
      id: 'theme',
      tags: { en: ['theme', 'dark', 'light', 'night mode', 'color mode', 'bright'],
              ar: ['سمة', 'ليلي', 'داكن', 'فاتح', 'الوضع الليلي'] },
      title: { en: 'Dark and light mode', ar: 'الوضع الداكن والفاتح' },
      body: {
        en: ['Settings → Toggle Theme switches between dark and light.',
             'Your choice is remembered on this device.'],
        ar: ['الإعدادات ← «تبديل السمة» ينتقل بين الداكن والفاتح.',
             'يُحفظ اختيارك على هذا الجهاز.']
      },
      guide: 'settings'
    },
    {
      id: 'language',
      tags: { en: ['language', 'arabic', 'english', 'translate', 'rtl', 'change language'],
              ar: ['لغة', 'عربي', 'انجليزي', 'إنجليزي', 'تغيير اللغة'] },
      title: { en: 'English and Arabic', ar: 'الإنجليزية والعربية' },
      body: {
        en: ['Every plan page has a language toggle, and Settings has one too.',
             'Arabic flips the whole layout to right-to-left, not just the words.',
             'You can talk to me in either language — I answer in the one you used.'],
        ar: ['كل صفحة خطة فيها زر لتبديل اللغة، وكذلك الإعدادات.',
             'العربية تقلب التخطيط كاملًا من اليمين إلى اليسار، لا الكلمات فقط.',
             'يمكنك محادثتي بأي من اللغتين — وأجيبك باللغة التي كتبت بها.']
      },
      guide: 'settings'
    },
    {
      id: 'offline',
      tags: { en: ['offline', 'internet', 'no connection', 'wifi', 'data', 'install', 'app', 'home screen', 'pwa'],
              ar: ['بدون انترنت', 'أوفلاين', 'اتصال', 'تثبيت', 'تطبيق'] },
      title: { en: 'Working offline', ar: 'العمل بدون إنترنت' },
      body: {
        en: ['After your first visit the whole app — every plan, every page — is stored on your device and works with no connection at all.',
             'You can install it to your home screen from your browser menu and use it like a normal app.',
             'I work offline too: I am part of the app, not a service on the internet.'],
        ar: ['بعد أول زيارة يُخزَّن التطبيق كاملًا — كل خطة وكل صفحة — على جهازك ويعمل دون أي اتصال.',
             'يمكنك تثبيته على الشاشة الرئيسية من قائمة المتصفح واستخدامه كتطبيق عادي.',
             'وأنا أعمل بدون إنترنت أيضًا: أنا جزء من التطبيق لا خدمة على الإنترنت.']
      }
    },
    {
      id: 'privacy',
      tags: { en: ['privacy', 'private', 'data safe', 'who sees', 'upload', 'server', 'personal data', 'secure'],
              ar: ['خصوصية', 'بياناتي', 'امان', 'أمان', 'من يرى'] },
      title: { en: 'Your data and privacy', ar: 'بياناتك وخصوصيتك' },
      body: {
        en: ['Progress, grades, notes, and your name stay in this browser. They are never uploaded.',
             'Nothing you type to me leaves your device either.',
             'The one thing that can go online is a study plan you build yourself — its structure only (courses, years, prerequisites), never your progress, grades, or name.'],
        ar: ['التقدّم والعلامات والملاحظات واسمك تبقى في هذا المتصفح ولا تُرفع أبدًا.',
             'ولا يغادر جهازك أي شيء تكتبه لي.',
             'الشيء الوحيد الذي قد يُرسل هو خطة دراسية تبنيها بنفسك — هيكلها فقط (المساقات والسنوات والمتطلبات)، لا تقدّمك ولا علاماتك ولا اسمك.']
      }
    },
    {
      id: 'newplan',
      tags: { en: ['create plan', 'new plan', 'my major is missing', 'add my major', 'not listed', 'build plan', 'make plan'],
              ar: ['انشاء خطة', 'إنشاء خطة', 'خطة جديدة', 'تخصصي غير موجود', 'اضافة تخصص'] },
      title: { en: 'Creating your own plan', ar: 'إنشاء خطة خاصة بك' },
      body: {
        en: ['If your major is not listed, use "+ New Plan" on the plans screen and build it yourself.',
             'You add years, semesters, courses, credit hours, and prerequisite lines.',
             'It behaves exactly like a built-in plan afterwards — progress, GPA, achievements, all of it.'],
        ar: ['إذا لم يكن تخصصك مدرجًا، استخدم «+ خطة جديدة» في شاشة الخطط وابنِها بنفسك.',
             'تضيف السنوات والفصول والمساقات والساعات وخطوط المتطلبات.',
             'وتعمل بعدها تمامًا كأي خطة أصلية — تقدّم ومعدّل وإنجازات وكل شيء.']
      },
      guide: 'newPlan'
    },
    {
      id: 'editplan',
      tags: { en: ['edit', 'edit mode', 'change plan', 'add course', 'remove course', 'move course', 'wrong course', 'fix my plan', 'add year', 'summer'],
              ar: ['تعديل', 'تحرير', 'اضافة مساق', 'حذف مساق', 'نقل مساق', 'اضافة سنة'] },
      title: { en: 'Editing a plan', ar: 'تعديل خطة' },
      body: {
        en: ['On a plan you created, Edit Mode lets you add, remove, and drag courses between semesters, and add or remove years and summer terms.',
             'Moving a course before something it needs (or after something that needs it) is rejected — the prerequisite order is protected.',
             'On official plans you can still correct a wrong prerequisite arrow; your correction is kept on your device, layered on top, and reversible.'],
        ar: ['في خطة أنشأتها، يتيح «وضع التعديل» إضافة المساقات وحذفها وسحبها بين الفصول، وإضافة السنوات والفصول الصيفية أو حذفها.',
             'نقل مساق قبل ما يحتاجه (أو بعد ما يحتاجه) مرفوض — فترتيب المتطلبات محمي.',
             'وفي الخطط الرسمية يمكنك تصحيح سهم متطلب خاطئ؛ ويُحفظ تصحيحك على جهازك فوق الخطة الأصلية، وقابل للتراجع.']
      }
    },
    {
      id: 'overview',
      tags: { en: ['print', 'pdf', 'overview', 'paper', 'export plan', 'printable'],
              ar: ['طباعة', 'عرض', 'ورقة'] },
      title: { en: 'Overview and print', ar: 'العرض والطباعة' },
      body: {
        en: ['Share this plan has a Print button: it gives a clean one-page version of your whole plan.',
             'From there your browser can print it or save it as a PDF.'],
        ar: ['في «شارك هذه الخطة» زر طباعة: بيعطيك نسخة نظيفة من خطتك كاملة في صفحة واحدة.',
             'ومن هناك يمكن لمتصفحك طباعتها أو حفظها كملف PDF.']
      }
    },
    {
      id: 'update',
      tags: { en: ['update', 'new version', 'refresh', 'version', 'old data', 'outdated'],
              ar: ['تحديث', 'نسخة جديدة', 'اصدار', 'إصدار'] },
      title: { en: 'Updates', ar: 'التحديثات' },
      body: {
        en: ['When a newer version of the app has downloaded, a bar appears at the top — tap Refresh to switch to it.',
             'Updated official plans replace the copy you have, but anything you personally edited is never overwritten.'],
        ar: ['عند تنزيل نسخة أحدث من التطبيق يظهر شريط في الأعلى — اضغط «تحديث» للانتقال إليها.',
             'الخطط الرسمية المحدَّثة تحلّ محل نسختك، أما ما عدّلته بنفسك فلا يُستبدل أبدًا.']
      }
    },
    {
      id: 'pending',
      tags: { en: ['coming soon', 'empty plan', 'no courses', 'plan is empty', 'greyed out plan'],
              ar: ['قريبا', 'قريبًا', 'خطة فارغة', 'لا يوجد مساقات'] },
      title: { en: '"Coming soon" plans', ar: 'خطط «قريبًا»' },
      body: {
        en: ['Some majors are listed but their courses have not been entered yet — those cards are dimmed and marked coming soon.',
             'They are shown rather than hidden so you can see the major exists and is on the way.'],
        ar: ['بعض التخصصات مدرجة لكن مساقاتها لم تُدخل بعد — وبطاقاتها باهتة ومعلَّمة بـ«قريبًا».',
             'تُعرض ولا تُخفى لتعرف أن التخصص موجود وفي الطريق.']
      }
    },
    {
      id: 'accuracy',
      tags: { en: ['wrong', 'mistake', 'incorrect', 'official', 'accurate', 'trust', 'is this right', 'error in plan'],
              ar: ['خطأ', 'غلط', 'رسمي', 'دقيق', 'موثوق'] },
      title: { en: 'How accurate is this?', ar: 'ما مدى دقة هذا؟' },
      body: {
        en: ['This is an unofficial student project. The plans are transcribed by hand from university documents.',
             'Always confirm with your academic advisor before you register.',
             'If you spot a wrong prerequisite you can correct it yourself on your device — see "editing a plan".'],
        ar: ['هذا مشروع طلابي غير رسمي، والخطط منسوخة يدويًا من وثائق الجامعة.',
             'تأكّد دائمًا من مرشدك الأكاديمي قبل التسجيل.',
             'وإذا لاحظت متطلبًا خاطئًا يمكنك تصحيحه بنفسك على جهازك — انظر «تعديل خطة».']
      }
    },
    {
      id: 'fixbutton',
      tags: { en: ['fix', 'fix button', 'broken', 'not working', 'bug', 'glitch', 'repair', 'diagnose', 'something wrong'],
              ar: ['اصلاح', 'إصلاح', 'خلل', 'لا يعمل', 'مشكلة', 'عطل'] },
      title: { en: 'The Fix button', ar: 'زر الإصلاح' },
      body: {
        en: ['The 🛠 button in the bottom-left corner is always there.',
             'It scans the app and your saved data for problems, explains each one in plain language, and repairs the ones it can do safely.',
             'Every repair is backed up first and can be undone.'],
        ar: ['زر 🛠 في الزاوية السفلية اليسرى موجود دائمًا.',
             'يفحص التطبيق وبياناتك المحفوظة بحثًا عن مشاكل، ويشرح كلًا منها بلغة بسيطة، ويصلح ما يمكن إصلاحه بأمان.',
             'كل إصلاح تُحفظ نسخة احتياطية قبله ويمكن التراجع عنه.']
      },
      guide: 'fix'
    },
    {
      id: 'assistant',
      tags: { en: ['who are you', 'what are you', 'are you ai', 'chatbot', 'bot', 'assistant', 'chatgpt'],
              ar: ['من انت', 'مين انت', 'شو انت', 'مساعد', 'روبوت'] },
      title: { en: 'About me', ar: 'عنّي' },
      body: {
        en: ['I am this website’s built-in assistant. I only know this app: its universities, plans, courses, prerequisites, and features.',
             'I run entirely on your device — offline, free, and nothing you type is sent anywhere.',
             'I never guess. If something is not in this website, I say so rather than making it up.'],
        ar: ['أنا المساعد المدمج في هذا الموقع. لا أعرف سوى هذا التطبيق: جامعاته وخططه ومساقاته ومتطلباته وميزاته.',
             'أعمل بالكامل على جهازك — بدون إنترنت، ومجانًا، ولا يُرسل أي شيء تكتبه إلى أي مكان.',
             'ولا أخمّن أبدًا. فإن لم يكن الشيء موجودًا في هذا الموقع أقول ذلك بدل اختلاقه.']
      }
    }
  ];

  // ---------------------------------------------------------------
  // OUT OF SCOPE
  // ---------------------------------------------------------------
  // Subjects the assistant declines outright, even when a word in the
  // question happens to match a topic. Matched on whole words so that
  // "art" never trips "heart" and "war" never trips "toward".
  var OUT_OF_SCOPE = {
    en: ['politics', 'political', 'election', 'president', 'government', 'war', 'army', 'israel', 'palestine',
         'religion', 'religious', 'islam', 'christian', 'jewish', 'quran', 'bible', 'pray', 'prayer', 'god', 'haram', 'halal',
         'country', 'countries', 'capital', 'capital city', 'geography', 'continent', 'history', 'historical', 'century',
         'wifi password', 'password of', 'phone number', 'address of',
         'medical advice', 'diagnose me', 'symptom', 'symptoms', 'disease', 'medicine dose', 'doctor', 'illness', 'pregnant',
         'legal advice', 'lawyer', 'lawsuit', 'sue', 'court',
         'invest', 'investment', 'stock', 'stocks', 'crypto', 'bitcoin', 'salary', 'loan', 'money advice',
         'sex', 'sexual', 'porn', 'dating', 'girlfriend', 'boyfriend', 'nude',
         'news', 'weather', 'football', 'movie', 'song', 'recipe', 'joke', 'poem', 'story',
         'python', 'javascript code', 'write code', 'java', 'c++', 'sql', 'html tutorial', 'hack',
         'your opinion', 'what do you think about', 'do you like', 'who is better'],
    ar: ['سياسة', 'سياسي', 'انتخابات', 'رئيس', 'حكومة', 'حرب', 'جيش', 'اسرائيل', 'فلسطين',
         'دين', 'ديني', 'اسلام', 'إسلام', 'مسيحي', 'يهودي', 'قران', 'قرآن', 'انجيل', 'صلاة', 'حرام', 'حلال',
         'دولة', 'دول', 'عاصمة', 'جغرافيا', 'تاريخ',
         'طبي', 'مرض', 'دواء', 'طبيب', 'اعراض', 'أعراض', 'حامل',
         'قانوني', 'محامي', 'محكمة', 'قضية',
         'استثمار', 'اسهم', 'أسهم', 'عملة', 'بيتكوين', 'راتب', 'قرض',
         'جنس', 'جنسي', 'حب', 'صديقة', 'اباحي',
         'اخبار', 'أخبار', 'طقس', 'كرة قدم', 'فيلم', 'اغنية', 'أغنية', 'وصفة', 'نكتة', 'قصيدة',
         'برمجة', 'كود', 'بايثون', 'جافا', 'اختراق',
         'رايك', 'رأيك', 'شو رايك', 'من افضل']
  };

  // ---------------------------------------------------------------
  // FIXED REPLIES
  // ---------------------------------------------------------------
  var SAY = {
    outOfScope: {
      en: 'I’m designed only to help with this Study Plan website.',
      ar: 'أنا مصمَّم لمساعدتك في موقع الخطط الدراسية هذا فقط.'
    },
    notHere: {
      en: 'I don’t have that information because it isn’t part of this website.',
      ar: 'لا أملك هذه المعلومة لأنها ليست جزءًا من هذا الموقع.'
    },
    secret: {
      en: 'I can’t share how I’m set up internally — but ask me anything about this website and I’ll help.',
      ar: 'لا يمكنني مشاركة تفاصيل إعدادي الداخلية — لكن اسألني أي شيء عن هذا الموقع وسأساعدك.'
    },
    greeting: {
      en: 'Hi! I’m the Study Plan assistant. Ask me about your courses, prerequisites, GPA, or any button you can’t find.',
      ar: 'أهلًا! أنا مساعد الخطط الدراسية. اسألني عن مساقاتك أو متطلباتها أو معدّلك أو أي زر لا تجده.'
    },
    thanks: {
      en: 'Anytime. Ask me whenever something is unclear.',
      ar: 'دائمًا. اسألني في أي وقت يلتبس عليك شيء.'
    },
    noPlanOpen: {
      en: 'Open a study plan first and I can answer that from your own courses.',
      ar: 'افتح خطة دراسية أولًا لأتمكن من الإجابة من مساقاتك أنت.'
    },
    courseUnknown: {
      en: 'I can’t find a course by that name in the plan you have open.',
      ar: 'لا أجد مساقًا بهذا الاسم في الخطة المفتوحة لديك.'
    },
    guideOffer: { en: 'Show me', ar: 'أرني' },
    guideUnavailable: {
      en: 'That part of the app isn’t on screen right now, so I can’t point at it. Open your study plan and ask me again.',
      ar: 'هذا الجزء غير ظاهر على الشاشة الآن فلا أستطيع الإشارة إليه. افتح خطتك الدراسية ثم اسألني مجددًا.'
    }
  };

  window.AAUP_ASSISTANT_KB = { topics: TOPICS, guides: GUIDES, outOfScope: OUT_OF_SCOPE, say: SAY, homeVisible: homeVisible };
})();
