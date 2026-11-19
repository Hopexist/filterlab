def L(h):
    h=h.lstrip('#'); c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    c=[x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4 for x in c]; return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def cr(a,b): a,b=L(a),L(b); return (max(a,b)+.05)/(min(a,b)+.05)
T={'light':dict(bg='#e6e8e6',panel='#f6f7f5',screen='#fcfdfc',ink='#161a1d',ink2='#454d53',ink3='#5d666c',accent='#1b5868',s1='#2a78d6',s2='#eb6834',good='#0b7a3b',bad='#c23a39',grid='#dde2df'),
   'dark':dict(bg='#0e1112',panel='#161a1c',screen='#0a0d0e',ink='#e7eaeb',ink2='#b3bbbf',ink3='#909a9f',accent='#73c4d2',s1='#3987e5',s2='#d95926',good='#3fbf72',bad='#ee7373',grid='#1d2628')}
for t,d in T.items():
    for fg in ('ink','ink2','ink3','accent','good','bad'):
        print(t,fg,*(f"{bg}:{cr(d[fg],d[bg]):.2f}" for bg in ('bg','panel','screen')))
    print(t,'s1/s2 on screen',f"{cr(d['s1'],d['screen']):.2f}",f"{cr(d['s2'],d['screen']):.2f}",'grid vs screen',f"{cr(d['grid'],d['screen']):.2f}")
