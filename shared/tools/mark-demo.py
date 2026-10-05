#!/usr/bin/env python3
"""
shared/tools/mark-demo.py -- mark a page as the demo.

    python3 shared/tools/mark-demo.py index.html [more pages...]

Adds <meta name="arcade-demo" content="1"> right after the page's
app-version stamp, suffixes that version "-demo" and the <title> " · Demo".
The shared layer reads the marker (Arcade.isDemo, arcade-config.js) and each
game narrows itself to its demo.

Defined once and used twice, like asset-digest.py beside it:

  * each site's Pages workflow runs it on the page it is about to publish,
    after every check has read the unmarked page -- so the website is the demo
    while the repo stays the full game the Steam build is assembled from;
  * tools/build-demo.py runs it on its copies, for the desktop demo.

It refuses a page that is already marked: nothing in a repo may carry the
marker, so finding one means the full game would ship as the demo too.
Synced into every site by tools/sync-shared.py; never fetched by a page, so
like the rest of shared/tools/ it is outside the asset fingerprint.
"""
import io
import re
import sys

MARK = '<meta name="arcade-demo" content="1">'
VERSION_RE = re.compile(r'(<meta name="app-version" content=")([^"]+)(")')
TITLE_RE = re.compile(r'<title>(.*?)</title>', re.S)


class MarkError(Exception):
    pass


def mark_text(s, name='page'):
    """Return (marked text, demo version). Raises MarkError if it cannot."""
    # The exact tag, not the name: No Limit inlines arcade-config.js, whose
    # comments mention the marker.
    if MARK in s:
        raise MarkError('%s already carries the demo marker -- a repo must never have it' % name)
    m = VERSION_RE.search(s)
    if not m:
        raise MarkError('%s has no app-version stamp' % name)
    version = m.group(2) + '-demo'
    s = s[:m.start(2)] + version + s[m.end(2):]
    # Right after the version stamp's tag, inside <head>, before any script reads it.
    end = s.index('>', m.start(2)) + 1
    s = s[:end] + '\n' + MARK + s[end:]
    t = TITLE_RE.search(s)
    if t:
        s = s[:t.start()] + '<title>' + t.group(1) + ' · Demo</title>' + s[t.end():]
    return s, version


def mark_file(path):
    s = io.open(path, encoding='utf-8', newline='').read()
    s, version = mark_text(s, path)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)
    return version


def main(argv):
    if not argv:
        sys.exit('usage: mark-demo.py <page.html> [...]')
    for path in argv:
        try:
            print('%s marked as the demo (%s)' % (path, mark_file(path)))
        except (MarkError, OSError) as e:
            print('::error::%s' % e)
            sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[1:])
