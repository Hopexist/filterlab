import os
d = os.path.dirname(os.path.abspath(__file__))
r = lambda f: open(os.path.join(d, f)).read()
html = r("index.template.html").replace("/*CSS*/", r("style.css")).replace("/*DSP*/", r("dsp.js")).replace("/*APP*/", r("app.js"))
open(os.path.join(d, "index.html"), "w").write(html)
print("built index.html", len(html), "bytes")
