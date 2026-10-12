#!/usr/bin/env python3
"""Build web/contacts.json from data/aaup/contacts.json.

Same reasoning as build-catalogue.py: data/ is where this is authored and
reviewed, web/ is what actually ships. Kept as its own tiny script rather
than folded into build-catalogue.py because contacts are not part of the
plan/course data model at all — mixing them would make one script own two
unrelated things.

    python3 tools/build-contacts.py

Run it after editing data/aaup/contacts.json, then commit web/contacts.json.
"""
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC = REPO / 'data' / 'aaup' / 'contacts.json'
OUT = REPO / 'web' / 'contacts.json'


def main():
    data = json.loads(SRC.read_text(encoding='utf-8'))
    cats = data.get('categories', {})
    contacts = data.get('contacts', [])

    errors = []
    for i, c in enumerate(contacts):
        if not c.get('name'):
            errors.append(f'contact #{i} has no name')
        # Most students use the app in Arabic, and an Arabic screen should not
        # carry one English word: every name, role and course is written in
        # both languages here.
        if not c.get('ar'):
            errors.append(f'{c.get("name", "#" + str(i))}: no Arabic name ("ar")')
        if c.get('role') and not c.get('roleAr'):
            errors.append(f'{c.get("name")}: role "{c["role"]}" has no Arabic ("roleAr")')
        if len(c.get('courses') or []) != len(c.get('coursesAr') or []):
            errors.append(f'{c.get("name")}: "coursesAr" must name the same courses as "courses", in Arabic')
        if c.get('category') not in cats:
            errors.append(f'{c.get("name", "#" + str(i))}: unknown category "{c.get("category")}"')
        # The one rule this file exists to enforce: no phone numbers ever
        # reach the public bundle, even if someone pastes one in later.
        for key in c:
            if 'phone' in key.lower() or 'whatsapp' in key.lower():
                errors.append(f'{c.get("name")}: field "{key}" looks like a phone number — '
                               'this file is public. Remove it and keep it in the private sheet instead.')

    if errors:
        print('build-contacts.py: refusing to write web/contacts.json —')
        for e in errors:
            print('  -', e)
        return 1

    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {OUT.relative_to(REPO)} — {len(contacts)} contact(s) in {len(cats)} categories')
    return 0


if __name__ == '__main__':
    sys.exit(main())
