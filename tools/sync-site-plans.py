#!/usr/bin/env python3
"""Bring the hand-authored majors in line with aaup.edu, course by course.

    python3 tools/sync-site-plans.py            # report only
    python3 tools/sync-site-plans.py --write    # rewrite data/aaup/majors/*.json

The majors tools/import-catalogue-programs.py generates are rebuilt from
tools/catalogue-import/site-plans.json directly. The ones it never touches -
its ALREADY list: the AI and Data Science faculty, Computer Science and its
minors, Nursing, Pharmacy, Respiratory Therapy - were authored by hand, carry
the university's semester layout, and are synced here instead, in place.

For each such major whose program has an Academic Plan page:
  * credit hours: every course the page lists gets the page's hours;
  * prerequisites: a course the page lists gets exactly the prerequisites the
    page prints, kept only where the prerequisite is itself in this plan. "-"
    on the page means none, and is applied: the page is generated from the
    registration system, so a printed "-" is an answer, not a gap. A pair the
    page prints as each other's prerequisite (a lecture and its lab) is a
    co-requisite and neither edge is kept, or both would be locked forever;
  * renumbered courses: a course the plan has under a number the page no
    longer lists, while the page lists the same name under a number the plan
    lacks, is RENAMED (renamedIds), so each student's ticks and grades move
    with it - see js/02-id-renames.js;
  * missing courses: a required course the page lists and the plan lacks is
    added, in a suggested term (see placement). A missing elective option is
    added to the plan's elective pool, with no term, like every other option;
  * courses the page does not list are removed - but only when the page is
    complete, i.e. its tables add up to the degree total it states, so the
    absence is the page's answer and not a gap in it. They are recorded in
    removedNotOnSite. On an incomplete page they are only reported;
  * requirement and degree hours: the page's.
A course not on the page keeps everything it has.

Labs: a hand-authored plan can show a lecture and its lab as two cards sharing
one course number ("290311110" and "290311110-lab", pairGroup). They are one
course here: both get the hours, and prerequisites hang off the lecture card,
as they always have.
"""
import argparse
import collections
import glob
import importlib.util
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAJORS = os.path.join(REPO, 'data', 'aaup', 'majors')
SITE = os.path.join(REPO, 'tools', 'catalogue-import', 'site-plans.json')

_spec = importlib.util.spec_from_file_location(
    'importer', os.path.join(REPO, 'tools', 'import-catalogue-programs.py'))
importer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(importer)

REQUIRED = ('univReq', 'colgReq', 'specReq', 'deptReq', 'minorReq', 'supportCourses')
POOLED = ('colgElec', 'specElec', 'deptElec', 'minorElec')
ORDER = ['univReq', 'univElec', 'colgReq', 'colgElec', 'specReq', 'specElec',
         'deptReq', 'deptElec', 'minorReq', 'minorElec', 'freeElec', 'supportCourses']
# A slot's kind, by the display category every hand-authored plan gives it.
SLOT_BUCKET = {'UNIVERSITY_ELECTIVE': 'univElec', 'FREE_ELECTIVE': 'freeElec',
               'DEPARTMENT_ELECTIVE': 'specElec'}
DISPLAY = dict(importer.DISPLAY, colgElec='DEPARTMENT_ELECTIVE', deptReq='CORE',
               deptElec='DEPARTMENT_ELECTIVE', minorReq='CORE', minorElec='DEPARTMENT_ELECTIVE')


def code_of(c):
    """A card's course number. Lab halves share their lecture's."""
    return c.get('code') or re.sub(r'-lab$', '', c['slug'])


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def hours_str(old, new):
    """Write hours in the style the plan already uses ('3' or '3.0')."""
    if isinstance(old, str) and '.' not in old and float(new).is_integer():
        return str(int(new))
    return str(float(new)) if isinstance(old, str) else new


def placement(major, sc, bucket):
    """Which term to put an added required course in.

    A 0-hour university requirement goes in the first term, where every plan
    here keeps Community Service and Beginning English. Anything else goes in
    the lightest term that comes after everything it needs and not before the
    year its number belongs to: the sixth digit of an AAUP course number is
    its year (290313240, Deep Learning, is a third-year course). The term is a
    suggestion, and the course says so.
    """
    terms = collections.defaultdict(float)
    at = {}
    for c in major['courses']:
        if not c.get('year') or str(c.get('semester')) == '3':
            continue
        t = (int(c['year']), int(c['semester']))
        terms[t] += float(num(c.get('credits')) or 0)
        at.setdefault(code_of(c), t)
    if not terms:
        return 1, 1
    if bucket == 'univReq' and not sc.get('credits'):
        return min(terms)
    code = sc['code']
    level = int(code[5]) if len(code) == 9 and code[5] in '123456' else 1
    floor = (min(level, max(terms)[0]), 0)
    for q in sc.get('prerequisites', []):
        if q in at and at[q] >= floor:
            floor = at[q]
    later = [t for t in terms if t > floor] or [max(terms)]
    return min(later, key=lambda t: (t[0], terms[t], t))


