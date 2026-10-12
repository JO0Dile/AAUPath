#!/usr/bin/env python3
"""Fill in the Arabic side of the catalogue, as a step inside the build.

WHY THIS IS A BUILD STEP AND NOT A SCRIPT YOU RUN ONCE
------------------------------------------------------
It used to be three scripts that edited web/plans.json in place. web/plans.json
is a build ARTIFACT — tools/build-catalogue.py generates it from data/ — so the
next person to run the build regenerated it from source and silently deleted
3,221 Arabic course names, 64 Arabic programme names and 68 Arabic plan
descriptions. Nothing failed; the app just quietly went back to English.

So the Arabic lives in data/ with the rest of the content, and build-catalogue.py
applies it on every build. A rebuild can no longer undo it.

WHERE THE ARABIC COMES FROM, IN ORDER OF AUTHORITY
--------------------------------------------------
1. The catalogue itself. Where a plan under data/aaup/majors/ already carries an
   Arabic name, that is the university's own wording and nothing here touches it.
2. Other plans in the same catalogue. The source names a course in Arabic in some
   plans and leaves it blank in others — "Community Service" is named in thirteen
   and blank in fifty-two — so the Arabic already present is copied across every
   row with the same English name. This invents nothing.
3. data/aaup/*-ar.json, hand-written. These are TRANSLATIONS of the English
   titles that were transcribed from the published catalogue, not copies of the
   university's own Arabic titles — that document is not in this repository.
   Treat them as the app's wording and check them before calling them official.

Anything with no Arabic from any of the three is left blank and reported, so the
gap stays visible rather than being papered over.
"""
import json
import pathlib
import re

DATA = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'aaup'

HOURS_LINE = re.compile(r'^(\d+(?:\.\d+)?) CH — (.+?)\.?$')
BIO_MARKERS = [
    'Semester order is a suggested prerequisite-valid sequence',
    'Year-by-year layout is the university’s published Advisory Plan',
    '\U0001f6a7 The department has not published an academic plan',
]


def _read(name):
    path = DATA / name
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


# ---------------------------------------------------------------- course names
def fill_course_names(plans, hand):
    """Rule 2 then rule 3. Returns (from_catalogue, from_map, still_missing)."""
    from_catalogue = {}
    for plan in plans:
        for c in plan.get('courses') or []:
            name = (c.get('name') or '').strip()
            ar = (c.get('ar') or '').strip()
            if name and ar:
                from_catalogue.setdefault(name, ar)

    a = b = 0
    missing = set()
    for plan in plans:
        for c in plan.get('courses') or []:
            name = (c.get('name') or '').strip()
            if not name or (c.get('ar') or '').strip():
                continue
            if name in from_catalogue:
                c['ar'] = from_catalogue[name]
                a += 1
            elif hand.get(name):
                c['ar'] = hand[name]
                b += 1
            else:
                missing.add(name)
    return a, b, missing


# ------------------------------------------------- courses named in Arabic only
ARABIC = re.compile('[\u0600-\u06ff]')


def fill_english_names(plans, english):
    """A few rows on the university's ENGLISH pages print the course title in
    Arabic (Statistics and Data Analysis in Technology and Society, First Aid
    and Emergency Evacuation in Occupational Health and Safety). Shown as is,
    an English reader gets an Arabic title. The Arabic is the university's own
    wording, so it moves to the Arabic side and the English side takes the
    title from data/aaup/course-names-en.json. Returns the names with no
    English yet."""
    missing = set()
    for plan in plans:
        for c in plan.get('courses') or []:
            name = (c.get('name') or '').strip()
            if not ARABIC.search(name):
                continue
            if english.get(name):
                if not (c.get('ar') or '').strip():
                    c['ar'] = name
                c['name'] = english[name]
            else:
                missing.add(name)
    return missing


# ---------------------------------------------------------------- major names
def _small_ar(small, minors):
    """'127 CH — Univ. Req. 14 · Free Elec. 6' in Arabic, or '' if unrecognised.

    Every token in these subtitles is a degree kind, an hour count or a
    programme number, so they are rewritten by rule. An unrecognised token
    returns '' — better an empty subtitle than a half-translated one.
    """
    s = (small or '').strip()
    if not s:
        return ''
    if s == '\U0001f6a7 No Academic Plan available yet':
        return '\U0001f6a7 لا توجد خطة دراسية متاحة بعد'
    if s.startswith('\U0001f6a7 Study plan coming soon'):
        rest = s[len('\U0001f6a7 Study plan coming soon'):].strip().lstrip('·').strip()
        tail = [_part_ar(p.strip(), minors) for p in rest.split('·')] if rest else []
        if any(t is None for t in tail):
            return '\U0001f6a7 الخطة الدراسية قريبًا'
        return ' · '.join(['\U0001f6a7 الخطة الدراسية قريبًا'] + tail)
    out = []
    for piece in s.split('·'):
        t = _part_ar(piece.strip(), minors)
        if t is None:
            return ''
        out.append(t)
    return ' · '.join(out)


