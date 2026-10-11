#!/usr/bin/env python3
"""Read aaup.edu's "Academic Plan" pages into site-plans.json.

    python3 tools/catalogue-import/parse-site.py PAGES PROGRAMS_JSON [--captures FILE]

PAGES          either aaup-academic-plans.json - every page, saved in one go by
               the script the admin Check card hands out, run in a browser on
               www.aaup.edu - or a directory of single pages named after the
               program's address: bachelor-accounting.html is the page at
               https://www.aaup.edu/bachelor-accounting/curriculum
PROGRAMS_JSON  [[faculty, name, url], ...] read off https://www.aaup.edu/academic-programs,
               plus "ar" ([[faculty, name, url], ...] off the Arabic list) so each
               program and faculty also carries its Arabic name
--captures     lines of "<web archive timestamp> <slug>", recorded per page

Why this source. The catalogue document (data_600.docx, the "600 pages") was
exported from the same programs, but it is a snapshot, and parsing it put some
prerequisites one row off - Bachelor in Accounting's 020211030 landed on the
course below the one the university lists it under. Each program's Academic
Plan page is generated from the registration database: every course is a table
row with its own number, hours and a cell holding the prerequisite course
NUMBERS, so nothing has to be inferred from layout.

www.aaup.edu answers 400 to every request from a data centre, so the pages
are read in a browser on the site (the file above), or from Web Archive
captures. Each program records when and how it was read (readAt, or capture),
so any figure here can be checked against the page it came from.

A page with no tables (Bachelor in AI and Robotics Engineering, at the time of
writing) is kept with "published": false: the program exists, the university
has not published its plan, and nothing is invented for it.
"""
import argparse
import html
import json
import os
import re
import sys
import urllib.parse

# The tab labels the pages use for each requirement table, and the keys the
# rest of the pipeline already uses for the same buckets.
TAB = {
    'Univ. Req.': 'univReq', 'Univ. Elec.': 'univElec',
    'Colg. Req.': 'colgReq', 'Colg. Elec.': 'colgElec',
    'Spec. Req.': 'specReq', 'Spec. Elec.': 'specElec',
    'Dept. Req.': 'deptReq', 'Dept. Elec.': 'deptElec',
    'Minor Req.': 'minorReq', 'Minor Elec.': 'minorElec',
    'Supp. Req.': 'supportCourses', 'Free Elec.': 'freeElec',
}


def clean(t):
    return html.unescape(' '.join(re.sub(r'<[^>]+>', ' ', t).split()))


def number(v):
    v = v.strip()
    if v in ('', '-'):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def rows(tbody):
    """Each <tr>: number, name, theoretical, practical, credit hours, prerequisites."""
    out = []
    for tr in re.findall(r'<tr>(.*?)</tr>', tbody, re.S):
        code = re.search(r'<td class="course-id">\s*(\S+?)\s*</td>', tr)
        if not code:
            continue
        name = re.search(r'<td class="course-name">(.*?)</td>', tr, re.S)
        cells = re.split(r'<td>', tr)[1:]
        plain = [clean(c.split('</td>')[0]) for c in cells]
        c = {'code': code.group(1), 'name': clean(name.group(1)) if name else '',
             'credits': number(plain[2]) if len(plain) > 2 else None,
             'theoretical': number(plain[0]) if plain else None,
             'practical': number(plain[1]) if len(plain) > 1 else None}
        last = cells[-1] if cells else ''
        pre = re.findall(r'<p class="course-id">\s*(\S+?)\s*</p>', last)
        if pre:
            c['prerequisites'] = pre
        else:
            # "-" is the page saying there is none. Anything else is text the
            # page printed instead of a course number; kept, never guessed at.
            text = clean(last)
            if text not in ('', '-'):
                c['prerequisiteText'] = text
        out.append(c)
    return out


