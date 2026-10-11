#!/usr/bin/env python3
"""Give every major an icon key.

The 54 programs generated from the catalogue import shipped without one, so
AAUP_ICONS fell back to a graduation cap for all of them: Change Major listed
seventy rows with the same emoji, and the plan cards, the sidebar mark and the
faculty tiles were all equally undifferentiated.

Rules match on the major's own name, most specific first, and only use keys
that actually exist in web/js/04-icons.js — a key that file does not define
renders as nothing at all, which is worse than the cap. A program no rule
matches is left alone and reported rather than given something arbitrary.
"""
import io, json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAJORS = os.path.join(ROOT, 'data', 'aaup', 'majors')
ICONS_JS = os.path.join(ROOT, 'web', 'js', '04-icons.js')

# (regex over the lowercased English name, icon key). First match wins, so the
# specific entries have to precede the general ones — "medical laboratory"
# before "medical", "dental technology" before "dental".
RULES = [
    (r'orthodontic|prosthodontic',            'tooth'),
    (r'dental|dentistry|dental surgery',      'tooth'),
    (r'medical laborator',                    'microscope'),
    (r'medical imaging|radiolog',             'eye'),
    (r'medical equipment',                    'circuit'),
    (r'doctor of medicine|\bmedicine\b',      'medical'),
    (r'biomedical',                           'dna'),
    (r'prosthetic|orthotic',                  'bone'),
    (r'physio ?therapy|physical therapy',     'bone'),
    (r'occupational therapy',                 'health'),
    (r'hearing|speech-language',              'lungs'),
    (r'ambulance|emergency',                  'syringe'),
    (r'cosmetic|skincare',                    'flask'),
    (r'occupational health|public safety',    'shield'),
    (r'environmental|recycl',                 'leaf'),

    (r'cybersecurity|cyber security',         'lock'),
    (r'mobile application',                   'mobile'),
    (r'computer systems engineering',         'circuit'),
    (r'telecommunication',                    'network'),
    (r'electrical|renewable energy',          'bolt'),
    (r'mechatronic',                          'gear'),
    (r'civil engineering',                    'building'),
    (r'architecture|interior',                'ruler'),
    (r'industrial product design',            'palette'),
    (r'virtual reality',                      'vr'),

    # Programs only aaup.edu lists (Sciences, Modern Sciences, Sport
    # Sciences, Digital Sciences). Before "education", so a science degree
    # with a minor in education keeps its subject's icon.
    (r'forensic',                             'microscope'),
    (r'biology|biotechnology',                'dna'),
    (r'chemistry',                            'flask'),
    (r'physics',                              'atom'),
    (r'mathematics and statistics',           'sigma'),
    (r'sport',                                'medal'),
    (r'optometry',                            'eye'),
    (r'technology management|pioneering',     'rocket'),
    (r'sustainable development',              'leaf'),
    (r'culture, technology|technology and society', 'people'),
    (r'digital health|hospitals?|health care','health'),
    (r'neuromarketing|marketing',             'target'),
    (r'diplomacy|political science',          'handshake'),
    (r'social work',                          'handshake'),
    (r'digital management|management of business', 'briefcase'),
    (r'financial and banking|banking',        'finance'),

    (r'accounting',                           'chart'),
    (r'islamic banking|econom',               'finance'),
    (r'human resources',                      'people'),
    (r'business administration',              'briefcase'),
    (r'operations management|information sys','database'),
    (r'property|land',                        'building'),
    (r'public relations',                     'megaphone'),
    (r'media|communication',                  'news'),

    (r'fiqh',                                 'scroll'),
    (r'\blaw\b',                              'scales'),
    (r'teaching english|english language',    'language'),
    (r'teaching arabic|arabic language',      'pen'),
    (r'teaching mathema',                     'atom'),
    (r'teaching science',                     'flask'),
    (r'education|teaching',                   'education'),
    (r'languages',                            'globe'),
]


def defined_keys():
    src = io.open(ICONS_JS, encoding='utf-8').read()
    # ICONS entries look like `  keyname: '<svg...`
    return set(re.findall(r'^\s{2,4}([a-zA-Z][a-zA-Z0-9]*)\s*:', src, re.M))


def name_of(plan):
    en = (plan.get('majorName') or {}).get('en')
    if isinstance(en, dict):
        return ' '.join(str(en.get(k) or '') for k in ('big', 'small')).strip()
    return str(en or '')


def main():
    keys = defined_keys()
    missing_keys = sorted({k for _, k in RULES if k not in keys})
    if missing_keys:
        print('ERROR: rules use icon keys 04-icons.js does not define: ' + ', '.join(missing_keys))
        return 1

    changed, unmatched, already = 0, [], 0
    for path in sorted(glob.glob(os.path.join(MAJORS, '*.json'))):
        plan = json.load(io.open(path, encoding='utf-8'))
        if plan.get('iconKey'):
            already += 1
            continue
        name = name_of(plan)
        # Hyphens to spaces: a plan whose majorName is empty falls back to its
        # file stem ("aaup-civil-engineering"), and every rule below is written
        # in words, so without this the fallback never matches anything.
        hay = (name + ' ' + os.path.basename(path)[:-5]).lower().replace('-', ' ')
        hit = next((k for pat, k in RULES if re.search(pat, hay)), None)
        if not hit:
            unmatched.append(os.path.basename(path)[:-5])
            continue
        plan['iconKey'] = hit
        io.open(path, 'w', encoding='utf-8').write(
            json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
        changed += 1

    print('%d already had one, %d assigned, %d left without' % (already, changed, len(unmatched)))
    for u in unmatched:
        print('  no rule matched: ' + u)
    return 0


if __name__ == '__main__':
    sys.exit(main())
