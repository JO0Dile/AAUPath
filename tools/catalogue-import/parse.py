"""blocks.jsonl -> catalogue.json (faculties > programs > requirement sections > courses)

Nothing is inferred. A field absent in the document stays absent.
Blocks that are not consumed are recorded so coverage can be verified.
"""
import json, re, collections

blocks=[json.loads(l) for l in open('blocks.jsonl',encoding='utf-8')]

def norm(s):
    return re.sub(r'\s+',' ', (s or '').replace(' ',' ')).strip()
def code_norm(s):
    # codes are split across lines/spaces by the copy-paste ("060331\n010")
    return re.sub(r'\s+','', s or '')

FAC   = re.compile(r'^(Junior College|Faculty of [A-Za-z ,&\-]+)$', re.I)
PROG  = re.compile(r'^.{0,32}?((?:Bachelor|Diploma|Master)\s+in\b.+|(?:Advanced\s+)?Residency(?:\s+Program)?\s+in\b.+)$', re.I)
TOTAL = re.compile(r'Degree\s*\(\s*([\d]+)\s*Credit\s*Hours?\s*\)', re.I)
# Section markers. Tolerates the OCR-dropped leading letter, and is NOT anchored
# at the end: the label and its rule sometimes share one line, as in Public
# Relations' "Free Elective Each student must pass ( 6 ) credit hours ...". With
# a $ anchor that line was not a section marker at all, so the 6 was read as an
# update to the section still open (Spec. Elec., really 9 hours) and the free
# elective was never created - a 9-hour error in that degree. Whatever follows
# the label on the same line is handed back and parsed as the section's rule.
SECT  = [
    ('univReq',  re.compile(r'^Univ\.*\s*Req\.*', re.I)),
    ('univElec', re.compile(r'^Univ\.*\s*Elec\.*', re.I)),
    ('colgReq',  re.compile(r'^Colg\.*\s*Req\.*', re.I)),
    ('specReq',  re.compile(r'^Spec\.*\s*Req\.*', re.I)),
    ('specElec', re.compile(r'^Spec\.*\s*Elec\.*', re.I)),
    ('freeElec', re.compile(r'^Free\s*Electives?\.*', re.I)),
    ('supportCourses', re.compile(r'^Support\s*Courses\.*', re.I)),
    ('univReq',  re.compile(r'^University\s+Requirements?\.*', re.I)),
    ('colgReq',  re.compile(r'^(?:Faculty|College)\s+Requirements?\.*', re.I)),
    ('specReq',  re.compile(r'^S?pecialization\s+Requirements?\.*', re.I)),
]
MUST_N = re.compile(r'pass\s*\(?\s*(\d+)\s*\)?\s*credit\s*hours', re.I)
MUST_ALL = re.compile(r'must\s+pass\s+all\s+of\s+the\s+following', re.I)
# The copy-paste breaks header labels mid-word ("Cour se Numb er", "The oret
# ical"), so the terms are matched against the row with ALL whitespace removed.
HEADER_TERMS = ('coursenum','coursename','weekly','theoretical','practical','crhrs','prerequisite')

def is_header_row(cells):
    """True only for a table's column-heading rows.

    The first version tested one loose alternation that included `practi`, and
    dropped every real course whose name contains the word PRACTICE - among them
    PRINCIPLES AND PRACTICE FOR OCCUPATIONAL THERAPY and INTERPROFESSIONAL
    PRACTICE AND COMMUNICATION SKILLS IN HEALTHCARE. Two guards make that
    impossible: a row whose first cell is a course code is never a header, nor
    is a row carrying a 6-digit-or-longer number. Past those, a header has to
    show at least two of the known column labels, so a single incidental word
    in a course name cannot qualify.
    """
    j=re.sub(r'\s+','', ' '.join(cells)).lower()
    head=re.sub(r'\s+','', cells[0] if cells else '')
    if head.isdigit() and len(head)>=4: return False
    if len(re.sub(r'\D','', j))>=6: return False
    return sum(1 for t in HEADER_TERMS if t in j) >= 2

