function processContent() {
  const nativeSupported = ('XSLTProcessor' in window) && window.XSLTProcessor.toString().includes('native code');
  if (nativeSupported) {
    console.log('Not running the XSLT polyfill extension because this browser supports native XSLT.');
    return;
  }

  const xmlViewerContent = document.querySelector('#webkit-xml-viewer-source-xml');
  if (xmlViewerContent) {
    // Case 1: Browser's native XML viewer.
    if (!xmlViewerContent.childNodes.length) {
      // Wait for content to load
      setTimeout(processContent, 100);
      return;
    }
    if (!hasXsltProcessingInstruction(xmlViewerContent.childNodes)) {
      return; // No XSLT, do nothing.
    }
    // Try to avoid FOUC.
    setHidden(true);
    const serializer = (new XMLSerializer());
    const xmlText = Array.from(xmlViewerContent.childNodes).map((c) => serializer.serializeToString(c)).join('');
    transformAndReveal(xmlText);
  } else if (document instanceof XMLDocument) {
    // Case 2: Raw XML document (e.g. in an iframe).
    if (!hasXsltProcessingInstruction(document.childNodes)) {
      return; // No XSLT, do nothing.
    }
    // Try to avoid FOUC.
    setHidden(true);
    const serializer = new XMLSerializer();
    const xmlText = serializer.serializeToString(document);
    transformAndReveal(xmlText);
  }
}

function hasXsltProcessingInstruction(nodes) {
  return Array.from(nodes).some(node =>
    node.nodeType === Node.PROCESSING_INSTRUCTION_NODE && node.target === 'xml-stylesheet'
  );
}

function transformAndReveal(xmlText) {
  // Now load the XML with XSLT:
  window.loadXmlContentWithXsltWhenReady(xmlText, document.location.href)
    .then(() => {
      setTimeout(() => setHidden(false), 100);
    });
  console.log('XSLT Polyfill has transformed this document.');
}

function setHidden(hidden) {
  if (!document.body || !document.body.style) {
    return;
  }
  document.body.style.display = hidden ? 'none' : null;
}
window.xsltPolyfillQuiet = true; // Avoid spamming the console
window.xsltDontAutoloadXmlDocs = true; // Avoid the code that auto-loads an XML document
window.addEventListener('load', processContent);
