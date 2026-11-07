#!/usr/bin/env python3
"""Compares the extension's active path with native XSLT in Firefox. See SECURITY-REVIEW.md.

Runs the pages in test/active/ twice through geckodriver: with dom.xslt.enabled=false
and the extension installed, then with native XSLT and no extension. Serves test/ on
127.0.0.1:8001 (the victim origin) and localhost:8002 (another origin).

Environment: GECKODRIVER (default: geckodriver on PATH), FIREFOX (default: Firefox Nightly).
"""
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.dirname(TEST_DIR)
GECKODRIVER = os.environ.get('GECKODRIVER', 'geckodriver')
FIREFOX = os.environ.get('FIREFOX', '/Applications/Firefox Nightly.app/Contents/MacOS/firefox')
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


def run(native):
    caps = {'capabilities': {'alwaysMatch': {'browserName': 'firefox', 'moz:firefoxOptions': {
        'binary': FIREFOX, 'args': ['-headless'], 'prefs': {'dom.xslt.enabled': native}}}}}
    session = '/session/' + request('POST', '/session', caps)['sessionId']
    try:
        if not native:
            request('POST', session + '/moz/addon/install', {'path': EXT_DIR, 'temporary': True})

        def visit(page, wait):
            request('POST', session + '/url', {'url': BASE + page})
            time.sleep(wait)

        def js(script):
            return request('POST', session + '/execute/sync', {'script': script, 'args': []})

        results = {}
        visit('active/frame.html', 4)
        results['frame.html'] = js("""
          const d = document.querySelector('iframe').contentDocument;
          return {
            nativeXSLTProcessor: /native code/.test(Function.prototype.toString.call(XSLTProcessor)),
            leaked: %s.filter((g) => g in window),
            transformed: d.getElementById('t')?.textContent ?? null};""" % json.dumps(OPTION_GLOBALS))
        for page in XML_PAGES:
            visit(page, 4)
            results[page] = js("""return {
              transformed: document.getElementById('t')?.textContent ?? null,
              ran: window.ran ?? null, got: window.got ?? null, injected: window.injected ?? null,
              leaked: %s.filter((g) => g in window),
              root: document.documentElement.outerHTML.slice(0, 80)};""" % json.dumps(OPTION_GLOBALS))
        return results
    finally:
        request('DELETE', session)


def main():
    servers = [serve('127.0.0.1', 8001), serve('localhost', 8002)]
    driver = subprocess.Popen([GECKODRIVER, '--port', str(DRIVER_PORT)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.5)
        extension = run(native=False)
        native = run(native=True)
    finally:
        driver.terminate()
        for server in servers:
            server.shutdown()

    failed = False
    for page, ext in extension.items():
        nat = native[page]
        problems = [f'{key}: extension {ext.get(key)!r}, native {nat.get(key)!r}'
                    for key in COMPARED if ext.get(key) != nat.get(key)]
        if ext['leaked']:
            problems.append(f"leaked globals: {', '.join(ext['leaked'])}")
        failed |= bool(problems)
        print(f"{'FAIL' if problems else 'PASS'} {page}" + ''.join(f'\n     {p}' for p in problems))
        if 'root' in ext:
            print(f"     extension: {ext['root']!r}\n     native:    {nat['root']!r}")
    print('\nOn frame.html the polyfill is expected to replace XSLTProcessor: native XSLTProcessor '
          f"with the extension: {extension['frame.html']['nativeXSLTProcessor']}")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