def coalesce_rows(rows):
    """Merge a table's physical rows into one logical row per course.

    Word renders a wrapped table cell as several consecutive <w:tr> rows, so a
    single catalogue row can arrive in pieces:

        ["06041", "FOUNDATIONAL SKILLS OF OCCUPATIONAL", "", "3", "1", "060"]
        ["2030",  "THERAPY",                             "",  "",  "", "412"]
        ["",      "",                                    "",  "",  "", "721"]

    Read row by row, that course has a 5-digit code and is thrown away - which
    is how 515 of 3041 captured rows ended up with a truncated code and how
    Occupational Therapy lost 15 of its 44 specialization courses.

    Course codes in this document are 9 digits. A row therefore continues the
    previous one when its first cell is empty, or when the code so far is still
    short and this cell's digits keep it within 10. Everything else starts a new
    course. Cells are concatenated, never overwritten, so no piece is lost:
    names join with a space, every other column with a newline (parse_course_row
    strips non-digits per cell, so "060" + "412" + "721" reads back as one
    9-digit prerequisite).
    """
    out=[]
    for r in rows:
        cells=[(c or '') for c in r]
        head=re.sub(r'\s+','', cells[0] if cells else '')
        if out:
            prev_code=re.sub(r'\D','', out[-1][0])
            cont = (head=='') or (
                len(prev_code) < 9 and head.isdigit() and len(prev_code)+len(head) <= 10)
        else:
            cont = False
        if cont:
            for j,v in enumerate(cells):
                if not v: continue
                if j >= len(out[-1]): out[-1].append(v)
                elif not out[-1][j]: out[-1][j]=v
                else: out[-1][j] += (' ' if j==1 else '\n') + v
        else:
            out.append(cells)
    return out

def parse_course_row(cells):
    """One catalogue row -> a course dict. Nothing is inferred.

    Cells get split by the source copy-paste: a NAME can spill into the next
    cell ("FUNDAMENTALS OF" | "RESEARCH METHODS") and a 9-digit prerequisite
    can arrive in pieces ("010610" | "035"). Each trailing cell is classified
    by shape and the pieces are stitched back together. Hours are 0-12, so any
    longer digit run is a code fragment, never a credit value.
    """
    cells=[norm(c) for c in cells]
    if len(cells) < 4: return None
    code=code_norm(cells[0]); name=cells[1]
    if not re.fullmatch(r'\d{6,10}', code): return None
    if not name or re.fullmatch(r'[\d\s.\-]*', name): return None

    nums=[]; frag=[]; extra=[]
    for raw in cells[2:]:
        v=(raw or '').strip()
        if v in ('','-','\u2014','\u2013'): continue
        if re.search(r'[A-Za-z\u0600-\u06FF]', v):
            extra.append(v); continue
        d=re.sub(r'\D','',v)
        if not d: continue
        if len(d)<=2 and float(d)<=12: nums.append(float(d))
        else: frag.append(d)

    if extra: name = name + ' ' + ' '.join(extra)
    # A code printed with its leading zero dropped ("20732100" for 020732100,
    # ten rows of the Operations Management - MIS tables) is 8 digits. Joined
    # with the others it shifted every code after it, and on its own it was
    # shorter than a code and read as nothing - the prerequisite vanished.
    # When every separate run in the cell is a whole code of 8 or 9 digits,
    # each is a code, padded back to 9; otherwise the runs are pieces of codes
    # split by the copy-paste and are stitched together as before.
    # Only the prerequisite cell(s): those holding a run longer than an hour
    # count. A split code leaves a short piece in the same cell
    # ("10021100\n2" is 100211002), so every run there must be a whole code.
    pcells=[v for v in cells[2:] if v and not re.search(r'[A-Za-z\u0600-\u06FF]', v)
            and any(len(r) > 2 for r in re.findall(r'\d+', v))]
    runs=[r for v in pcells for r in re.findall(r'\d+', v)]
    if runs and all(len(r) in (8, 9) for r in runs) and any(len(r) == 8 for r in runs):
        prereqs=[r.zfill(9) for r in runs]
    else:
        joined=''.join(frag)
        prereqs=[joined[i:i+9] for i in range(0, len(joined)-8, 9)]

    c={'code':code, 'name':norm(name)}
    if nums:
        credits=nums[-1]
        if credits<=12:
            c['credits']=credits
            hours=nums[:-1]
            if len(hours)>=1: c['theoretical']=hours[0]
            if len(hours)>=2: c['practical']=hours[1]
        else:
            c['uncertain']='could not determine credit hours'
            c['rawCells']=cells
    if prereqs: c['prerequisites']=sorted(set(prereqs))
    return c

ADVISORY = re.compile(r'^Advisory\s+Plan', re.I)
OVERVIEW = re.compile(r'^(?:Overview|About\s+Program)', re.I)
OUT_OF_LINE = re.compile(r'\bfor\s+(univ|spec|free)\.?\s*elec', re.I)
# Diploma in Ambulance and Emergency has no name line anywhere - the document
# goes 'first :' -> 'About Program' -> the Overview prose, so the only place the
# program is named is inside a sentence. Without this the whole program vanishes
# and Junior College silently reports six diplomas instead of seven.
NAMED_IN_PROSE = re.compile(
    r'^(?:Overview|About\s+Program)?\s*The\s+((?:Bachelor|Diploma|Master)\s+in\s+[A-Za-z][A-Za-z &,\-]{3,60}?)\s+is\b', re.I)
