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

  // Step 2: Asynchronously fetch and process the document.
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
})();

async function fetchAndTransform() {
  const response = await fetch(document.location.href);
  if (!response.ok) {
    window.xsltPolyfillSpinner = null; // Error - stop. Make things visible again.
    console.warn(`XSLT Polyfill: Failed to fetch document: ${response.statusText}`);
    return;
  }
  const xmlBytes = new Uint8Array(await response.arrayBuffer());

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

// Global settings for the polyfill script.
window.xsltPolyfillQuiet = true;
window.xsltDontAutoloadXmlDocs = true;
