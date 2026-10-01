import re,os
css=open('src/style.css').read()
body=open('src/body.html').read()
rules=open('src/rules.js').read()
app=open('src/app.js').read()
qr=open('src/qr.js').read()
tickets=open('src/tickets.js').read()
reports=open('src/reports.js').read()
head='''<title>ParkOps</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
'''
for s in (rules,app,qr,tickets,reports): assert '</script' not in s
artifact=head+css+'\n'+body+'<script>\n'+rules+'\n</script>\n<script>\n'+qr+'\n</script>\n<script>\n'+app+'\n</script>\n<script>\n'+tickets+'\n</script>\n<script>\n'+reports+'\n</script>\n'
open('campus-parkops.html','w').write(artifact)
os.makedirs('server/public',exist_ok=True)
adapter=open('src/hosted-adapter.js').read() if os.path.exists('src/hosted-adapter.js') else ''
hui=open('src/hosted-ui.js').read()
hosted_unused=None
hosted='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'+head+css+'\n<style>[hidden]{display:none!important}html,body{margin:0}</style></head><body>\n'+body+'<script>\n'+rules+'\n</script>\n<script>\n'+qr+'\n</script>\n<script>\n'+adapter+'\n</script>\n<script>\n'+app+'\n</script>\n<script>\n'+tickets+'\n</script>\n<script>\n'+reports+'\n</script>\n<script>\n'+hui+'\n</script>\n</body></html>\n'
open('server/public/index.html','w').write(hosted)
open('server/public-rules.js','w').write(rules)
print('built',len(artifact),len(hosted))