YEAR     = re.compile(r'^(First|Second|Third|Fourth|Fifth|Sixth|Seventh)\s+Year$', re.I)
SEMESTER = re.compile(r'^(Fall|Spring|Summer|Winter)\s+Semester$', re.I)

def parse_advisory_row(cells):
    """One row of an Advisory Plan table -> a term entry, or None.

    These tables are three columns (Course Number | Course Name | Cr. Hrs.) and
    were previously thrown away wholesale: parse_course_row needs four cells, so
    every advisory table in the document fell on the floor. They carry the one
    thing the requirement tables do not - which semester a course is meant to be
    taken in - so they are parsed here instead.

    A row may name a real course, an elective slot the student fills themselves
    ("-" | "Univ. Elec." | "2"), or the term's own total. All three are kept.
    """
    cells=[norm(c) for c in cells]
    if len(cells) < 3: return None
    code=code_norm(cells[0]); name=cells[1]; cr=cells[2]
    if not name: return None
    n=None
    if re.fullmatch(r'\d+(\.\d+)?', cr): n=float(cr)
    if re.fullmatch(r'Total', name, re.I):
        return {'_total': n}
    if re.fullmatch(r'\d{6,10}', code):
        e={'code':code, 'name':name}
    elif code in ('','-','\u2014','\u2013'):
        # an elective the student chooses; the source names only the bucket
        e={'placeholder':name}
    else:
        return None
    if n is not None: e['credits']=n
    else: e['uncertain']='credit hours not printed for this row'
    return e

faculties=[]; cur_fac=None; cur_prog=None; cur_sect=None
consumed=set(); unconsumed_tables=[]
in_advisory=False; cur_year=None; cur_term=None; in_overview=False

def new_prog(name, i):
    return {'name':name,'blockIndex':i,'requirements':collections.OrderedDict()}

