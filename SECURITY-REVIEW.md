# Security review

How to review a change to this extension or to the polyfill it bundles, and how to test it. Use it before publishing a new version, e.g. after bumping the `xslt_polyfill` submodule.

## Threat model

`manifest.json` injects `xslt-extension.js` (`content.js` and the polyfill, wrapped in one function by `scripts/bundle.mjs`) into every page and frame (`<all_urls>`, `all_frames`, `document_start`), in the page's own JS world (`"world": "MAIN"`). The extension has no permissions, background script, web-accessible resources or message listeners, so there's no privileged context to attack. The risk is what its scripts do on every site, with that site's privileges.

The rule to hold it to: **a page must not be able to do anything through the extension that it couldn't do without it.** Review for two attackers, in two browser states:

- Attackers: (1) a page the user visits that the attacker controls (navigating to or framing a victim page counts); (2) content the attacker got onto a victim page or file (user-generated content, an upload, a feed item), which is safe without the extension but unsafe with it.
- States: native XSLT available (Firefox today), where the extension should be fully dormant; and native XSLT missing (Chrome today, Firefox with `dom.xslt.enabled=false`), where the polyfill is active and must not be more permissive than native XSLT was.

Properties to check for:

- **Dormant while native XSLT exists.** No globals, no prototype patches, no replaced `XSLTProcessor`.
- **Same inputs transform as native XSLT did.** Native XSLT only honors `<?xml-stylesheet?>` in the prolog; fetches stylesheets, imports and `document()` same-origin (Chromium: `RequestMode::kSameOrigin`); applies CSP `script-src` to them; and keeps data as data (Firefox does; Chrome's reparsing doesn't for `<style>`/`<script>`, see B1). Anything the polyfill accepts beyond that is a new capability for attackers.
- **Content can't steer the polyfill.** Document and element content (including `<form>` controls, and elements named like properties) must not change which code runs or break it.

## Reviewing a change

Review `git diff OLD NEW -- src scripts Makefile` in the polyfill repo, plus any changes to `content.js` and `manifest.json`, looking for:

