<?xml version="1.0"?>
<!-- Puts XML data in a JS string, stripping quotes; the data must not break out. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html"/>
  <xsl:template match="/">
    <html><body><p>x</p><script>window.got = "<xsl:value-of select="translate(root/name, '&quot;', '')"/>";</script></body></html>
  </xsl:template>
</xsl:stylesheet>
