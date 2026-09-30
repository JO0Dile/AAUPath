#!/usr/bin/env python3
"""Build web/plans.json — the whole catalogue as one static file.

The app is offline-first and self-contained: it ships its catalogue rather
than asking a server for it at runtime. This turns the authored data under
data/ into the exact structure the app's own plan renderer consumes, so there
is no live API in the loop and no server that can be asleep when a student
opens the app.

data/ stays the place plans are authored and reviewed. This is the build step
that publishes them.

    python3 tools/build-catalogue.py

Run it after editing anything under data/, then commit web/plans.json.
"""
import hashlib
import json
import pathlib
import sys

import arabic_fill

REPO = pathlib.Path(__file__).resolve().parent.parent
DATA = REPO / 'data'
OUT = REPO / 'web' / 'plans.json'

# Inverse of the importer's mapping, which came from the app's own
# CATEGORY_FALLBACK table. These two must round-trip losslessly.
CATEGORY_OUT = {
    'CORE': 'core',
    'MATH': 'math',
    'DEPARTMENT_ELECTIVE': 'dept',
    'UNIVERSITY_ELECTIVE': 'uni',
    'FREE_ELECTIVE': 'free',
    'UNIVERSITY_REQUIREMENT': 'skills',
    'ENGLISH': 'eng',
}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sort_order_of(v):
    """Where a major sits among its faculty's tiles, or None for unplaced.

    Empty means unplaced, not zero — zero is a real position that would move
    the major to the front. Anything unparseable is treated as unplaced rather
    than raising, so one bad field cannot fail the whole catalogue build.
    """
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def shape_plan(major, scales_by_college, colleges):
    # Years and summers are derived from where the courses actually sit, so the
    # structure can never disagree with the courses it describes.
    years = {}
    for c in major.get('courses', []):
        if c.get('year') is None:
            continue
        yid = f"y{c['year']}"
        years[yid] = years.get(yid, False) or c.get('semester') == 3
    structure = {
        'years': [
            {'id': yid, 'hasSummer': has}
            for yid, has in sorted(years.items(), key=lambda kv: int(kv[0][1:]))
        ]
    }

    courses = []
    for c in major.get('courses', []):
        courses.append({
            'id': c['slug'],
            'name': c.get('name') or c['slug'],
            'ar': c.get('nameAr') or '',
            'creditHours': float(c.get('credits') or 0),
            'category': CATEGORY_OUT.get(c.get('category'), 'core'),
            # The university's own requirement bucket, when the published plan
            # for this program says which one it is. `category` above is a
            # DISPLAY choice (what colour the card is); this is the taxonomy the
            # student portal and the degree audit actually use, and the two are
            # not the same thing. Absent where no published plan covers the
            # major — the app falls back to guessing from `category` there, as
            # it always has.
            'requirement': c.get('requirement') or '',
            'yearId': None if c.get('year') is None else f"y{c['year']}",
            'semester': None if c.get('semester') is None else f"s{c['semester']}",
            'courseNumber': c.get('code') or '',
            # Where this course's TERM came from. Every other course in a plan
            # sits in the year and semester the published document put it in.
            # These ones do not: tools/merge-catalogue-requirements.py found
            # them listed in the program's requirement tables but missing from
            # its advisory plan, and picked the earliest term their own
            # prerequisites allow. That is the app's arrangement, not the
            # department's, and until now the two looked identical on the page.
            # Only emitted where it is true, so the flag never implies anything
            # about the courses that do not carry it.
            **({'termSuggested': True} if c.get('addedFromSource') else {}),
        })

    prereqs = [[p['requires'], p['forCourse']] for p in major.get('prerequisites', [])]

    # Only the AI faculty's own majors use the 50-pass scale; everything else
    # falls back to the engineering one. A default, never an assertion about a
    # specific course.
    scale = scales_by_college.get('ai' if major.get('college') == 'aaup-ai-ds' else 'engineering')

    return {
        'id': major['slug'],
        # Bumped whenever this file is rebuilt, so a corrected plan replaces the
        # copy a student already has instead of being ignored as "not newer".
        'version': major.get('version', 1),
        'majorName': {
            'en': {'big': major.get('name') or major['slug'], 'small': major.get('subtitle') or ''},
            'ar': {'big': major.get('nameAr') or '', 'small': major.get('subtitleAr') or ''},
        },
        'icon': major.get('icon') or '🎓',
        'iconKey': major.get('iconKey') or '',
        'imageUrl': major.get('imageUrl') or '',
        'university': major['university'],
        'collegeId': major.get('college'),
        # The names as well as the id: the plan header shows the faculty, and
        # a plan whose college is not in the registry still has something
        # meaningful to display.
        'college': {
            'en': (colleges.get(major.get('college')) or {}).get('name', {}).get('en', ''),
            'ar': (colleges.get(major.get('college')) or {}).get('name', {}).get('ar', ''),
        },
        'bio': {'en': major.get('bio') or '', 'ar': major.get('bioAr') or ''},
        'degreeHours': major.get('degreeHours'),
        # How many hours each requirement bucket needs, from the published
        # plan. This is what a bucket's total must be — NOT the sum of the
        # cards drawn in it. An elective pool lists every option a student may
        # pick from, so summing its cards reports 48 hours for a 9-hour
        # requirement; and a plan that is short a slot reports 6 where the
        # university requires 8. Both were happening, and both were invisible.
        'requirementHours': major.get('requirementHours') or {},
        # Present only where the source document disagrees with itself about a
        # degree's total. tools/check-plan-hours.py reports these separately
        # instead of failing, because no change to this repo can reconcile them.
        'degreeHoursDiscrepancy': major.get('degreeHoursDiscrepancy') or None,
        'sortOrder': sort_order_of(major.get('sortOrder')),
        'freeElectiveSuggestions': major.get('freeElectiveSuggestions') or [],
        # Round 10, ideas 7 and 8. Only on plans that have them, so every
        # other plan keeps its version and nobody re-downloads it for nothing.
        **({'replaced': [[r['old'], r['new']] for r in major['replaced']]} if major.get('replaced') else {}),
        **({'tracks': [{'id': t['id'], 'name': {'en': t['name'], 'ar': t.get('nameAr') or ''}, 'courses': t['courses']}
                       for t in major['tracks']]} if major.get('tracks') else {}),
        'gradingScale': scale,
        'structure': structure,
        'courses': courses,
        'prerequisites': prereqs,
    }


