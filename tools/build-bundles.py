#!/usr/bin/env python3
"""Build web/bundles/*.js from the individual modules in web/js/.

Every feature still lives in its own small file under web/js/ — that stays
the place to read and edit code, exactly as before. This script only decides
which of those files ship together as one HTTP request, and strips the
whitespace and comments out of the result.

Before this, a first-time visitor's browser made 68 separate requests for
web/js/*.js (plus one for the CSS) before the service worker had anything
cached, and paid that again in full every time the cache version bumped.
Grouping into a handful of bundles, and minifying what shows up in each of
them, cuts that to a handful of requests and roughly a third of the bytes.

WHY GROUPED THIS WAY, NOT BY NUMBER

The 00-70 numbering is a load-order convention, not a relatedness one — a
plan-editing file and a plan-*viewing* file can sit ten numbers apart. These
six groups are what a student (or the next person reading this repo) would
actually call "the same feature area": editing your own data, viewing/using
a plan, the app's own chrome and settings, admin, and everything that talks
to a server. Concatenation order INSIDE a group still follows the original
numbering, since that is the one thing already known to work; order BETWEEN
groups turned out not to matter — index.html has shipped js/05..08 loading
dead last, after js/70, for a while now with nothing depending on it loading
earlier, which is the working precedent this script leans on.

js/00-diagnostics.js and js/01-catalogue.js are deliberately left out of
every group and stay as their own two <script> tags in index.html's <head>:
one has to be the literal first thing that runs (it is what records a
module failing to load at all), and the other defines window.APP_* before
anything else, inline scripts included, might read it.

    python3 tools/build-bundles.py

Run it after editing anything under web/js/, then commit web/bundles/*.js.
Requires `npx esbuild` (network access to npm on first run, same as the
eslint/stylelint/htmlhint checks already in CI).
"""
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
JS = REPO / 'web' / 'js'
OUT = REPO / 'web' / 'bundles'

# Order between groups is core -> shell -> edit -> plan -> server -> admin in
# index.html; order WITHIN a group is the list order below, which is the
# original 00-70 numbering restricted to that group's files.
GROUPS = {
    'core': [
        '02-shared-cross.js', '04-icons.js', '09-language.js', '10-progress-core.js', '11-module11.js',
        '14-storage.js', '60-backbar.js', '70-skeleton.js', '71-qrcode.js',
    ],
    'shell': [
        '15-student.js', '17-theme.js', '22-feedback.js', '26-dev.js', '29-home.js',
        '32-tutorial.js', '37-sidebar.js', '38-accounts.js', '44-fix-analyzers.js',
        '45-fix.js', '55-onboarding.js', '56-story-stack.js', '61-theme-custom.js',
        '68-contacts.js', '89-install.js',
    ],
    'edit': [
        '12-removed.js', '13-pair-mode-toggle.js', '16-data.js', '20-personal.js',
        '21-course-modal-extras.js', '33-plan-editor.js', '34-structure.js',
        '35-links.js', '39-orphans.js', '40-retakes.js',
    ],
    'plan': [
        '03-search.js', '05-collapse-finished-years.js', '06-per.js',
        '07-plan-overview-print.js', '08-celebrations.js', '18-gpa.js', '19-audit.js',
        '24-achievements.js', '25-advisor.js', '27-community.js',
        '28-imported.js', '36-dashboard.js', '49-course-detail.js', '50-whats-next.js',
        '51-gpa-studio.js', '54-prereq-graph.js', '57-card-input.js',
        '62-change-plan.js', '63-whatif.js', '64-milestones.js',
        '66-graduation.js', '67-gpa-target.js', '69-phone-header.js', '72-share.js',
        '74-course-gestures.js', '75-about.js', '76-course-pairs.js', '77-english-level.js',
        '78-you-are-here.js', '79-plan-filter.js', '81-calendar.js', '82-follow.js',
        '84-autobackup.js', '85-carry.js', '86-prereq-report.js',
        '87-plan-health.js', '88-empty.js', '90-task-home.js',
    ],
    'server': [
        '30-sync.js', '31-collect.js', '41-assistant-kb.js', '42-assistant.js',
        '43-assistant-ui.js', '46-assistant-ai.js', '52-cloud.js',
        '58-wordlist-data.js', '58-wordfilter.js', '59-thoughts.js', '73-contribute.js',
    ],
    'admin': [
        '48-admin.js',
    ],
}


def main():
    all_js = {p.name for p in JS.glob('*.js')}
    grouped = {name for files in GROUPS.values() for name in files}
    extra = grouped - all_js
    missing = all_js - grouped - {'00-diagnostics.js', '01-catalogue.js'}
    if extra:
        print('build-bundles.py: these are listed in a group but do not exist in web/js/:')
        for f in sorted(extra):
            print('  -', f)
        return 1
    if missing:
        print('build-bundles.py: these exist in web/js/ but are not in any group '
              '(and are not 00-diagnostics.js / 01-catalogue.js):')
        for f in sorted(missing):
            print('  -', f)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    for group, files in GROUPS.items():
        parts = []
        for name in files:
            src = (JS / name).read_text(encoding='utf-8')
            parts.append('// ---- ' + name + ' ----\n' + src)
        concatenated = '\n'.join(parts)

        result = subprocess.run(
            ['npx', '--yes', 'esbuild@0.24', '--loader=js',
             '--minify-whitespace', '--minify-syntax'],
            input=concatenated, capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f'build-bundles.py: esbuild failed on group "{group}":')
            print(result.stderr)
            return 1

        out_path = OUT / (group + '.bundle.js')
        out_path.write_text(result.stdout, encoding='utf-8')
        print(f'wrote {out_path.relative_to(REPO)} — {len(files)} file(s), '
              f'{len(concatenated)} -> {len(result.stdout)} bytes')

    return 0


if __name__ == '__main__':
    sys.exit(main())
