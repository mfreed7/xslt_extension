// Immediately-invoked function to start the process.
(function initTransform() {
  const nativeSupported = ('XSLTProcessor' in window) && window.XSLTProcessor.toString().includes('native code');
  if (nativeSupported) {
    console.log('Not running the XSLT polyfill extension because this browser supports native XSLT.');
    return;
  }

  // Step 1: Immediately hide the document to prevent FOUC.
  setHidden(true);

  // Step 2: Asynchronously fetch and process the document.
  fetchAndTransform().catch(error => {
    // Catch any errors, log them, and ensure the document is visible.
    console.error('Error during XSLT transformation:', error);
    setHidden(false);
  });
})();

async function fetchAndTransform() {
  const response = await fetch(document.location.href);
  if (!response.ok) {
    // If fetch fails, unhide and stop.
    setHidden(false);
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
    await window.loadXmlContentWithXsltFromBytesWhenReady(xmlBytes, document.location.href);
    console.log('XSLT Polyfill has transformed this document.');
  } else {
    // No PI, unhide the original document.
    setHidden(false);
  }
}

function setHidden(hidden) {
  // This function needs to be robust since it's called very early at document_start.
  if (!document.body) {
    // If the body doesn't exist yet, wait for the next animation frame to try again.
    if (hidden) {
      requestAnimationFrame(() => setHidden(true));
    }
    return;
  }
  document.body.style.display = hidden ? 'none' : '';
}

// Global settings for the polyfill script.
window.xsltPolyfillQuiet = true;
window.xsltDontAutoloadXmlDocs = true;