def main():
    index = read(DATA / 'universities.json')
    universities, colleges, plans = {}, {}, []
    skipped = []

    for entry in index['universities']:
        # "published": false keeps a university out of the shipped app without
        # deleting the work. Birzeit's 10 transcribed plans and Al-Salem's one
        # stay exactly where they are in data/, reviewed and version-controlled
        # — they are simply not offered to students while the focus is AAUP.
        # Flip the flag back to publish them; nothing else has to change.
        slug = entry['slug']
        if entry.get('published') is False:
            skipped.append(slug)
            continue
        uni_dir = DATA / slug
        uni = read(uni_dir / 'university.json')

        try:
            rules = read(uni_dir / 'rules.json')
        except FileNotFoundError:
            rules = {}

        # Three icon layers travel together, all optional. The app tries
        # imageUrl (a PNG an admin uploaded), then iconKey (a built-in line
        # icon), then icon (the emoji it has always used). logoUrl is the
        # university's own official mark and is just imageUrl by another name
        # — kept as a distinct field because that is what the record has
        # always called it.
        universities[slug] = {
            'name': {'en': uni['name'], 'ar': uni.get('nameAr') or ''},
            'shortName': uni.get('shortName') or slug.upper(),
            'icon': uni.get('icon') or '🎓',
            'iconKey': uni.get('iconKey') or '',
            'logoUrl': uni.get('logoUrl') or uni.get('imageUrl') or '',
            'description': uni.get('description') or '',
            'website': uni.get('website') or '',
            # Switchboard and fax numbers for the university's own campuses,
            # as it publishes them itself. These are institutional numbers on
            # a public page — unlike the per-instructor numbers build-contacts
            # deliberately refuses to ship — so they travel with the record
            # and the About screen reads them from here rather than hardcoding.
            'contacts': uni.get('contacts') or {},
            # Dates the Home screen counts down to (add/drop, midterms,
            # finals…), set from the Developer panel's university editor.
            'dates': uni.get('dates') or [],
            'electivePool': rules.get('universityElectives') or [],
        }

        for c in uni.get('colleges', []):
            colleges[c['slug']] = {
                'university': slug,
                'icon': c.get('icon') or '🎓',
                'iconKey': c.get('iconKey') or '',
                'imageUrl': c.get('imageUrl') or '',
                'name': {'en': c['name'], 'ar': c.get('nameAr') or ''},
            }

        scales_by_college = {}
        for s in rules.get('gradingScales', []):
            scales_by_college[s['slug']] = {
                'name': s['name'], 'passMark': s['passMark'], 'bands': s['bands'],
            }

        majors_dir = uni_dir / 'majors'
        if not majors_dir.is_dir():
            continue
        # Emitted in the order students see: majors the admin has placed come
        # first in that order, then everything unplaced alphabetically. The
        # app sorts too — this just keeps the file's own order meaningful, so
        # a reordering shows up as a readable diff rather than a silent one.
        shaped = [shape_plan(read(f), scales_by_college, colleges)
                  for f in sorted(majors_dir.glob('*.json'))]
        shaped.sort(key=lambda p: (
            p['sortOrder'] is None,
            p['sortOrder'] if p['sortOrder'] is not None else 0,
            p['majorName']['en']['big'],
        ))
        plans.extend(shaped)

    # The Arabic side of the catalogue, filled in from data/ before the version
    # hash is taken so it is part of what a plan's version describes.
    #
    # This is a build STEP and not a script anyone runs by hand, and that is
    # deliberate: it used to be three scripts that edited web/plans.json in
    # place, and web/plans.json is this file's output. The next rebuild
    # regenerated it from data/ and silently deleted 3,221 Arabic course names,
    # 64 programme names and 68 descriptions. Nothing failed — the app just
    # quietly went back to English. Running it here means a rebuild cannot undo
    # it.
    ok = arabic_fill.apply(plans)

    # A plan's version must increase when its content changes, or a student who
    # already has the old copy never receives the fix. Content-derived rather
    # than a timestamp, so rebuilding without editing anything does not force
    # every device to re-download every plan.
    for p in plans:
        body = json.dumps(
            {k: v for k, v in p.items() if k != 'version'},
            ensure_ascii=False, sort_keys=True,
        )
        # hashlib, not hash(): Python's built-in hash is salted per process, so
        # it would hand out a different version on every run and make every
        # device re-download every plan for no reason.
        p['version'] = int(hashlib.sha1(body.encode('utf-8')).hexdigest()[:8], 16)

    out = {
        'schemaVersion': 1,
        'universities': universities,
        'colleges': colleges,
        'plans': plans,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

    with_courses = sum(1 for p in plans if p['courses'])
    print(f'wrote {OUT.relative_to(REPO)}')
    if skipped:
        print(f'  unpublished  : {", ".join(skipped)}  (in data/, not shipped)')
    print(f'  universities : {len(universities)}')
    print(f'  colleges     : {len(colleges)}')
    print(f'  plans        : {len(plans)}  ({with_courses} with courses, {len(plans) - with_courses} listing-only)')
    print(f'  courses      : {sum(len(p["courses"]) for p in plans)}')
    print(f'  prerequisites: {sum(len(p["prerequisites"]) for p in plans)}')
    print(f'  size         : {OUT.stat().st_size / 1024:.0f} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
