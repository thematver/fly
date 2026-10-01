#!/usr/bin/env python3
"""Link preview after the release (2 Oct 2026 00:00 MSK): the «послушай трек за неё» version.

The pages workflow runs this before every deploy; it changes dist/index.html only once the release
has happened, so any later push keeps the post-release preview. Scheduled runs of the workflow
deploy it at midnight without anyone pushing.
"""
import sys, time

RELEASE = 1790888400  # 2026-10-02T00:00:00+03:00
if time.time() < RELEASE and '--force' not in sys.argv:
    print('before the release: preview unchanged')
    sys.exit(0)

path = 'dist/index.html'
s = open(path, encoding='utf-8').read()
swaps = [
    ('assets/og-dead.jpg?v=4', 'assets/og-live.jpg?v=4'),
    ('content="муха померла за час до релиза."', 'content="муха померла за час до релиза. послушай трек за неё."'),
]
for a, b in swaps:
    if a not in s and b not in s:
        sys.exit(f'release_meta: not found: {a}')
    s = s.replace(a, b)
open(path, 'w', encoding='utf-8').write(s)
print('after the release: preview switched to og-live')
