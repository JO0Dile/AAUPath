#!/usr/bin/env python3
"""Make every major's prerequisites match the published source, course by course.

    python3 tools/sync-prerequisites.py            # report only
    python3 tools/sync-prerequisites.py --write    # rewrite data/aaup/majors/*.json

The majors generated from the catalogue (tools/import-catalogue-programs.py)
were born with the source's prerequisites. The older majors were not: they
were authored by hand before the catalogue was imported, and their
prerequisites drifted from what the university publishes - Machine Learning in
AI and Robotics listed four prerequisites where the faculty PDF prints one.
merge-catalogue-requirements.py later gave those majors the source's
requirement buckets but never touched their prerequisites.

The rule is the importer's, so a synced major reads exactly as a freshly
imported one would:
  * a course the source lists gets exactly the source's prerequisites, kept
    only where the prerequisite is itself in this major;
  * a pair the source prints as each other's prerequisite (a lecture and its
    own lab) is a co-requisite, not a prerequisite, and neither edge is kept -
    otherwise both are locked forever;
  * a course the source does not list (a placeholder, an elective pool, a
    course added by hand) keeps the prerequisites it has;
  * so does a course the source lists WITHOUT a prerequisite. A blank cell
    cannot be told apart from one the document simply left empty (the AI PDF
    prints Intermediate English's prerequisite for six programs and leaves it
    blank for a seventh), and wrongly dropping a prerequisite tells a student
    a course is open when it is not. Only a printed prerequisite overrides.

A major is paired with its source program by requirementSource.program, or by
EXTRA below for the few majors that predate that field. Never fuzzy-matched.
"""
import argparse
import glob
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAJORS = os.path.join(REPO, 'data', 'aaup', 'majors')
CI = os.path.join(REPO, 'tools', 'catalogue-import')

EXTRA = {
    'cybersecurity.json': 'Bachelor in Artificial Intelligence - Specialization in Artificial Intelligence and Cyber Security',
    'aaup-networks-infosec.json': 'Bachelor in Computer Networks - Minor Information Security',
}


def sources():
    """{program name: {course code: set(prerequisite codes)}} from every source."""
    out = {}

    def add(name, prog):
        m = out.setdefault(name, {})
        for sect in (prog.get('requirements') or {}).values():
            for c in sect.get('courses', []):
                m.setdefault(c['code'], set()).update(c.get('prerequisites', []))

    for fac in json.load(open(os.path.join(CI, 'catalogue.json'), encoding='utf-8')):
        for p in fac['programs']:
            if p.get('requirements'):
                add(p['name'], p)
    for p in json.load(open(os.path.join(CI, 'ai-data-science.json'), encoding='utf-8'))['programs']:
        if p.get('requirements'):
            add(p['name'], p)
    for path in sorted(glob.glob(os.path.join(CI, 'from-images', '*.json'))):
        d = json.load(open(path, encoding='utf-8'))
        if d.get('requirements'):
            add(d['name'], d)
    return out


def synced(major, src):
    """The major's prerequisite list as the source prints it."""
    slugs = {c['slug'] for c in major['courses']}
    covered = {s for s in slugs if src.get(s)}
    edges = set()
    for e in major.get('prerequisites', []):
        if e['forCourse'] not in covered:          # the source says nothing about it
            edges.add((e['requires'], e['forCourse']))
    for s in covered:
        for p in src[s]:
            if p in slugs and p != s:
                edges.add((p, s))
    mutual = {(a, b) for (a, b) in edges if (b, a) in edges}
    edges -= mutual
    order = {c['slug']: i for i, c in enumerate(major['courses'])}
    return [{'requires': a, 'forCourse': b}
            for a, b in sorted(edges, key=lambda e: (order.get(e[1], 1e9), order.get(e[0], 1e9)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    src = sources()
    total_changed = 0
    for path in sorted(glob.glob(os.path.join(MAJORS, '*.json'))):
        base = os.path.basename(path)
        major = json.load(open(path, encoding='utf-8'))
        name = (major.get('requirementSource') or {}).get('program') or EXTRA.get(base)
        if not major.get('courses') or not name:
            continue
        if name not in src:
            print('%-60s source program not found: %s' % (base, name))
            continue
        new = synced(major, src[name])
        old = major.get('prerequisites', [])
        a = {(e['requires'], e['forCourse']) for e in old}
        b = {(e['requires'], e['forCourse']) for e in new}
        if a == b:
            continue
        courses = {e[1] for e in a ^ b}
        total_changed += len(courses)
        print('%-60s %3d course(s): +%d -%d prerequisite links' % (base, len(courses), len(b - a), len(a - b)))
        if args.write:
            major['prerequisites'] = new
            by = {c['slug']: c for c in major['courses']}
            for s in courses:
                # The old hand-written sentence no longer matches; the links are the truth.
                if s in by and by[s].get('prerequisiteText'):
                    by[s]['prerequisiteText'] = None
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(major, f, ensure_ascii=False, indent=2)
                f.write('\n')
    print('courses whose prerequisites differ from the source: %d%s'
          % (total_changed, '' if args.write else '  (report only; --write to apply)'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
