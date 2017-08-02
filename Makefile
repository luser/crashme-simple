FILES := \
  bootstrap.js \
  chrome.manifest \
  contentscript.js \
  icon16.png \
  icon64.png \
  icon.png \
  iconrust.png \
  install.rdf \
  toolbar.css \
  $(NULL)

crashme-simple.xpi: Makefile $(FILES)
	rm -f $@
	zip -9 $@ $(FILES)
