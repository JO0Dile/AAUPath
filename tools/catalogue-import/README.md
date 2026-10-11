# AAUP catalogue import

Turns the university catalogue document into structured data.

    python3 extract.py   # docx  -> blocks.jsonl    (lossless, document order)
    python3 parse.py     # blocks -> catalogue.json (faculties>programs>sections>courses)
    python3 index.py     # catalogue -> courses-index.json (one entry per course code)

    # The AI & Data Science faculty comes from its own PDF, not the docx:
    python3 parse-ai-pdf.py sources/ai-data-science-faculty.pdf

`blocks.jsonl` and the AI faculty PDF are both committed, so every step runs
without the 4.6 MB source document.

## What is in catalogue.json
13 faculties, 68 programs, 3,076 course entries, 1,797 distinct courses.
Also 37 program overviews and 99 of the author's own notes about individual
programs — "NO real plan yet.", "no academic plan", the note under Bachelor in
Languages listing the four languages a student must pick one of.

Requirement sections per program: `univReq`, `univElec`, `colgReq`, `specReq`,
`specElec`, `freeElec`, `supportCourses` — each with `mustPassAll` or
`requiredHours`, and its course list.

20 programs also carry an `advisoryPlan`: the term-by-term schedule the
university recommends, as `terms[]` of `{year, semester, statedTotal, courses}`.
This is the only place the document says *when* a course is meant to be taken.
Terms include the elective slots the student fills themselves, kept as
`{placeholder: "Univ. Elec.", credits: 2}` because the source names the bucket
and not a course.

## from-images/
Seven Junior College diplomas exist in the document only as screenshots. They
were read image by image and are stored here in the same shape, with
`advisoryPlan` where the source has one. Six reconcile to their stated degree
total exactly; the seventh is cut off in the source and says so:

| program | stated | computed |
|---|---|---|
| Dental Assistance | 64 | 64 |
| Mobile Application Development | 69 | 69 |
| Property Valuation | 74 | 74 |
| Cosmetics and Skincare | 72 | 72 |
| Dental Technology | 78 | 78 |
| Occupational Health and Safety | 72 | 72 |
| Ambulance and Emergency | 73 | 38 — source truncated, see below |

**Diploma in Ambulance and Emergency** was almost lost entirely. It is the only
program in the document with no name line: the pages run "first :" → "About
Program" → the Overview prose, so the words "Diploma in Ambulance and Emergency"
appear nowhere except inside a sentence. It surfaced only by auditing the
paragraphs no parser rule had read. Its Spec. Req. screenshot stops mid-table
and its advisory plan shows one term, so 35 of its 73 credit hours are missing
**from the source**; the gap is recorded in `incompleteInSource` and nothing was
invented to close it.

`program-metadata.json` holds the eight further programs whose only image is a
metadata card — no course table exists for them anywhere in the document, in
text or image. They are marked `coursesInSource: false`.

## Verification
- 0 tables containing courses left unattached to a program/section.
- 0 rows with an impossible credit value; 0 rows flagged uncertain.
- Every one of the 3,076 course codes is 9 digits, as the source prints them.
- Every course code resolves to exactly one name, and to one set of hours:
  `index.py` reports 0 courses where two programs disagree on any field.
- **49 of the 50** programs that state a degree total reconcile to it exactly.
- **182 of 182** advisory-plan terms that print a total match the courses listed
  under them. (15 further terms print no total; that is a source omission.)
- **0 paragraphs and 0 tables in the entire document are left unread.** Every
  block of the source now lands somewhere: a course, a section rule, an
  overview, a program note, a faculty note, or a faculty index list.

## Recorded source discrepancies
Seven programs carry a `sourceIssues` array. Nothing in it is corrected — the
discrepancy is recorded so it travels with the data:

- **Bachelor in Fiqh And Law** states 133 credit hours; its sections list 223.
  The Spec. Req. table holds 55 distinct courses at 3 hours each (28 Law,
  27 Fiqh) with no duplicates and nothing bleeding in from a neighbouring
  program. The document states one total and lists another.
- Six programs whose advisory plan schedules fewer hours than the degree states
  (by 2 to 16). Every printed term total in them matches, so nothing was lost in
  parsing; the university's own recommended schedule simply does not place every
  required hour.

