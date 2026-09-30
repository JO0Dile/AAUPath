#!/usr/bin/env python3
"""Give courses their course number as their id, in majors that used tags.

Most majors already name every course by its catalogue number (100411010).
Four older ones (AI and Robotics, Computer Science, Cybersecurity, Medical)
used hand-made tags instead (calc-1), so the same course had two different
ids across the app and search showed one of them without a number.

For each course that has a number but a tag for an id:
  - the id becomes the number;
  - a lab that shares its lecture's number becomes <number>-lab, which is
    the shape the app already pairs with its lecture (js/18-gpa.js);
  - prerequisites follow;
  - the old -> new pairs are kept in the major's `renamedIds`.

Elective slots without a number (uni-elective-1) keep their tag: they are
placeholders, not courses.

Then web/js/02-id-renames.js is rewritten with every major's renamedIds, so
each phone moves its saved ticks, grades and notes to the new ids the first
time the updated app opens.

Safe to run again: a major already renamed has nothing left to rename.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAJORS = ROOT / 'data' / 'aaup' / 'majors'
TARGETS = ['robotics', 'cs', 'cybersecurity', 'medical']
NUM = re.compile(r'^\d+(-lab)?$')


def renumber(major):
    courses = major.get('courses', [])
    ids = {c['slug'] for c in courses}
    by_code = {}
    for c in courses:
        if c.get('code'):
            by_code.setdefault(c['code'], []).append(c)
    renames = {}
    for c in courses:
        old, code = c['slug'], (c.get('code') or '').strip()
        if NUM.match(old) or not re.match(r'^\d+$', code):
            continue
        same = by_code.get(code, [])
        is_lab = old.endswith('-lab') and len(same) > 1
        new = code + '-lab' if is_lab else code
        if new in ids or new in renames.values():
            raise SystemExit(f"{major['slug']}: {old} -> {new} collides with an existing id")
        renames[old] = new
    for c in courses:
        if c['slug'] in renames:
            c['slug'] = renames[c['slug']]
    for p in major.get('prerequisites', []):
        p['requires'] = renames.get(p['requires'], p['requires'])
        p['forCourse'] = renames.get(p['forCourse'], p['forCourse'])
    if renames:
        major['renamedIds'] = {**major.get('renamedIds', {}), **renames}
    return renames


def main():
    table = {}
    for slug in TARGETS:
        path = MAJORS / f'{slug}.json'
        major = json.loads(path.read_text(encoding='utf-8'))
        got = renumber(major)
        if got:
            path.write_text(json.dumps(major, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'{slug}: {len(got)} renamed')
    for path in sorted(MAJORS.glob('*.json')):
        major = json.loads(path.read_text(encoding='utf-8'))
        if major.get('renamedIds'):
            table[major['slug']] = major['renamedIds']
    out = ROOT / 'web' / 'js' / '02-id-renames.js'
    text = out.read_text(encoding='utf-8')
    start, end = '/* RENAMES */', '/* END RENAMES */'
    i, j = text.index(start) + len(start), text.index(end)
    text = text[:i] + '\n  var RENAMES = ' + json.dumps(table, ensure_ascii=False, sort_keys=True) + ';\n  ' + text[j:]
    out.write_text(text, encoding='utf-8')
    print('wrote', out.relative_to(ROOT))


if __name__ == '__main__':
    main()