def sync(major, sp):
    """Apply one Academic Plan page to one major. Returns a report dict."""
    rep = collections.defaultdict(list)
    site = {}
    for bucket in ORDER:
        sec = sp['requirements'].get(bucket)
        if not sec or bucket in ('univElec', 'freeElec'):
            continue
        for c in sec.get('courses', []):
            site.setdefault(c['code'], (bucket, c))
    req = {}
    for bucket in ORDER:
        sec = sp['requirements'].get(bucket)
        if sec:
            req[bucket] = sec['requiredHours'] if sec.get('requiredHours') is not None else \
                sum(c.get('credits') or 0 for c in sec.get('courses', []))
    complete = bool(sp.get('degreeHours')) and abs(sum(req.values()) - sp['degreeHours']) < 0.001

    def cards_by_code():
        # Only numbered cards are courses. An elective slot ("uni-elective-1")
        # is the student's to fill, whatever its isPlaceholder says.
        out = collections.defaultdict(list)
        for c in major['courses']:
            if not c.get('isPlaceholder') and re.match(r'^\d{6,}$', code_of(c)):
                out[code_of(c)].append(c)
        return out

    def rename_slugs(renames):
        for c in major['courses']:
            c['slug'] = renames.get(c['slug'], c['slug'])
        for e in major.get('prerequisites', []):
            e['requires'] = renames.get(e['requires'], e['requires'])
            e['forCourse'] = renames.get(e['forCourse'], e['forCourse'])
        major['renamedIds'] = importer.resolve_renames({**major.get('renamedIds', {}), **renames})

    # 0. a course the university renumbered: the plan has it under a number
    # the page no longer lists, and the page lists the same name under a
    # number the plan does not have. It is renamed, not removed and re-added,
    # so a student's ticks, grades and notes follow it (js/02-id-renames.js).
    cards = cards_by_code()
    gained = collections.defaultdict(list)
    for code, (bucket, sc) in site.items():
        if code not in cards:
            gained[importer.norm_name(sc['name'])].append(code)
    renames = {}
    for code, cs in list(cards.items()):
        if code in site:
            continue
        hits = gained.get(importer.norm_name(cs[0]['name']), [])
        if len(hits) != 1:
            continue
        new = hits[0]
        for c in cs:
            renames[c['slug']] = new + '-lab' if c['slug'].endswith('-lab') else new
            c['code'] = new
        rep['renumbered'].append((code, new, cs[0]['name']))
        gained[importer.norm_name(cs[0]['name'])] = []
    if renames:
        rename_slugs(renames)
    cards = cards_by_code()

    def lecture(code):
        cs = cards.get(code) or []
        return next((c for c in cs if c['slug'] == code),
                    next((c for c in cs if not c['slug'].endswith('-lab')), cs[0] if cs else None))

    # 1. hours, and which requirement the course counts towards
    for code, cs in cards.items():
        if code not in site:
            continue
        for c in cs:
            if c.get('requirement') != site[code][0]:
                if c.get('requirement'):
                    rep['requirement'].append((code, c['name'], c['requirement'], site[code][0]))
                c['requirement'] = site[code][0]
        want = site[code][1].get('credits')
        if want is None:
            continue
        for c in cs:
            if num(c.get('credits')) != want:
                rep['hours'].append((code, c['name'], c.get('credits'), want))
                c['credits'] = hours_str(c.get('credits'), want)

    # 2. a course the page does not list. Removed only when the page is
    # complete - its tables add up to the degree total it states - because
    # then the absence is the page's answer. Otherwise it is reported.
    gone = []
    for code, cs in cards.items():
        if code in site:
            continue
        if complete:
            gone.append(code)
            rep['removed'].append((code, cs[0]['name']))
        else:
            rep['notOnPage'].append((code, cs[0]['name']))
    if gone:
        drop = {c['slug'] for code in gone for c in cards[code]}
        major['courses'] = [c for c in major['courses'] if c['slug'] not in drop]
        major['prerequisites'] = [e for e in major.get('prerequisites', [])
                                  if e['requires'] not in drop and e['forCourse'] not in drop]
        was = {d['code']: d['name'] for d in major.get('removedNotOnSite', [])}
        was.update({code: cards[code][0]['name'] for code in gone})
        major['removedNotOnSite'] = [{'code': k, 'name': v} for k, v in sorted(was.items())]
        cards = cards_by_code()

    # 3. a course the page lists that the plan lacks - added only from a
    # complete page. On one that does not add up, nothing says the course
    # belongs to this plan; it is recorded instead.
    taken = {c['slug'] for c in major['courses']}
    only = []
    for code, (bucket, sc) in site.items():
        if code in cards or code in taken:
            continue
        if not complete:
            only.append({'code': code, 'name': importer.title_case(sc['name']),
                         'credits': sc.get('credits'), 'requirement': bucket})
            rep['onlyOnPage'].append((code, sc['name'], bucket))
            continue
        pool = bucket in POOLED
        y, s = (None, None) if pool else placement(major, sc, bucket)
        cr = sc.get('credits')
        card = {
            'slug': code, 'code': code, 'name': importer.title_case(sc['name']), 'nameAr': None,
            'credits': str(int(cr)) if cr is not None and float(cr).is_integer() else str(cr or 0),
            'theoretical': sc.get('theoretical'), 'practical': sc.get('practical'),
            'year': y, 'semester': s,
            'category': DISPLAY.get(bucket, 'CORE'), 'requirement': bucket,
            'isElective': pool, 'isPlaceholder': False, 'pairGroup': False,
            'independentGrades': False, 'prerequisiteText': None,
        }
        if not pool:
            card['addedFromSite'] = ('Listed on the program\u2019s Academic Plan page but missing '
                                     'from this plan; the term shown is suggested.')
        major['courses'].append(card)
        taken.add(code)
        rep['added'].append((code, card['name'], bucket, y, s))
    cards = cards_by_code()
    names = {c['slug']: c for c in major['courses']}

    # 4. prerequisites
    old = {(e['requires'], e['forCourse']) for e in major.get('prerequisites', [])}
    slug_code = {c['slug']: code_of(c) for c in major['courses']}
    new = {(a, b) for (a, b) in old if slug_code.get(b, b) not in site}
    for code, (bucket, sc) in site.items():
        if code not in cards:
            continue
        b = lecture(code)['slug']
        for q in sc.get('prerequisites', []):
            if q in cards and q != code:
                new.add((lecture(q)['slug'], b))
    new -= {(a, b) for (a, b) in new if (b, a) in new}
    if new != old:
        for b in sorted({b for (_, b) in old ^ new}):
            card = names.get(b)
            before = sorted(slug_code.get(a, a) for (a, x) in old if x == b)
            after = sorted(slug_code.get(a, a) for (a, x) in new if x == b)
            rep['prerequisites'].append((slug_code.get(b, b), card['name'] if card else b, before, after))
            if card is not None:
                card['prerequisiteText'] = site.get(slug_code.get(b, b), (None, {}))[1].get('prerequisiteText')
        order = {c['slug']: i for i, c in enumerate(major['courses'])}
        major['prerequisites'] = [{'requires': a, 'forCourse': b} for a, b in
                                  sorted(new, key=lambda e: (order.get(e[1], 1e9), order.get(e[0], 1e9)))]

    # 4b. elective slots - the cards a student fills in themselves. They carry
    # no course number, so the page cannot name them; their requirement comes
    # from what kind of slot they are. Where a plan's slots for a requirement
    # add up to less than the page asks for, slots are added, without a term,
    # as the generator does for its own plans.
    slots = collections.defaultdict(list)
    for c in major['courses']:
        if re.match(r'^\d{6,}$', code_of(c)):
            continue
        b = SLOT_BUCKET.get(c.get('category'))
        if not b:
            continue
        if not c.get('requirement'):
            c['requirement'] = b
        slots[c['requirement']].append(c)
    for b, (en, ar) in importer.SLOT_LABEL.items():
        if b not in req or b == 'specReq':
            continue
        named = [cs for code, cs in cards.items() if site.get(code, (None,))[0] == b]
        if not slots.get(b) and (named or b not in ('univElec', 'freeElec')):
            continue          # the plan names its options instead of using slots
        have = sum(float(num(c.get('credits')) or 0) for c in slots.get(b, []))
        gap = req[b] - have
        unit = 2 if b == 'univElec' else 3
        n = 0
        while gap >= unit - 0.001:
            n += 1
            slug = '%s-site-slot-%d' % (b.lower(), n)
            while any(c['slug'] == slug for c in major['courses']):
                n += 1
                slug = '%s-site-slot-%d' % (b.lower(), n)
            major['courses'].append({
                'slug': slug, 'code': None, 'name': en, 'nameAr': ar, 'credits': str(unit),
                'theoretical': None, 'practical': None, 'year': None, 'semester': None,
                'category': DISPLAY[b], 'requirement': b, 'isElective': True,
                'isPlaceholder': True, 'pairGroup': False, 'independentGrades': False,
                'prerequisiteText': None})
            rep['slots'].append((b, slug, unit))
            gap -= unit

    # 5. hours per requirement and for the degree
    if req != major.get('requirementHours'):
        rep['requirementHours'].append((major.get('requirementHours'), req))
        major['requirementHours'] = req
    if sp.get('degreeHours') and sp['degreeHours'] != major.get('degreeHours'):
        rep['degreeHours'].append((major.get('degreeHours'), sp['degreeHours']))
        major['degreeHours'] = sp['degreeHours']
    if sp.get('degreeHours') and not complete:
        total = sum(req.values())
        major['degreeHoursDiscrepancy'] = {
            'statedDegreeHours': sp['degreeHours'], 'sumOfRequirementHours': total,
            'difference': round(total - sp['degreeHours'], 2),
            'reason': 'The program\u2019s Academic Plan page states this total, and its '
                      'requirement tables add to another. Neither figure is altered here.'}
    else:
        major.pop('degreeHoursDiscrepancy', None)
    # Where the plan's own required courses do not add up to the page's
    # figure for that requirement. Elective buckets are left out: a pool of
    # options always holds more hours than a student takes from it. A lecture
    # and its lab card count once.
    got = collections.defaultdict(float)
    for code, cs in cards.items():
        b = site.get(code, (cs[0].get('requirement'), None))[0]
        if b in REQUIRED:
            got[b] += float(num(cs[0].get('credits')) or 0)
    drift = {b: round(got[b] - req[b], 2) for b in REQUIRED if b in req and abs(got[b] - req[b]) >= 0.01}
    if drift:
        major['requirementHoursDrift'] = drift
    else:
        major.pop('requirementHoursDrift', None)
    src = major.setdefault('requirementSource', {})
    src['site'] = {k: sp[k] for k in ('page', 'capture', 'capturedAt') if sp.get(k)}
    if not complete:
        src['site']['pageIncomplete'] = ('The page\u2019s tables add up to %g hours against the %s it '
                                         'states; courses it does not list are kept, and courses only it '
                                         'lists are recorded, not added.' % (sum(req.values()), sp.get('degreeHours')))
    if only:
        src['site']['onlyOnIncompletePage'] = only
    # The hours a plan must reach come from the page only when the page is
    # complete; an incomplete page's figures would undercount the plan.
    if not complete and rep['requirementHours']:
        major['requirementHours'] = rep['requirementHours'][0][0]
        rep['requirementHours'] = []
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    site = {importer.key(p['name']): p for p in json.load(open(SITE, encoding='utf-8'))['programs']}
    by_slug = {s: n for n, s in importer.ALREADY.items()}
    totals = collections.Counter()
    for path in sorted(glob.glob(os.path.join(MAJORS, '*.json'))):
        slug = os.path.basename(path)[:-5]
        if slug not in by_slug:
            continue
        sp = site.get(importer.key(by_slug[slug]))
        if not sp:
            print('%-28s no Academic Plan page read for "%s"' % (slug, by_slug[slug]))
            continue
        if not sp.get('published'):
            print('%-28s the site publishes no plan for "%s" - left as it is' % (slug, by_slug[slug]))
            continue
        major = json.load(open(path, encoding='utf-8'))
        rep = sync(major, sp)
        print('%-28s renumbered %d, hours %d, removed %d, added %d, prerequisites %d, not on the page %d%s' % (
            slug, len(rep['renumbered']), len(rep['hours']), len(rep['removed']), len(rep['added']),
            len(rep['prerequisites']), len(rep['notOnPage']),
            '' if not rep['degreeHours'] else ', degree %s -> %s' % rep['degreeHours'][0]))
        for k in ('renumbered', 'hours', 'requirement', 'removed', 'added', 'slots', 'prerequisites', 'notOnPage', 'onlyOnPage'):
            totals[k] += len(rep[k])
            for row in rep[k]:
                print('    %-14s %s' % (k, row))
        if args.write:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(major, f, ensure_ascii=False, indent=2)
                f.write('\n')
    print('totals:', dict(totals), '' if args.write else '(report only; --write to apply)')


if __name__ == '__main__':
    sys.exit(main())