Two of the six image-read programs — Property Valuation and Dental Technology —
carry **two complete academic plans each**, with different course-code families
and different totals. That is deliberate: the document says so in the author's
own words ("this one have 2 academic plans 👍 first one : … now the second
plan:"). Both are stored; the one its advisory plan corroborates is primary and
the other sits under `alternatePlanA`. Dental Technology's prose states a third
figure again (69 hours), recorded in its `sourceConflict`.

## ai-data-science.json
The main document lists the Faculty of Artificial Intelligence and Data Science
by program NAME ONLY. Its course data comes from a separate 48-page faculty PDF
(`sources/ai-data-science-faculty.pdf`), parsed by `parse-ai-pdf.py` into the
same program shape.

13 programs, 482 course rows.

A course with more than one prerequisite prints them stacked in one cell, so
the second and later ones arrive as lines of bare codes after the row
("MACHINE LEARNING 2 2 3" / "250223010" / "290312120"). The parser used to read
each such line as a new course and drop it, losing 46 prerequisites - Machine
Learning in AI and Medical Sciences among them. A line of bare codes is now
read as more of the previous row's prerequisites unless the next line is the
wrapped name of a new course. `tools/sync-prerequisites.py` then makes every
major's prerequisites match its source program. **Five carry no plan and say so** in the
document's own words — "No plan", "No plan yet", "Noo plan yet". Of the eight
that do, five reconcile to their stated degree total exactly:

| program | stated | computed |
|---|---|---|
| AI and Cyber Security | 127 | 127 |
| AI and Innovation | 127 | 127 |
| AI and Financial Technology | 121 | 121 |
| **AI and Robotics** | **128** | **128** |
| Finance and Data Science | 127 | 127 |
| Statistics and Data Science | 125 | 125 — with a supplement, see below |
| AI and Medical Sciences | 129 | 129 — with a supplement, see below |
| Financial Engineering | 133 | 131 |

The one remaining shortfall is a gap in the PDF itself and carries
`degreeHoursDiscrepancy`. Nothing is inferred to close it.

`supplements/` holds sections the sources do not carry, supplied from the AAUP
website and kept apart from anything parsed so their provenance stays visible.
A supplement is only accepted if adding it makes the program reconcile to the
total the source ALREADY states — it never introduces a total of its own.
Two programs need one. The PDF runs each of their Colg. Req. tables straight
into Univ. Elec. and prints no Specialization Requirements section at all:

- Statistics and Data Science — 22 courses, 75 credit hours
- AI and Medical Sciences — 14 courses, 32 credit hours

In both cases the supplement is exactly the gap between what the PDF prints and
the total it claims, to the hour.

AI and Robotics is worth calling out because it can be checked against a
third, independent source: a student's own registrar portal. The PDF gives
Univ. Req. 14, Colg. Req. 59, Spec. Req. 25 — the portal prints the same three
numbers.

## Known gaps (in the SOURCE, not the parser)
- Faculty of Artificial Intelligence and Data Science (13 programs) and Faculty
  of Digital Sciences (6) contain only program NAME lists — captured on the
  faculty as `programNamesListed`, so they are 19 known programs with no course
  data rather than 19 programs that appear not to exist. The document says so
  itself: "i think you already have :" and "and already added all of them, if
  something is missing… tell me now".
- **Bachelor in Public Safety Engineering** states 14 credit hours and lists only
  the university requirements. That is faithful: the document itself writes
  "NO real plan yet." above it, kept in the program's `sourceNotes`.
- Three programs print no degree total at all: Telecommunications Engineering,
  Computer Networks – Minor Information Security, and Modern Media – Digital
  Media and Communication. Their sections are captured; the total is absent, so
  it stays absent.
- Dental Technology's plan A lists a 2-hour Univ. Elec. requirement whose course
  table was never screenshotted. The required hours survive in the text; the
  eligible course list does not exist in the source.

## Nothing is inferred
A value absent from the document is absent here. Names are only ever completed
from a fuller occurrence of the SAME course code elsewhere in the document
(recorded as `nameAsPrinted` when that happens). Where the source prints
something impossible — Dental Technology's DENTAL MATERIALS shows 100 weekly
theoretical hours — the value is kept verbatim and flagged, not corrected.
