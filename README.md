# XSLT Extension

A Chrome extension that automatically injects the [XSLT polyfill](https://github.com/mfreed7/xslt_polyfill) into XML documents.

Find it on the Chrome Web Store, here:

- https://chromewebstore.google.com/detail/xslt-polyfill/hlahhpnhgficldhfioiafojgdhcppklm

## Improvements / Bugs

If you find issues with this extension, feel free to file a bug [here](https://github.com/mfreed7/xslt_extension/issues). Note that if the problem is with the polyfill (i.e. a site doesn't render correctly) you should probably file a bug on the [polyfill repo](https://github.com/mfreed7/xslt_polyfill/issues) directly. Even better, if you would like to contribute to this extension,
I'm happy to review [pull requests](https://github.com/mfreed7/xslt_extension/pulls). Thanks in advance!

## Building

The extension's content script, `xslt-extension.js`, is generated from `content.js` and the `xslt_polyfill` submodule (`xslt_polyfill/xslt-polyfill.min.js`). After changing either, run `node scripts/bundle.mjs` (which initializes submodules, builds `xslt_polyfill`, and bundles `xslt-extension.js`).

## Limitations

The extension can't do everything native XSLT did:

- Scripts in the XML source (such as an XHTML `<script>`) run before the transform. Native XSLT never ran them, only the transform's output. A content script can't stop them.
- The extension gets the XML by fetching the page's URL again, which is a GET. If the document came from a POST, the response may differ. The extension skips the transform if the refetch was redirected, but it can't tell a POST response from a GET response that looks the same.
- Script-created `about:blank` iframes don't get `XSLTProcessor`: the content script isn't injected into them. Injecting it would install the polyfill in every such frame on every page, for the few widgets that construct `XSLTProcessor` there (SinglePlatform's menu widget is one, and takes its `ActiveXObject` fallback and throws).
