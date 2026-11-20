// Immediately-invoked function to start the process.
(function initTransform() {
  // Do nothing for non-XML (also no console message).
  const type = document.contentType;
  const isXml = type === "text/xml" || type === "application/xml" || type.endsWith("+xml");
  if (!isXml) {
    return;
  }

  let nativeSupported = 'XSLTProcessor' in window && window.XSLTProcessor.toString().includes('native code');
  if (nativeSupported) {
    try {
      new XSLTProcessor();
    } catch {
      nativeSupported = false;
    }
  }
  if (nativeSupported) {
    console.log('Not running the XSLT polyfill extension because this browser supports native XSLT.');
    return;
  }

  if (document.location.protocol === 'file:') {
    console.log('XSLT polyfill extension: Fetching from file:// URLs is not supported by this extension.');
    return;
  }

  // Step 1: Immediately hide the document to prevent FOUC.
  console.log('Starting XSLT polyfill transformation...');
  window.xsltPolyfillSpinner = 'XSLT Extension is processing this page, please wait...';

  // Step 2: Once the prolog is parsed, skip the refetch if it has no
  // xml-stylesheet PI. The polyfill only transforms if it finds one there, so
  // the refetch would be wasted.
  whenPrologParsed(() => {
    if (!prologHasStylesheetPI()) {
      window.xsltPolyfillSpinner = null;
      return;
    }
    // Step 3: Asynchronously fetch and process the document.
    fetchAndTransform().catch((error) => {
      // Catch any errors, log them, and ensure the document is visible.
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        console.log(
          'XSLT polyfill extension: Unable to load the site via fetch. This can happen with local files (file://) or due to network errors.',
        );
      } else {
        console.error('Error during XSLT transformation:', error);
      }
      window.xsltPolyfillSpinner = null; // Error - stop. Make things visible again.
    });
  });
})();

// Calls `callback` once the document's prolog (everything before the root
// element) is parsed: when the root element is inserted, or at
// DOMContentLoaded if there's no root element (e.g. a parse error). Page
// scripts are inside the root element, so the prolog is complete before any of
// them run.
function whenPrologParsed(callback) {
  let done = false;
  const observer = new MutationObserver(() => {
    if (document.documentElement) finish();
  });
  function finish() {
    if (done) return;
    done = true;
    observer.disconnect();
    callback();
  }
  if (document.documentElement || document.readyState !== 'loading') {
    finish();
    return;
  }
  observer.observe(document, { childList: true });
  document.addEventListener('DOMContentLoaded', finish, { once: true });
}

// True if the prolog has an xml-stylesheet PI. This is deliberately looser
// than the polyfill's own check (which also looks at type, href and
// alternate), so it never skips a document the polyfill would transform.
function prologHasStylesheetPI() {
  for (const node of document.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) break;
    if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE && node.target === 'xml-stylesheet') {
      return true;
    }
  }
  return false;
}

async function fetchAndTransform() {
  const response = await fetch(document.location.href);
  if (!response.ok) {
    window.xsltPolyfillSpinner = null; // Error - stop. Make things visible again.
    console.warn(`XSLT Polyfill: Failed to fetch document: ${response.statusText}`);
    return;
  }
  if (response.redirected) {
    // This GET isn't the request that produced the document (e.g. a POST that
    // the server answers with a redirect for GET), so it's the wrong document.
    window.xsltPolyfillSpinner = null;
    console.warn('XSLT Polyfill: Not transforming this document: refetching it was redirected.');
    return;
  }
  // The polyfill parses the bytes as UTF-8, so decode them the way the browser
  // decoded this document and re-encode as UTF-8. Invalid bytes throw, like
  // they fail the native parse.
  const documentDecoder = new TextDecoder(document.characterSet, { fatal: true });
  const xmlBytes = new TextEncoder().encode(documentDecoder.decode(await response.arrayBuffer()));

  // Decode a small chunk to check for the processing instruction.
  const decoder = new TextDecoder();
  const textChunk = decoder.decode(xmlBytes.subarray(0, 2048));

  if (textChunk.includes('<?xml-stylesheet')) {
    // PI found, proceed with transformation. The page is already hidden.
    // The polyfill's replaceDoc function will handle revealing the new content.
    try {
      await xsltPolyfillReady();
      await loadXmlWithXsltFromBytes(xmlBytes, document.location.href);
    } catch (err) {
      console.error(`Error displaying XML file: ${err.message || err.toString()}`);
    }
    console.log('XSLT Polyfill has transformed this document.');
  }
  window.xsltPolyfillSpinner = null;
}

// Settings for the polyfill, which shares this scope (see scripts/bundle.mjs).
const xsltPolyfillOptions = {
  xsltPolyfillQuiet: true,
  xsltDontAutoloadXmlDocs: true,
  xsltUsePolyfillOnlyIfNeeded: true,
};