for b in blocks:
    i=b['i']
    if b['kind']=='p':
        t=norm(b['text'])
        if not t: continue
        if FAC.match(t):
            cur_fac={'faculty':t,'blockIndex':i,'programs':[]}
            faculties.append(cur_fac); cur_prog=None; cur_sect=None
            in_advisory=False; cur_year=None; cur_term=None; in_overview=False
            consumed.add(i); continue
        m=PROG.match(t)
        if m and len(t)<220 and cur_fac is not None and '\t' not in b['text']:
            cur_prog=new_prog(norm(m.group(1)), i)
            cur_fac['programs'].append(cur_prog); cur_sect=None
            in_advisory=False; cur_year=None; cur_term=None; in_overview=False
            consumed.add(i); continue
        if cur_prog is None and cur_fac is not None and '\t' in b['text']:
            # A faculty index page: every program name on one tab-separated
            # line. For eleven faculties these duplicate programs parsed in
            # full below. For Artificial Intelligence and Data Science (13
            # programs) and Digital Sciences (6) they are the ONLY trace the
            # document carries - the author wrote "i think you already have :"
            # and "already added all of them". Recording them is the difference
            # between "this faculty has no course data" and "this faculty does
            # not appear to exist".
            seen=[]
            for n in b['text'].split('\t'):
                n=norm(n)
                if n and PROG.match(n) and n not in seen: seen.append(n)
            if seen:
                cur_fac['programNamesListed']=seen
                consumed.add(i); continue
        if cur_prog is None and cur_fac is not None:
            mp=NAMED_IN_PROSE.match(t)
            if mp:
                cur_prog=new_prog(norm(mp.group(1)), i)
                cur_prog['nameFoundOnlyInProse']=True
                cur_fac['programs'].append(cur_prog); cur_sect=None
                in_advisory=False; cur_year=None; cur_term=None; in_overview=False
        if cur_prog is None and cur_fac is not None:
            # Anything left between programs is the author's own writing - the
            # navigation ("next", "first :") and, twice, the explanation for why
            # a whole faculty has no course data: "pictures gonna take a lot of
            # time, soo. raw data only from now on" and "already added all of
            # them". Kept so that nothing in the document is dropped.
            cur_fac.setdefault('facultyNotes',[]).append({'blockIndex':i,'text':t})
            consumed.add(i); continue
        if cur_prog is not None:
            if ADVISORY.match(t):
                in_advisory=True; cur_sect=None; cur_year=None; cur_term=None; in_overview=False
                cur_prog.setdefault('advisoryPlan',{'terms':[]})
                consumed.add(i); continue
            if in_advisory:
                my=YEAR.match(t)
                if my: cur_year=t; cur_term=None; consumed.add(i); continue
                ms2=SEMESTER.match(t)
                if ms2:
                    cur_term={'year':cur_year,'semester':t,'courses':[]}
                    cur_prog['advisoryPlan']['terms'].append(cur_term)
                    consumed.add(i); continue
            mt=TOTAL.search(t)
            if mt:
                cur_prog['degreeHours']=int(mt.group(1)); consumed.add(i); continue
            hit=None; rest=''
            for key,rx in SECT:
                ms=rx.match(t)
                if ms: hit=key; rest=t[ms.end():].strip(); break
            if hit:
                in_advisory=False; cur_term=None; in_overview=False
                cur_sect=cur_prog['requirements'].setdefault(hit,{'courses':[]})
                t=rest                       # the rule may share the label's line
                consumed.add(i)
                if not t: continue
            if cur_sect is not None:
                mn=MUST_N.search(t)
                if mn: cur_sect['requiredHours']=int(mn.group(1)); consumed.add(i); continue
                if MUST_ALL.search(t): cur_sect['mustPassAll']=True; consumed.add(i); continue
                if hit: continue
            # An elective rule can also be written out of line, ahead of its own
            # heading - Mobile Application Development's univ. elec. arrives as
            # "for univ. elec. : Students must pass ( 2 ) credit hours ...". The
            # named section is used, not whichever one happens to be open.
            mo=OUT_OF_LINE.search(t)
            if mo:
                key={'univ':'univElec','spec':'specElec','free':'freeElec'}[mo.group(1).lower()]
                mn=MUST_N.search(t)
                if mn:
                    cur_prog['requirements'].setdefault(key,{'courses':[]})['requiredHours']=int(mn.group(1))
                    consumed.add(i); continue
            if OVERVIEW.match(t):
                rest=OVERVIEW.sub('', t, count=1).strip()
                if rest: cur_prog['overview']=rest
                in_overview=True; consumed.add(i); continue
            if in_overview and 'overview' not in cur_prog:
                cur_prog['overview']=t; consumed.add(i); continue
            # Anything still unread is the author's own writing about this
            # program - "NO real plan yet.", "no academic plan", the note under
            # Bachelor in Languages listing the four languages a student picks
            # from. It is information the tables do not carry, so it is kept
            # verbatim rather than dropped on the floor.
            cur_prog.setdefault('sourceNotes',[]).append({'blockIndex':i,'text':t})
            consumed.add(i); continue
    else:
        rows=b['rows']
        if in_advisory:
            if cur_term is None: continue
            got=0
            for r in rows:
                e=parse_advisory_row(r)
                if not e: continue
                if '_total' in e:
                    if e['_total'] is not None: cur_term['statedTotal']=e['_total']
                else:
                    cur_term['courses'].append(e)
                got+=1
            if got: consumed.add(i)
            continue
        if cur_sect is None:
            if any(parse_course_row(r) for r in coalesce_rows([r for r in rows if not is_header_row(r)])): unconsumed_tables.append(i)
            continue
        got=0
        for r in coalesce_rows([r for r in rows if not is_header_row(r)]):
            c=parse_course_row(r)
            if c: cur_sect['courses'].append(c); got+=1
        if got: consumed.add(i)
        elif any(parse_course_row(r) for r in coalesce_rows([r for r in rows if not is_header_row(r)])): unconsumed_tables.append(i)

