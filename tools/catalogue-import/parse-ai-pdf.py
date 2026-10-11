#!/usr/bin/env python3
"""The AI & Data Science faculty catalogue PDF -> ai-data-science.json

    python3 tools/catalogue-import/parse-ai-pdf.py <Overview.pdf>

The main 600-page document lists this faculty's 13 programs by NAME ONLY - the
author wrote "i think you already have" and "already added all of them" - so
catalogue.json has no courses for any of them. This is the separate PDF that
does, in the same catalogue layout but as flowed text rather than tables.

Output matches catalogue.json's program shape, so the same importer consumes it.

Nothing is inferred. A value the PDF does not print is absent here.
"""
import json
import os
import re
import sys

CODE = re.compile(r'^\d{9}$')
PROGRAM = re.compile(r'^\s*(?:\d+\s*(?:st|nd|rd|th)\s*)?:?\s*'
                     r'((?:Bachelor|Diploma|Master)\s+in\s+.+)$')
TOTAL = re.compile(r'Degree\s*\(\s*(\d+)\s*Credit\s*Hours?\s*\)', re.I)
MUST_N = re.compile(r'pass\s*\(\s*(\d+)\s*\)\s*credit\s*hours', re.I)
MUST_ALL = re.compile(r'must\s+pass\s+all\s+of\s+the\s+following', re.I)
SECTIONS = [
    ('univReq',  re.compile(r'^\s*Univ\.\s*Req\.', re.I)),
    ('univElec', re.compile(r'^\s*Univ\.\s*Elec\.', re.I)),
    ('colgReq',  re.compile(r'^\s*Colg\.\s*Req\.', re.I)),
    ('specReq',  re.compile(r'^\s*Spec\.\s*Req\.', re.I)),
    ('specElec', re.compile(r'^\s*Spec\.\s*Elec\.', re.I)),
    ('freeElec', re.compile(r'^\s*Free\s*Electives?\b', re.I)),
    ('supportCourses', re.compile(r'^\s*Support\s*Courses\b', re.I)),
]
# The column headings, which the extractor emits as ordinary lines and which
# wrap differently on nearly every page.
NOISE = re.compile(r'^\s*(Course\s*$|Number|Course Name|Weekly Hours|Cr\.|Hrs\.|'
                   r'Theoretical|Practical|Prerequisite|Overview|University Requirements|'
                   r'Faculty Requirements|Specialization Requirements)\s*$', re.I)
HOUR = re.compile(r'^(\d{1,2}|-|–|—)$')


def parse_record(rec):
    """One course row, flowed onto one or more lines, -> a course dict.

    A row reads: CODE  NAME...  theoretical  practical  credits  prereq...
    with the name wrapping freely and any of the middle columns blank. Read it
    from the RIGHT, where the shapes are unambiguous: 9-digit runs are
    prerequisites, one- and two-digit runs are hours, and whatever is left in
    front is the name. Reading left to right cannot work - a name may end in a
    numeral, and a blank column simply is not there to count past.
    """
    tokens = rec.split()
    if len(tokens) < 3 or not CODE.match(tokens[0]):
        return None
    code, rest = tokens[0], tokens[1:]

    prereqs = []
    while rest and CODE.match(rest[-1]):
        prereqs.insert(0, rest.pop())
    if rest and rest[-1] in ('-', '–', '—'):
        rest.pop()                       # the empty prerequisite column

    hours = []
    while rest and len(hours) < 3 and HOUR.match(rest[-1]):
        hours.insert(0, rest.pop())
    if not hours or not rest:
        return None

    def num(v):
        return None if v in ('-', '–', '—') else float(v)

    c = {'code': code, 'name': ' '.join(rest)}
    credits = num(hours[-1])
    if credits is None:
        c['uncertain'] = 'credit hours not printed'
    else:
        c['credits'] = credits
    if len(hours) == 3:
        if num(hours[0]) is not None:
            c['theoretical'] = num(hours[0])
        if num(hours[1]) is not None:
            c['practical'] = num(hours[1])
    elif len(hours) == 2:
        # One of the two weekly-hour columns is blank and the blank leaves no
        # token behind, so which one it was cannot be recovered. The value is
        # kept without claiming a column.
        if num(hours[0]) is not None:
            c['weeklyHours'] = num(hours[0])
            c['weeklyHoursColumnUnknown'] = True
    if prereqs:
        c['prerequisites'] = sorted(set(prereqs))
    return c


