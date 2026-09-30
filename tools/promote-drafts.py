#!/usr/bin/env python3
"""Put next year's plan live on its date (round 10, idea 5).

A dean or the admin prepares next year's plan as a draft inside the major's
file ("draft": {goesLive, courses, prerequisites}). Students keep seeing
today's plan until the date. On or after it, this script makes the draft the
plan and removes the draft.

The publish-catalogue workflow runs it every day, then rebuilds plans.json,
so each phone takes the new plan like any other update.

Safe to run any day: a draft whose date has not come does nothing.
"""
import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def promote(major, today):
    d = major.get('draft')
    if not d or not d.get('goesLive') or d['goesLive'] > today:
        return False
    major['courses'] = d.get('courses') or []
    major['prerequisites'] = d.get('prerequisites') or []
    del major['draft']
    return True


def main():
    today = sys.argv[1] if len(sys.argv) > 1 else datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    moved = []
    for path in sorted(ROOT.glob('data/*/majors/*.json')):
        major = json.loads(path.read_text(encoding='utf-8'))
        if promote(major, today):
            path.write_text(json.dumps(major, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            moved.append(str(path.relative_to(ROOT)))
    print('went live:', ', '.join(moved) if moved else 'nothing today')
    return 0


if __name__ == '__main__':
    sys.exit(main())
