function processContent() {
  // Try to avoid the FOUC.
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
  console.log('Transformed XML with XSLT.');
}

window.addEventListener('load', processContent);