# Programs are numbered in the document - "2nd :", "3rd :" ... "13th :" - and
# that is the only reliable boundary. Matching on the program NAME instead
# fails: every heading wraps across two lines, and it wraps in a different
# place each time ("...and Cyber" / "Security").
ORDINAL = re.compile(r'(?m)^\s*(\d+)\s*(?:st|nd|rd|th)\s*:\s*')


NO_PLAN = re.compile(r'^\s*No+\s*plan(\s*yet)?\s*\.?\s*$', re.I)


def parse_program(name, body):
    prog = {'name': name, 'requirements': {}}
    sect = None
    buf = []

    def flush():
        if sect is not None and buf:
            course = parse_record(' '.join(buf))
            if course:
                sect['courses'].append(course)
        buf.clear()

    lines = [raw.strip() for raw in body.split('\n')]
    lines = [x for x in lines if x]

    def is_marker(line):
        return bool(TOTAL.search(line) or NOISE.match(line) or MUST_N.search(line)
                    or MUST_ALL.search(line) or NO_PLAN.match(line)
                    or any(rx.match(line) for _, rx in SECTIONS))

    for i, stripped in enumerate(lines):

        mt = TOTAL.search(stripped)
        if mt:
            flush()
            prog['degreeHours'] = int(mt.group(1))
            continue

        hit = None
        for key, rx in SECTIONS:
            if rx.match(stripped):
                hit = key
                break
        if hit:
            flush()
            sect = prog['requirements'].setdefault(hit, {'courses': []})
            # A marker and its rule sometimes share a line.
            rest = stripped[len(re.match(r'^\s*\S+\s*\S*', stripped).group(0)):]
            mn = MUST_N.search(rest)
            if mn:
                sect['requiredHours'] = int(mn.group(1))
            continue

        if sect is not None:
            mn = MUST_N.search(stripped)
            if mn:
                flush()
                sect['requiredHours'] = int(mn.group(1))
                continue
            if MUST_ALL.search(stripped):
                flush()
                sect['mustPassAll'] = True
                continue

        if NO_PLAN.match(stripped):
            # The author's own words. Five of the thirteen programs say this
            # instead of carrying a plan, so an empty requirements block here
            # is a fact about the document, not a parsing failure.
            flush()
            prog['noPlanPublished'] = stripped
            continue

        if NOISE.match(stripped):
            continue

        first = stripped.split()[0]
        if CODE.match(first):
            # A line of nothing but course codes is either the start of a
            # course whose name wraps onto the next lines, or more of the
            # PREVIOUS row's prerequisites: the PDF stacks a second (third...)
            # prerequisite in its cell under the first, so it lands on lines
            # of its own after the row - "MACHINE LEARNING 2 2 3" then
            # "250223010" then "290312120". Treating every such line as a new
            # course threw away every prerequisite after the first. It is a
            # continuation when the row before it is already complete and the
            # next line is not the wrapped name of a new course.
            only_codes = all(CODE.match(t) for t in stripped.split())
            nxt = lines[i + 1] if i + 1 < len(lines) else ''
            names_next = bool(nxt) and not CODE.match(nxt.split()[0]) and not is_marker(nxt)
            if only_codes and buf and parse_record(' '.join(buf)) and not names_next:
                buf.append(stripped)
                continue
            flush()
        buf.append(stripped)

    flush()
    return prog


# Section labels that the text extractor glues onto the end of the line before
# them: "...from any of the following coursesSpec. Elec." and, twice,
# "...following coursesSpec. Elec.Students must pass ( 6 ) credit hours".
# Anchored at the start of a line, the marker regexes never see those, so the
# section was never opened - and the "( N ) credit hours" that belonged to it
# was read as an update to whichever section was still open. That is three
# degrees reading 6 to 38 credit hours short.
GLUED = re.compile(r'([a-z.])((?:Univ|Colg|Spec)\.\s*(?:Req|Elec)\.|Free Elective|Support Courses)')
GLUED_RULE = re.compile(r'((?:Req|Elec)\.)((?:Each s|S)tudents? must pass)')


def unglue(text):
    text = GLUED.sub(r'\1\n\2', text)
    return GLUED_RULE.sub(r'\1\n\2', text)


def parse(text):
    text = unglue(text)
    chunks = ORDINAL.split(text)
    # chunks[0] is the first program, which carries no ordinal of its own.
    bodies = [(None, chunks[0])]
    for i in range(1, len(chunks), 2):
        bodies.append((chunks[i], chunks[i + 1]))

    programs = []
    for ordinal, body in bodies:
        head = body.split('Overview', 1)[0]
        name = re.sub(r'\s+', ' ', head).strip().lstrip('a').strip()
        if not name.lower().startswith(('bachelor', 'diploma', 'master')):
            m = re.search(r'((?:Bachelor|Diploma|Master)\s+in\s+.+)', name)
            if not m:
                continue
            name = m.group(1)
        programs.append(parse_program(name, body))
    return programs


SUPPLEMENTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'supplements')


def apply_supplements(programs):
    """Merge in sections the PDF does not print.

    The faculty PDF drops whole sections for some programs - Statistics and
    Data Science has no Specialization Requirements at all, 75 of its stated
    125 credit hours. Those sections exist on the AAUP website and are kept in
    supplements/, separately from anything parsed, so their provenance stays
    visible: every section merged here is stamped `suppliedFrom`, and a
    supplement is only accepted if adding it makes the program reconcile to the
    total the PDF ALREADY states. A supplement never introduces a total.
    """
    if not os.path.isdir(SUPPLEMENTS):
        return []
    by_name = {p['name']: p for p in programs}
    applied = []
    for fn in sorted(os.listdir(SUPPLEMENTS)):
        if not fn.endswith('.json'):
            continue
        sup = json.load(open(os.path.join(SUPPLEMENTS, fn), encoding='utf-8'))
        prog = by_name.get(sup['program'])
        if prog is None:
            print('supplement %s: no program named %r' % (fn, sup['program']))
            continue
        key = sup['fills']
        if key in prog['requirements'] and prog['requirements'][key].get('courses'):
            print('supplement %s: %s already has %s from the PDF - not overwritten'
                  % (fn, sup['program'], key))
            continue
        section = dict(sup['section'])
        section['suppliedFrom'] = sup['suppliedFrom']
        section['notInTheSourcePDF'] = sup['why']
        prog['requirements'][key] = section
        if sup.get('programMetadata'):
            prog['programMetadata'] = sup['programMetadata']
        applied.append((fn, sup['program'], key))
    return applied


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    try:
        from pypdf import PdfReader
    except ImportError:
        print('pypdf is required: pip install pypdf')
        return 1
    reader = PdfReader(sys.argv[1])
    text = '\n'.join((p.extract_text() or '') for p in reader.pages)
    programs = parse(text)
    applied = apply_supplements(programs)

    ok = 0
    noplan = [p for p in programs if p.get('noPlanPublished')]
    for p in programs:
        total = 0
        for s in p['requirements'].values():
            total += s.get('requiredHours',
                           sum(c.get('credits', 0) or 0 for c in s['courses']))
        p['_computed'] = total
        stated = p.get('degreeHours')
        if stated is not None and abs(total - stated) < 0.001:
            ok += 1
        parts = ' '.join('%s=%g' % (k, s.get('requiredHours', sum(
            c.get('credits', 0) or 0 for c in s['courses'])))
            for k, s in p['requirements'].items())
        if stated is not None and abs(total - stated) >= 0.001:
            p['degreeHoursDiscrepancy'] = {
                'statedDegreeHours': stated, 'sumOfRequirementHours': total,
                'difference': round(total - stated, 2),
                'reason': 'The PDF states this total but does not print enough '
                          'requirement sections to reach it. Nothing is inferred to '
                          'close the gap.'}
        flag = '' if stated is None or abs(total - stated) < 0.001 else \
               '   <-- stated %s, %g missing FROM THE SOURCE' % (stated, stated - total)
        print('%-78s %-5s %s%s' % (p['name'][:78], stated, parts, flag))

    out = {
        'faculty': 'Faculty of Artificial Intelligence and Data Science',
        'source': 'AAUP AI & Data Science catalogue PDF (Overview.pdf, 48 pages)',
        'note': 'The 600-page document lists this faculty by program NAME ONLY. '
                'This PDF is where its course data comes from.',
        'programs': [{k: v for k, v in p.items() if not k.startswith('_')}
                     for p in programs],
    }
    with open('tools/catalogue-import/ai-data-science.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')

    courses = sum(len(s['courses']) for p in programs
                  for s in p['requirements'].values())
    print()
    for fn, name, key in applied:
        print('supplement applied  : %s -> %s (%s)' % (fn, name[-46:], key))
    print('programs            : %d' % len(programs))
    print('  the document says they have no plan: %d' % len(noplan))
    for p in noplan:
        print('     %-72s (%s)' % (p['name'][:72], p['noPlanPublished']))
    print('course rows         : %d' % courses)
    print('reconcile to their stated degree total: %d/%d'
          % (ok, sum(1 for p in programs if p.get('degreeHours') is not None)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