def _part_ar(part, minors):
    if part in ('B.Sc.', 'BSc', 'B.Sc'):
        return 'بكالوريوس'
    if part == 'Diploma':
        return 'دبلوم'
    if part == 'Residency':
        return 'إقامة'
    m = re.fullmatch(r'(\d+(?:\.\d+)?) CH', part)
    if m:
        return m.group(1) + ' ساعة'
    m = re.fullmatch(r'(\d+(?:\.\d+)?) CH \(as stated\)', part)
    if m:
        return m.group(1) + ' ساعة (كما هو مذكور)'
    m = re.fullmatch(r'Program (\S+)', part)
    if m:
        return 'برنامج ' + m.group(1)
    m = re.fullmatch(r'(\d+) years?', part)
    if m:
        return m.group(1) + ' سنوات'
    m = re.fullmatch(r'Minor: (.+)', part)
    if m and m.group(1) in minors:
        return 'تخصص فرعي: ' + minors[m.group(1)]
    return None


def fill_major_names(plans, names, minors):
    filled = 0
    missing = []
    for plan in plans:
        mn = plan.setdefault('majorName', {})
        en = mn.setdefault('en', {})
        ar = mn.setdefault('ar', {})
        if not (ar.get('big') or '').strip():
            if plan['id'] in names:
                ar['big'] = names[plan['id']]
                filled += 1
            else:
                missing.append((plan['id'], en.get('big')))
        if not (ar.get('small') or '').strip():
            t = _small_ar(en.get('small'), minors)
            if t:
                ar['small'] = t
    return filled, missing


# ---------------------------------------------------------------- plan bios
def _split_notes(tail):
    out, rest = [], tail.strip()
    while rest:
        idx = rest.find('Note:', 1)
        if idx < 0:
            out.append(rest.strip())
            break
        out.append(rest[:idx].strip())
        rest = rest[idx:]
    return [x for x in out if x]


def _hours_ar(chunk, buckets):
    m = HOURS_LINE.match(chunk.strip())
    if not m:
        return None
    parts = []
    for piece in m.group(2).split('·'):
        piece = piece.strip()
        for en, ar in buckets.items():
            if piece.startswith(en):
                parts.append(ar + ' ' + piece[len(en):].strip())
                break
        else:
            return None
    return m.group(1) + ' ساعة — ' + ' · '.join(parts) + '.'


def fill_bios(plans, leads, notes, buckets):
    filled = 0
    problems = []
    for plan in plans:
        bio = plan.setdefault('bio', {})
        if (bio.get('ar') or '').strip() or not (bio.get('en') or '').strip():
            continue
        en = bio['en']
        cut = len(en)
        for marker in BIO_MARKERS:
            i = en.find(marker)
            if i >= 0:
                cut = min(cut, i)
        head, tail = en[:cut].strip(), en[cut:].strip()
        hm = re.search(r'\d+(?:\.\d+)?\s*CH — ', head)
        lead_en, hours_en = (head[:hm.start()].strip(), head[hm.start():].strip()) if hm else (head, '')

        pieces = []
        if lead_en:
            if plan['id'] not in leads:
                problems.append((plan['id'], 'no hand translation for the lead sentence'))
                continue
            if leads[plan['id']]:
                pieces.append(leads[plan['id']])
        if hours_en:
            h = _hours_ar(hours_en, buckets)
            if h is None:
                problems.append((plan['id'], 'unrecognised hours breakdown'))
                continue
            pieces.append(h)
        bad = False
        for note in _split_notes(tail):
            if note not in notes:
                problems.append((plan['id'], 'unknown note: ' + note[:50]))
                bad = True
                break
            pieces.append(notes[note])
        if bad:
            continue
        bio['ar'] = ' '.join(pieces).strip()
        filled += 1
    return filled, problems


# ---------------------------------------------------------------- entry point
def apply(plans, report=print):
    """Fill every Arabic gap in `plans`, in place. Called by build-catalogue.py."""
    course_map = _read('course-names-ar.json')
    english = _read('course-names-en.json')
    majors = _read('major-names-ar.json')
    bios = _read('plan-bios-ar.json')

    no_english = fill_english_names(plans, english)
    a, b, missing_courses = fill_course_names(plans, course_map)
    mfilled, mmissing = fill_major_names(
        plans, majors.get('majorNames', {}), majors.get('minors', {}))
    bfilled, bproblems = fill_bios(
        plans, bios.get('leads', {}), bios.get('notes', {}), bios.get('buckets', {}))

    report(f'  arabic       : {a} course names from the catalogue, '
           f'{b} from data/aaup/course-names-ar.json')
    report(f'                 {mfilled} programme names, {bfilled} descriptions')
    if missing_courses:
        report(f'  NO ARABIC    : {len(missing_courses)} course name(s) — '
               f'add them to data/aaup/course-names-ar.json')
    for name in sorted(no_english):
        report(f'  NO ENGLISH   : {name} — add it to data/aaup/course-names-en.json')
    for pid, name in mmissing:
        report(f'  NO ARABIC    : programme {pid} ({name})')
    for pid, why in bproblems:
        report(f'  NO ARABIC    : bio for {pid} — {why}')
    return not (missing_courses or no_english or mmissing or bproblems)
