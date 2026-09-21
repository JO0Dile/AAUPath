<div align="center">

# 🎓 StudyPlan · خطتي الدراسية

**By students, for students — plan your degree, track your progress.**
**من الطلاب، إلى الطلاب — خطّط لدرجتك وتابع تقدّمك.**

Pick your university → college → study plan, then track every course,
prerequisite, and your GPA — in English or Arabic, on any phone.

### ▶️ **[Open the app](https://jo0dile.github.io/AAUPath/)**

</div>

---

## ✨ What it does

- **University → College → Plan** — browse each university's colleges and
  their full course maps. The app ships with **AAUP** alone, so what a student
  sees is one school done properly rather than three done partly. Other
  universities stay authored in `data/` and can be published by flipping one
  flag, or added from the Developer Panel on a single device.
- **Track your progress** — check off completed courses; your credit-hour
  progress and GPA update automatically.
- **See prerequisites at a glance** — every course shows what it needs and
  what it unlocks, honoring real AND/OR requirement groups (not a flattened
  guess).
- **GPA and assessment-marks breakdown** — driven by each university's own
  grading scale, not a hardcoded curve.
- **Achievements** — derived from whatever plan is actually loaded, so a
  newly added university gets a working set automatically.
- **Bilingual** — the whole interface flips between English and Arabic, with
  full right-to-left layout.
- **Edit mode** — fix a wrong prerequisite line or add a year/summer semester
  yourself; corrections are kept on your device and layered on top of the
  published plan, so they are always yours and always reversible.
- **💬 Built-in assistant** — ask it anything about the app: what a course
  needs, why one is locked, how the GPA is worked out, where a button is. Ask
  "how do I…" or "where is…" and it dims the page and points at the exact
  control, one step at a time. It can tick courses off and move you around the
  app too — always explaining a change first, and warning you if it clashes
  with a prerequisite. Nothing is ever saved without you tapping to confirm.
- **🛠 Fix button** — bottom-left, on every screen. Checks the app and your
  saved data, explains anything it finds in plain language, and repairs what
  it safely can. Every repair is backed up first and can be undone.
- **Your own edits are never overwritten** — if you have customised a plan and
  the official version later changes, the app does not silently replace your
  copy. It shows you exactly what changed and lets you decide whether to take
  it.

> ⚠️ **Unofficial student project — not affiliated with or endorsed by any
> university. Always confirm your plan with your academic advisor.**
> مشروع طلابي غير رسمي — تأكد دائمًا من خطتك مع مرشدك الأكاديمي.

---

## 🏗️ How it's built

```
StudyPlan/
├── web/        — the app itself. Open index.html and it runs: no build
│                 step, no framework, no server.
│   └── plans.json  — every university, college, and study plan, in one file
├── data/       — where plans are authored and reviewed, one file per major
├── tools/      — build-catalogue.py turns data/ into web/plans.json
├── collector/  — optional Worker that receives plans students choose to share
├── ai/         — optional Worker that powers the smart assistant
└── admin/      — optional Worker for maintaining the catalogue (see its README)
```

All three folders under `ai/`, `collector/` and `admin/` are optional. With none
of them deployed the app is exactly what it looks like: a static site that runs
offline and talks to nothing.

**There is no database.** Study plans are authored in `data/`, built into
`web/plans.json`, and served as static files. Admin Mode does not change that —
it commits to `data/` through a Worker that holds the GitHub token privately, CI
rebuilds the catalogue, and Pages redeploys. So `data/` stays the single source
of truth, every edit has an author and a message, and anything can be undone
with `git revert`.

**It works completely offline.** The app, its styles, all its modules, and the
entire study-plan catalogue are cached on your device the first time you open
it — after that it opens with no connection at all. Your progress, grades, and
notes are saved in `localStorage` and never leave your phone.

The only thing that ever goes online is **📨 Contribute**, if you choose to
share a study plan you built. Even then only the *plan* is sent — its courses,
years, and prerequisites — never your name, student ID, GPA, or grades.

**The assistant has two brains, and you choose which one.**

The **offline brain** ships with the app. No account, no key, no bill, and
nothing you type leaves your device. It answers from the app's own knowledge
base (`web/js/41-assistant-kb.js`) and from live state already in the page: the
plan registry, the prerequisite graph, your progress. It cannot invent a
prerequisite or a credit total, because it has nothing to invent from. It is
also limited — it recognises phrasing rather than understanding it, and says
"that isn't part of this website" for everything else.

The **smart brain** is a real language model, reached through a small Cloudflare
Worker (see [`ai/README.md`](ai/README.md) — three steps, nothing to edit
afterwards). It understands ordinary questions, answers naturally in English or
Arabic, and can drive the app for you. It runs entirely on free tiers — Gemini,
then Cloudflare Workers AI, then back to the offline brain when a daily quota
runs out — so it costs nothing and cannot start charging you.

If the Worker is not deployed, is deleted, or is simply down, the app notices
after a couple of tries and answers from the offline brain immediately instead
of waiting on it. Nothing to configure and nothing visibly breaks.

**It is off until you turn it on**, and the app asks once, in plain language,
before anything is ever sent. When it is on, a question sends: your question,
the plan you have open, its courses and prerequisites, which ones you have
completed, and your GPA number. It never sends your name, your student ID, your
individual grades, your assessment marks, or your notes. Turn it off and the
app goes back to sending nothing at all.

Every number the smart brain quotes — GPA, credit totals, what is unlocked,
which prerequisites are missing — is computed by the app's own code and handed
to it as fact. It explains; it does not do arithmetic on your degree. And it
cannot change your record: it can only propose a change, which you confirm.

---

## ➕ Adding or fixing a study plan

Plans are authored under `data/<university>/majors/<major>.json`, then built
into the single file the app reads:

```bash
python3 tools/build-catalogue.py    # writes web/plans.json
```

Commit both the `data/` change and the regenerated `web/plans.json`. That's the
whole process — there's no database to run and no server to deploy.

---

## 🛠 Checking the project

The 🛠 Fix button covers what only a running browser can see: real errors,
files missing from offline storage, damaged saved data, buttons wired to code
that isn't there. It can repair anything the app owns (saved data, the offline
cache) and reports everything else, because a browser cannot write to the files
it loaded.

The source-level half runs in CI on every push, with the free open-source
tools, and can also be run locally:

```bash
npx eslint                      # JavaScript: unreachable code, typos, duplicates
npx stylelint "web/css/*.css"   # CSS
npx htmlhint web/index.html     # markup
python3 tools/check-precache.py # does sw.js still save every file the page loads?
python3 tools/build-catalogue.py && git diff --exit-code web/plans.json
```

That last pair is this project's own consistency check: there is no build step,
so nothing otherwise notices when a new module is added to `index.html` but not
to the service worker's offline list — and the app then works perfectly right
up until someone opens it with no signal.

---

## 🗺️ Roadmap

- [x] University → College → Plan browsing, 23 AAUP plans across 4 faculties
- [x] Prerequisite graph, GPA engine, assessment breakdown, achievements
- [x] Full Arabic interface with right-to-left layout
- [x] Works offline; installable as an app
- [x] Per-major icons and university logos, replaceable without touching code
- [ ] Verify every plan against the official university PDFs
- [ ] Confirm official degree credit totals
- [ ] Accounts, so progress can follow a student across devices

---

## 📄 License

Copyright © 2026 **JO0Dile**. All Rights Reserved. See [LICENSE](LICENSE).
