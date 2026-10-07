#!/usr/bin/env python3
"""Serve the same static preview used on Cafe24, via the existing file handler."""
import http.server
import os
from pathlib import Path
import runpy
import sys
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
os.chdir(ROOT)
build = runpy.run_path(str(HERE / 'build.py'))
BaseHandler = runpy.run_path(str(ROOT / 'server.py'))['MyHTTPRequestHandler']
PREVIEW_PATH = build['SITE_PATH'] if '--public' in sys.argv else build['PREVIEW_PATH']
PAGES = {'spaces', 'pricing', 'location', 'guide', 'schedule', 'structure'}

class PreviewHandler(BaseHandler):
    def end_headers(self):
        self.send_header('X-Robots-Tag', 'noindex, nofollow, noarchive')
        super().end_headers()

    def translate_path(self, path):
        route = urlsplit(path).path
        if route == '/' or route.strip('/').split('/')[0] in PAGES or ('--public' in sys.argv and route in ('/robots.txt', '/sitemap.xml')):
            path = PREVIEW_PATH + route.lstrip('/')
        return super().translate_path(path)

    def do_POST(self):
        self.send_error(405, 'Read-only preview')

if __name__ == '__main__':
    port = 5090 if '--public' in sys.argv else 5088
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), PreviewHandler) as server:
        print(f'Preview: http://localhost:{port}/', flush=True)
        server.serve_forever()
