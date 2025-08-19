function processContent() {
  if (!document.contentType.endsWith('/xml') && !document.contentType.endsWith('+xml')) {
    return;
  }
  const nativeSupported = ('XSLTProcessor' in window) && window.XSLTProcessor.toString().includes('native code')
  if (nativeSupported) {
    console.log('Not running the XSLT polyfill extension because this browser supports native XSLT.');
    return;
  }
  // Try to avoid FOUC.
  document.body.style.display = 'none';
  const xmlContent = document.querySelector('#webkit-xml-viewer-source-xml');
  if (!xmlContent || !xmlContent.childNodes.length) {
    // Wait for content to load
    setTimeout(processContent,100);
    return;
  }
  const xsl = xmlContent.childNodes[0];
  if (xsl.nodeType !== Node.PROCESSING_INSTRUCTION_NODE) {
    // The XSL file must be first. Otherwise bail out.
    document.body.style.display = null;
    return;
  }
  // Get XML source back:
  const serializer = (new XMLSerializer());
  const xmlText = Array.from(xmlContent.childNodes).map((c) => serializer.serializeToString(c)).join(' ');

  // Now load the XML with XSLT:
  window.loadXmlContentWithXsltWhenReady(xmlText, document.location.href)
    .then(() => {
      setTimeout(() => (document.body.style.display = null), 100);
    });
  console.log('XSLT Polyfill has transformed this document.');
}

window.xsltPolyfillQuiet = true; // Avoid spamming the console
window.addEventListener('load', processContent);
