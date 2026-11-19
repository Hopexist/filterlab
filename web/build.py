import os
d = os.path.dirname(os.path.abspath(__file__))
r = lambda f: open(os.path.join(d, f), encoding="utf-8").read()
html = r("index.template.html").replace("/*CSS*/", r("style.css")).replace("/*DSP*/", r("dsp.js")).replace("/*RTL*/", r("rtl.js")).replace("/*APP*/", r("app.js"))
# explicit utf-8 and \n so a Windows build is byte-identical to a Linux one
open(os.path.join(d, "index.html"), "w", encoding="utf-8", newline="\n").write(html)
print("built index.html", len(html), "bytes")