def parse(page):
    """{degreeHours, plans: [{bucket: section}]} - one entry per plan on the page."""
    page = re.sub(r'<(p|td) class="d-none course-desc">.*?</\1>', '', page, flags=re.S)
    m = re.search(r'Total Credit Hours Required[^(]*\(\s*(\d+)', page)
    tabs = {t.group(1): clean(t.group(2))
            for t in re.finditer(r'data-bs-target="#([^"]+)">(.*?)</a>', page, re.S)}
    panes = [(p.start(), p.group(1)) for p in re.finditer(r'<div class="tab-pane[^"]*" id="([^"]+)"', page)]
    plans = {}
    unknown = []
    for i, (start, pid) in enumerate(panes):
        end = panes[i + 1][0] if i + 1 < len(panes) else len(page)
        chunk = page[start:end]
        ds = re.match(r'dataset-(\d+)', pid)
        ds = ds.group(1) if ds else '1'
        label = tabs.get(pid, '')
        key = TAB.get(label)
        if not key:
            unknown.append(label)
            continue
        rule = re.search(r'<p class="px-3">(.*?)</p>', chunk, re.S)
        rule = clean(rule.group(1)) if rule else ''
        body = re.search(r'<tbody>(.*?)</tbody>', chunk, re.S)
        sec = {'label': label, 'rule': rule, 'courses': rows(body.group(1) if body else '')}
        hours = re.search(r'\(\s*(\d+)\s*\)\s*credit hours', rule)
        if hours:
            sec['requiredHours'] = int(hours.group(1))
        elif 'all of the following' in rule:
            sec['mustPassAll'] = True
        plans.setdefault(ds, {})[key] = sec
    # Free electives are not a tab: a sentence giving the hours, then a table
    # of courses that do NOT count towards them.
    free = re.search(r'<h2 class="small m-0">\s*Free Elective\s*</h2>(.*?)(?=<h2 class="small m-0">|$)', page, re.S)
    if free:
        hours = re.search(r'\(\s*(\d+)\s*\)\s*credit hours', clean(free.group(1)))
        body = re.search(r'<tbody>(.*?)</tbody>', free.group(1), re.S)
        fe = {'label': 'Free Elec.', 'requiredHours': int(hours.group(1)) if hours else None,
              'courses': [], 'excluded': [c['code'] for c in rows(body.group(1))] if body else []}
        for p in plans.values():
            p['freeElec'] = fe
    return {'degreeHours': int(m.group(1)) if m else None,
            'plans': [plans[k] for k in sorted(plans, key=int)],
            'unknownTabs': unknown}


def slug_of(url):
    return urllib.parse.unquote(url.rstrip('/').rsplit('/', 1)[1]).replace('\u200b', '')


def loose(slug):
    """A program address without its punctuation: the Arabic list still links
    some programs at older addresses with an en dash in them
    (bachelor-digital-sciences-%E2%80%93-specialization-digital-marketing)."""
    return re.sub(r'[^a-z0-9]', '', slug.lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pages')
    ap.add_argument('programs')
    ap.add_argument('--captures')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'site-plans.json'))
    args = ap.parse_args()
    listing = json.load(open(args.programs, encoding='utf-8'))
    ar = {loose(slug_of(u)): (f, n) for f, n, u in listing.get('ar', [])}
    browser, read_at = None, None
    if os.path.isfile(args.pages):
        saved = json.load(open(args.pages, encoding='utf-8'))
        read_at = saved.get('savedAt')
        browser = {slug_of(k): (v or {}).get('html') or '' for k, v in saved['pages'].items()}
    caps = {}
    if args.captures:
        for line in open(args.captures, encoding='utf-8'):
            parts = line.split()
            if len(parts) >= 2:
                caps[parts[1]] = parts[0]
    out = []
    for faculty, name, url in listing['en']:
        if faculty == 'Faculty of Graduate Studies':
            continue
        slug = slug_of(url)
        if browser is not None:
            if slug not in browser:
                print('no page saved for', name, file=sys.stderr)
                continue
            got = parse(browser[slug])
        else:
            path = os.path.join(args.pages, slug + '.html')
            if not os.path.exists(path):
                print('no page saved for', name, file=sys.stderr)
                continue
            got = parse(open(path, encoding='utf-8', errors='replace').read())
        far, nar = ar.get(loose(slug), (None, None))
        p = {'faculty': faculty, 'facultyAr': far, 'name': name.replace('\u200b', ''), 'nameAr': nar,
             'url': url.replace('%E2%80%8B', ''), 'page': url.rstrip('/') + '/curriculum'}
        ts = caps.get(slug)
        if read_at:
            p['readAt'] = read_at
        elif ts:
            p['capture'] = 'https://web.archive.org/web/%s/%s' % (ts, p['page'])
            p['capturedAt'] = '%s-%s-%sT%s:%s:%sZ' % (ts[:4], ts[4:6], ts[6:8], ts[8:10], ts[10:12], ts[12:14])
        p['degreeHours'] = got['degreeHours']
        p['published'] = bool(got['plans'])
        if got['plans']:
            p['requirements'] = got['plans'][-1]
            if len(got['plans']) > 1:
                p['otherPlans'] = got['plans'][:-1]
        if got['unknownTabs']:
            p['unknownTabs'] = got['unknownTabs']
        out.append(p)
    json.dump({'source': 'Each program\u2019s Academic Plan page on www.aaup.edu'
                         + (', read in a browser on the site at ' + read_at if read_at else ', read from Web Archive captures'),
               'programs': out}, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('%d programs, %d with a published plan -> %s'
          % (len(out), sum(p['published'] for p in out), os.path.relpath(args.out)))


if __name__ == '__main__':
    main()
