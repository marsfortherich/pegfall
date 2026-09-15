#!/usr/bin/env python3
"""The asset fingerprint: one definition, shared by the arcade and all four sites.

GitHub Pages caches js/ and css/, so a site whose assets changed but whose
version did not will keep serving the old build to anyone who has visited
before. `tools/bump.py` records a digest of a site's cache-relevant assets into
`<meta name="app-assets">` whenever it stamps a version; each site's Pages
workflow runs this file to recompute that digest and fail if it has moved.

    python3 shared/tools/asset-digest.py --print js css shared
    python3 shared/tools/asset-digest.py --stamp index.html js css shared

This lives under shared/ so the existing sync keeps every copy identical and
there is exactly one implementation of the digest — the arcade's bump.py loads
this same file rather than reimplementing it. An earlier attempt computed it
with `find | xargs sha256sum | sha256sum` in each workflow instead, which is
not portable: GNU coreutils writes `<hash>  <path>` but Git Bash on Windows
writes `<hash> *<path>`, so the arcade and CI silently disagreed.

It is a build tool, not a browser asset. It ships inside shared/ only because
that is what travels to every repo, and it is excluded from the digest it
computes — see SKIP_PREFIXES.
"""

import hashlib
import io
import os
import re
import sys

# Served, but never fetched by a page, so a change here must not demand a
# version bump: MANIFEST is the sync's own bookkeeping and this folder is
# tooling.
SKIP_EXACT = {'shared/MANIFEST'}
SKIP_PREFIXES = ('shared/tools/',)


def _sha256_file(path):
    """sha256 of the file with CRLF normalised to LF.

    Hashing raw bytes was wrong and failed in CI the first time this ran.
    Every repo here declares `* text=auto eol=lf`, so the committed bytes are
    always LF — but a Windows working tree can still hold CRLF (eleven files
    across PEGFALL and One More Roll did). bump.py then recorded a digest of
    the CRLF bytes and CI, which checks out LF, recomputed a different one.

    Normalising makes the digest a property of the content rather than of
    whichever machine last touched it. It is safe to normalise unconditionally
    because these games ship no binary assets at all — no image or audio
    files, by design; all art is CSS or inline SVG and all sound is
    synthesised. Revisit this the day that stops being true.
    """
    with open(path, 'rb') as fh:
        data = fh.read()
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()


def _skip(rel):
    return rel in SKIP_EXACT or rel.startswith(SKIP_PREFIXES)


def digest(site_dir, roots):
    """A digest of every cache-relevant asset under `roots`, relative to `site_dir`.

    One `<sha256>  <relpath>` line per file — the hash being of the file with
    CRLF normalised to LF, see _sha256_file — forward slashes, sorted bytewise
    on the whole line, joined with newlines, one trailing newline; then sha256
    of that text, first 16 hex characters.
    """
    lines = []
    for root in roots:
        full_root = os.path.join(site_dir, root)
        if os.path.isfile(full_root):
            rel = root.replace('\\', '/')
            if not _skip(rel):
                lines.append(_sha256_file(full_root) + '  ' + rel)
            continue
        if not os.path.isdir(full_root):
            continue
        for dirpath, _dirnames, filenames in os.walk(full_root):
            for name in filenames:
                p = os.path.join(dirpath, name)
                rel = os.path.relpath(p, site_dir).replace(os.sep, '/')
                if _skip(rel):
                    continue
                lines.append(_sha256_file(p) + '  ' + rel)
    lines.sort()
    text = '\n'.join(lines) + '\n'
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


META_VERSION_RE = re.compile(r'<meta name="app-version" content="([^"]+)"')
META_ASSETS_RE = re.compile(r'<meta name="app-assets" content="([^"]+)"')


def main(argv):
    mode = None
    stamp_file = None
    roots = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--print':
            mode = 'print'
        elif a == '--stamp':
            mode = 'stamp'
            i += 1
            if i >= len(argv):
                print('--stamp needs the file holding the metas', file=sys.stderr)
                return 2
            stamp_file = argv[i]
        else:
            roots.append(a)
        i += 1

    if mode is None or not roots:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        print('usage: asset-digest.py (--print | --stamp FILE) ROOT [ROOT ...]',
              file=sys.stderr)
        return 2

    d = digest('.', roots)

    if mode == 'print':
        print(d)
        return 0

    if not os.path.isfile(stamp_file):
        print('::error::' + stamp_file + ' is missing', file=sys.stderr)
        return 1

    s = io.open(stamp_file, encoding='utf-8', newline='').read()
    recorded = META_ASSETS_RE.search(s)
    version = META_VERSION_RE.search(s)
    ver = version.group(1) if version else '(unversioned)'

    if not recorded:
        # An older checkout predates the stamp. Say so, but do not fail a
        # deploy over bookkeeping that was never written.
        print('::warning::no <meta name="app-assets"> in ' + stamp_file +
              ' — run `python tools/bump.py --stamp-assets` in the arcade')
        return 0

    if recorded.group(1) != d:
        print('::error::Cache-relevant assets changed but the version did not. '
              'Version ' + ver + ' was stamped against assets ' +
              recorded.group(1) + ', which are now ' + d + '.')
        print('GitHub Pages caches js/ and css/, so anyone who has loaded this '
              'site before would keep the old build.')
        print('Fix: run `python tools/bump.py <site>` in the arcade '
              '(then `python build.py` for No Limit), commit and push.')
        return 1

    print('assets ' + d + ' match version ' + ver)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
