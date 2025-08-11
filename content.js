// This script finds the XML content within the .pretty-print div,
// converts it to a data URL, and passes it to the global
// loadXmlWithXsltWhenReady function.

function processContent() {
  const xmlContent = document.querySelector('.pretty-print');
  const xmlText = xmlContent.textContent;
  if (!xmlText.length) {
    setTimeout(processContent,100);
    return;
  }
  window.loadXmlContentWithXsltWhenReady(xmlText, document.location.href);
  console.log('Transformed XML with XSLT.');
}

window.addEventListener('load', processContent);