- **Reach.** Changes to defaults or options (`xsltUsePolyfillOnlyIfNeeded`, `xsltUsePolyfillAlways`, `xsltDontAutoloadXmlDocs`, the native-support detection), or to `matches`, `all_frames`, `world`, or permissions in the manifest. Anything that makes the polyfill run where it didn't before needs a reason.
- **Global side effects.** New `window.*` globals and new prototype patches (`Document.prototype`, `Element.prototype`, `Node.prototype`). Patches must apply only to the document being polyfilled, never to every page.
- **HTML sinks.** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe`, `document.write`, `DOMParser` with `text/html`, and script elements that get created or re-run. Check where their input comes from: XML or XSLT data, error messages, URLs.
- **Serialize-then-reparse.** Firefox's native XSLT builds the result DOM directly. The polyfill serializes libxslt's output to text and reparses it, as Chrome's native XSLT did. Anywhere text gets decoded twice (e.g. raw-text elements, entity decoding of script text), data can turn into markup or script.
- **Network and data.** New `fetch` or other requests. They should only go to URLs the page provides (stylesheets, `document()`, the document itself), never to hard-coded hosts.
- **Code execution.** `eval`, `new Function`, `setTimeout` with strings, or new Wasm imports.
- **Stylesheet discovery.** How the stylesheet PI is found (`content.js`, `loadXmlWithXsltFromBytes()`). Matching text in the first bytes with a regex also matches CDATA and comments, which user content controls (feeds, uploaded SVG/XHTML); it should come from PIs in the parsed prolog.
- **Load mode.** How stylesheets, `xsl:import`/`xsl:include` and `document()` are fetched (`loadDoc()`, `fetch_and_load_document`). Plain `fetch()` accepts `data:` and CORS cross-origin URLs and ignores `script-src`, unlike native XSLT; expect `mode: 'same-origin'` and `data:` rejected.
- **DOM clobbering.** `<form>` controls shadow the form's own members, and named elements (`embed`, `form`, `iframe`, `img` and `object` by `name`; `object`, and `img` that also has a `name`, by `id`) shadow members of the live `document`. Property access on the page's `document` or on elements from page or output content (`document.createElementNS`, `el.getAttributeNames()`, `form.childNodes`) breaks on those, as do `window.*` options that a named element can shadow (the extension passes its options in scope instead). Expect those accesses to go through members looked up on the prototypes (`callOn()`/`getOn()`/`setOn()`); inert documents from `DOMParser` aren't affected. `location` is `[LegacyUnforgeable]` on both `document` and `window`, so it can't be shadowed.
- **Page script tampering.** For the extension's own code (`content.js`), monkeypatched builtins or overwritten polyfill globals (`loadXmlWithXsltFromBytes`) are out of scope: they need script in the page, which already has the page's privileges, and the extension has none beyond them. In the polyfill this is a robustness question, since it runs next to page libraries in every context, not a security one.
- **Engine-dependent document checks.** `document instanceof XMLDocument` / `HTMLDocument` gives opposite answers for `application/xhtml+xml` in Firefox (`HTMLDocument`) and Chrome (`XMLDocument`). Prefer checks based on `document.contentType`.

`xslt_polyfill/xslt-polyfill.min.js` is too big to review directly. Review the source it's built from, and check that the committed `xslt-extension.js` is what `node scripts/bundle.mjs` produces from it (that needs the polyfill's emscripten toolchain).

The Wasm binary (`dist/xslt-wasm.js`, built from `src/transform.c`, libxml2 and libxslt) can only reach the page through the glue's imports. List them (`wasmImports` in the glue) and compare with the previous version. Expect only emscripten's in-memory syscalls plus `fetch_and_load_document`, `js_collate`, and `clear_collate_cache` (the `EM_JS` functions in `src/transform.c`). A new import means new capability. Also check whether the libxml2 and libxslt submodule pins changed, and look at their security advisories.

## Tests

Both need the polyfill submodule (`git submodule update --init xslt_polyfill`).

**`test/security.html`** compares the polyfill with native XSLT. Serve the repo root (`python3 -m http.server 8000`) and open http://localhost:8000/test/security.html in a browser with native XSLT, such as Firefox:

- With the extension installed: section A checks that it's dormant on ordinary pages and iframes (native `XSLTProcessor`, no polyfill globals or prototype patches). A dormant extension leaves no trace, so A also passes without it; check that it's loaded.
- With or without the extension: section B runs the bundled polyfill against native XSLT on inputs where data must stay data. B1 (data in `<style>`/`<script>` through `transformToFragment()`) is an accepted risk: with `<xsl:output method="html"/>` libxslt writes `script` and `style` content unescaped (XSLT 1.0 section 16.2), and the polyfill reparses the result as HTML, so data containing `</style>` breaks out. Chrome's native XSLT does the same; Firefox's builds the DOM directly and keeps the data as text. It only matters for pages whose own stylesheet puts untrusted data in `<style>`/`<script>`, and only while the polyfill is active. B2 (entity-like data decoded again in output `<script>`) must pass.

**`test/active.py firefox|chrome`** tests the state where native XSLT is missing. It loads the pages in `test/active/` three times: with native XSLT off and the unpacked extension installed, with native XSLT and no extension, and with native XSLT and the extension (which must change nothing). It fails if the results differ or the extension leaks globals. It serves `test/` itself on a "victim" origin (`127.0.0.1:8001`) and another origin (`localhost:8002`). Add a page there for each new kind of case.

- Firefox needs geckodriver (`GECKODRIVER=/path/to/geckodriver python3 test/active.py firefox`; `FIREFOX` selects the binary). Native XSLT is toggled with `dom.xslt.enabled`. For manual checks, `web-ext run --pref dom.xslt.enabled=false` starts Firefox with the extension and the pref.
- Chrome needs Playwright (`pip install playwright`) and a Chrome that still has the `XSLT` feature, such as Canary (`CHROME` selects the binary). Native XSLT is toggled with `--enable-features=XSLT` / `--disable-features=XSLT`, and the extension is loaded with the DevTools protocol's `Extensions.loadUnpacked`, since Chrome ignores `--load-extension`.
- `EXT_DIR` selects another extension directory, e.g. a build with an older polyfill, to check that the test fails on a bad build.

To check the polyfill in a Chrome without the `XSLT` feature, evaluate `xslt-extension.js` in the page after load: `(0, eval)(await (await fetch('/xslt-extension.js')).text())`. That bypasses CSP and `document_start`, so check CSP and early-load behavior with `test/active.py`.

When a review finds a new kind of bug, add a case that fails on the bad build.

## Reporting

Report security bugs privately (see [SECURITY.md](SECURITY.md)), not in a public issue or PR that describes the exploit. Fixes for non-exploitable robustness bugs can go straight to a PR.
