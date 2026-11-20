import os
d = os.path.dirname(os.path.abspath(__file__))
r = lambda f: open(os.path.join(d, f), encoding="utf-8").read()
html = r("index.template.html").replace("/*CSS*/", r("style.css")).replace("/*DSP*/", r("dsp.js")).replace("/*RTL*/", r("rtl.js")).replace("/*RTLSIM*/", r("rtlsim.js")).replace("/*APP*/", r("app.js"))
# explicit utf-8 and \n so a Windows build is byte-identical to a Linux one
open(os.path.join(d, "index.html"), "w", encoding="utf-8", newline="\n").write(html)
print("built index.html", len(html), "bytes")
# GitHub Pages site (served from /docs): the landing page, and the app itself at /app/
site = os.path.join(os.path.dirname(d), "docs")
os.makedirs(os.path.join(site, "app"), exist_ok=True)
open(os.path.join(site, "app", "index.html"), "w", encoding="utf-8", newline="\n").write(html)
open(os.path.join(site, "index.html"), "w", encoding="utf-8", newline="\n").write(r(os.path.join("site", "index.html")))
open(os.path.join(site, ".nojekyll"), "w").close()   # serve the files as they are (no Jekyll processing)
print("built docs/index.html and docs/app/index.html")