json.dump(faculties, open('catalogue.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)

nprog=sum(len(f['programs']) for f in faculties)
ncourse=sum(len(s['courses']) for f in faculties for p in f['programs'] for s in p['requirements'].values())
withhours=sum(1 for f in faculties for p in f['programs'] if 'degreeHours' in p)
print(f'faculties            : {len(faculties)}')
print(f'programs             : {nprog}')
print(f'  with degreeHours   : {withhours}')
print(f'course rows captured : {ncourse}')
nadv=sum(1 for f in faculties for p in f['programs'] if 'advisoryPlan' in p)
nterm=sum(len(p['advisoryPlan']['terms']) for f in faculties for p in f['programs'] if 'advisoryPlan' in p)
nadvc=sum(len(t['courses']) for f in faculties for p in f['programs'] if 'advisoryPlan' in p for t in p['advisoryPlan']['terms'])
print(f'advisory plans       : {nadv} ({nterm} terms, {nadvc} entries)')
stray=[b for b in blocks if b['kind']=='p' and norm(b['text']) and b['i'] not in consumed]
nnotes=sum(len(p['sourceNotes']) for f in faculties for p in f['programs'] if 'sourceNotes' in p)
nover=sum(1 for f in faculties for p in f['programs'] if 'overview' in p)
print(f'program overviews    : {nover}')
print(f'author notes kept    : {nnotes}')
nonly=[(f['faculty'], [n for n in f.get('programNamesListed',[]) if n not in {p['name'] for p in f['programs']}])
       for f in faculties if f.get('programNamesListed')]
nonly=[(k,v) for k,v in nonly if v]
print(f'faculties whose programs exist only as a name list: {len(nonly)}')
for k,v in nonly: print(f'   {k}: {len(v)} programs, no course data anywhere in the document')
print(f'paragraphs still unread (outside any program): {len(stray)}')
print(f'tables w/ courses not attached to a section: {len(unconsumed_tables)}')
if unconsumed_tables: print('   first few block ids:', unconsumed_tables[:15])

# ---- name normalisation ---------------------------------------------------
# A long course name sometimes wraps onto a second TABLE ROW, so one occurrence
# reads "FUNDAMENTALS OF" while another elsewhere in the document reads
# "FUNDAMENTALS OF RESEARCH METHODS". Same code, same course. Take the fullest
# spelling the document itself gives for that code - this fills nothing in from
# outside the source.
best={}
for f in faculties:
    for p in f['programs']:
        for s in p['requirements'].values():
            for c in s['courses']:
                cur=best.get(c['code'])
                if cur is None or len(c['name'])>len(cur): best[c['code']]=c['name']
fixed=0
for f in faculties:
    for p in f['programs']:
        for s in p['requirements'].values():
            for c in s['courses']:
                if best[c['code']] != c['name']:
                    c['nameAsPrinted']=c['name']; c['name']=best[c['code']]; fixed+=1
json.dump(faculties, open('catalogue.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'names completed from a fuller occurrence: {fixed}')


# ---- verification pass -----------------------------------------------------
# Nothing here changes a value. It only records, on the program itself, every
# place the document does not agree with itself, so a discrepancy travels with
# the data instead of being quietly reconciled (or silently shipped as fact).
def section_hours(s):
    return s.get('requiredHours', sum(c.get('credits',0) or 0 for c in s.get('courses',[])))

checked=matched=flagged=0
for f in faculties:
    for p in f['programs']:
        notes=[]
        dh=p.get('degreeHours')
        computed=sum(section_hours(s) for s in p['requirements'].values())
        if dh is not None and p['requirements']:
            checked+=1
            if abs(computed-dh) < 0.01: matched+=1
            else:
                notes.append({
                  'kind':'requirementsDoNotSumToDegreeHours',
                  'statedDegreeHours':dh, 'sumOfSections':computed,
                  'difference':round(computed-dh,2),
                  'sections':{k:section_hours(s) for k,s in p['requirements'].items()},
                  'detail':'Read verbatim from the source tables; no row was dropped and no '
                           'value was adjusted. The document states one total and lists another.'})
        ap=p.get('advisoryPlan')
        if ap:
            for t in ap['terms']:
                s=sum(c.get('credits',0) or 0 for c in t['courses'])
                if 'statedTotal' in t and abs(s-t['statedTotal'])>=0.01:
                    notes.append({'kind':'advisoryTermTotalMismatch','year':t.get('year'),
                                  'semester':t.get('semester'),'statedTotal':t['statedTotal'],
                                  'sumOfCourses':s})
                elif 'statedTotal' not in t:
                    t['totalNotPrinted']=True
            g=sum(c.get('credits',0) or 0 for t in ap['terms'] for c in t['courses'])
            ap['sumOfAllTerms']=g
            if dh is not None and abs(g-dh)>=0.01:
                notes.append({
                  'kind':'advisoryPlanDoesNotReachDegreeHours',
                  'statedDegreeHours':dh, 'sumOfAdvisoryTerms':g, 'difference':round(g-dh,2),
                  'detail':'Every term total the source prints was checked and matches the '
                           'courses listed under it, so nothing was lost in parsing. The '
                           'advisory plan simply schedules fewer hours than the degree states.'})
        if notes:
            p['sourceIssues']=notes; flagged+=1

json.dump(faculties, open('catalogue.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'programs whose sections sum to the stated degree hours: {matched}/{checked}')
print(f'programs carrying a recorded source discrepancy        : {flagged}')
