#!/usr/bin/env python3
"""Compares the extension's active path with native XSLT. See SECURITY-REVIEW.md.

Usage: active.py firefox|chrome

Loads the pages in test/active/ three times: with native XSLT off and the extension
installed ("extension"), with native XSLT and no extension ("native"), and with native XSLT and
the extension ("dormant", where the extension must change nothing). Fails if the results
differ or the extension leaks globals. Serves test/ on 127.0.0.1:8001 (the victim origin)
and localhost:8002 (another origin).

Firefox: dom.xslt.enabled toggles native XSLT, through geckodriver.
Environment: GECKODRIVER (default: geckodriver on PATH), FIREFOX (default: Firefox Nightly).

Chrome: the XSLT feature flag toggles native XSLT (Canary still has it); the extension is loaded
with CDP Extensions.loadUnpacked through Playwright (pip install playwright).
Environment: CHROME (default: Chrome Canary).

Both: EXT_DIR (default: the repo root) is the extension directory to load.
"""
import functools
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.environ.get('EXT_DIR', os.path.dirname(TEST_DIR))
GECKODRIVER = os.environ.get('GECKODRIVER', 'geckodriver')
FIREFOX = os.environ.get('FIREFOX', '/Applications/Firefox Nightly.app/Contents/MacOS/firefox')
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary')
DRIVER_PORT = 4455
BASE = 'http://127.0.0.1:8001/'
XML_PAGES = ['active/same.xml', 'script-data.xml', 'active/cross.xml', 'active/comment.xml', 'active/csp-same.xml']
COMPARED = ['transformed', 'ran', 'got', 'injected']
OPTION_GLOBALS = ['xsltPolyfillOptions', 'fetchAndTransform', 'xsltPolyfillQuiet', 'xsltDontAutoloadXmlDocs',
                  'xsltUsePolyfillOnlyIfNeeded']


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if '/csp-' in self.path:
            self.send_header('Content-Security-Policy', "script-src 'none'")
        super().end_headers()

    def log_message(self, *args):
        pass


def serve(host, port):
    server = http.server.ThreadingHTTPServer((host, port), functools.partial(Handler, directory=TEST_DIR))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def request(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f'http://127.0.0.1:{DRIVER_PORT}{path}', data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)['value']


FRAME_JS = """
  const d = document.querySelector('iframe').contentDocument;
  return {
    nativeXSLTProcessor: /native code/.test(Function.prototype.toString.call(XSLTProcessor)),
    leaked: %s.filter((g) => g in window),
    transformed: d.getElementById('t')?.textContent ?? null};""" % json.dumps(OPTION_GLOBALS)

PAGE_JS = """
  return {
    transformed: document.getElementById('t')?.textContent ?? null,
    ran: window.ran ?? null, got: window.got ?? null, injected: window.injected ?? null,
    leaked: %s.filter((g) => g in window),
    root: document.documentElement?.outerHTML.slice(0, 80) ?? null};""" % json.dumps(OPTION_GLOBALS)


def measure(visit, js):
    results = {}
    visit('active/frame.html')
    results['frame.html'] = js(FRAME_JS)
    for page in XML_PAGES:
        visit(page)
        results[page] = js(PAGE_JS)
    return results


def run_firefox(mode):
    native = mode != 'extension'
    caps = {'capabilities': {'alwaysMatch': {'browserName': 'firefox', 'moz:firefoxOptions': {
        'binary': FIREFOX, 'args': ['-headless'], 'prefs': {'dom.xslt.enabled': native}}}}}
    session = '/session/' + request('POST', '/session', caps)['sessionId']
    try:
        if mode != 'native':
            request('POST', session + '/moz/addon/install', {'path': EXT_DIR, 'temporary': True})

        def visit(page):
            request('POST', session + '/url', {'url': BASE + page})
            time.sleep(4)

        def js(script):
            return request('POST', session + '/execute/sync', {'script': script, 'args': []})

        return measure(visit, js)
    finally:
        request('DELETE', session)


def run_chrome(mode):
    from playwright.sync_api import sync_playwright
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    args = ['--enable-features=XSLT' if mode != 'extension' else '--disable-features=XSLT',
            '--disable-features=GenerateXSLTWarningBanner',
            '--enable-unsafe-extension-debugging', f'--remote-debugging-port={port}']
    with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
        ctx = p.chromium.launch_persistent_context(profile, executable_path=CHROME, headless=True, args=args,
                                                   ignore_default_args=['--disable-extensions'])
        try:
            if mode != 'native':
                browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
                browser.new_browser_cdp_session().send('Extensions.loadUnpacked', {'path': EXT_DIR})
            page = ctx.pages[0]

            def visit(url):
                page.goto(BASE + url)
                page.wait_for_timeout(4000)

            return measure(visit, lambda script: page.evaluate('(() => {' + script + '})()'))
        finally:
            ctx.close()


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('firefox', 'chrome'):
        sys.exit(__doc__)
    browser = sys.argv[1]
    run = run_firefox if browser == 'firefox' else run_chrome
    servers = [serve('127.0.0.1', 8001), serve('localhost', 8002)]
    driver = None
    if browser == 'firefox':
        driver = subprocess.Popen([GECKODRIVER, '--port', str(DRIVER_PORT)],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        runs = {mode: run(mode) for mode in ('extension', 'native', 'dormant')}
    finally:
        if driver:
            driver.terminate()
        for server in servers:
            server.shutdown()

    failed = False
    for mode in ('extension', 'dormant'):
        print(f'== {mode} vs native')
        for page, ext in runs[mode].items():
            nat = runs['native'][page]
            problems = [f'{key}: {mode} {ext.get(key)!r}, native {nat.get(key)!r}'
                        for key in COMPARED if ext.get(key) != nat.get(key)]
            if ext['leaked']:
                problems.append(f"leaked globals: {', '.join(ext['leaked'])}")
            if mode == 'dormant' and page == 'frame.html' and not ext['nativeXSLTProcessor']:
                problems.append('XSLTProcessor was replaced')
            failed |= bool(problems)
            print(f"{'FAIL' if problems else 'PASS'} {page}" + ''.join(f'\n     {p}' for p in problems))
            if 'root' in ext and mode == 'extension':
                print(f"     extension: {ext['root']!r}\n     native:    {nat['root']!r}")
    print('\nOn frame.html the polyfill is expected to replace XSLTProcessor in the extension run: native '
          f"XSLTProcessor there: {runs['extension']['frame.html']['nativeXSLTProcessor']}")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
