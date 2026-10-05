"""Builds the page the server sends (index.html) and the server's copy of the rules (public-rules.js)
from the source files. Run it after changing any of them:  python3 build.py

Works with either layout: sources in src/ (as shipped) or at the top level (after a github.com upload
drops the folders). The page goes to public/index.html when a public/ folder exists, else to index.html,
which is where server.js looks for it."""
import os

SRC = 'src' if os.path.isdir('src') else '.'
SCRIPTS = ['rules.js', 'qr.js', 'hosted-adapter.js', 'app.js', 'tickets.js', 'reports.js', 'hosted-ui.js', 'scanner.js']


def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


head, css, body = read('head.html'), read('style.css'), read('body.html')
scripts = [read(n) for n in SCRIPTS]
for n, code in zip(SCRIPTS, scripts):
    assert '</script' not in code, n + ' must not contain </script'

page = (head + css
        + '\n<style>[hidden]{display:none!important}html,body{margin:0}</style></head><body>\n'
        + body
        + ''.join('<script>\n' + code + '\n</script>\n' for code in scripts)
        + '</body></html>\n')

out = os.path.join('public', 'index.html') if os.path.isdir('public') else 'index.html'
with open(out, 'w', encoding='utf-8') as f:
    f.write(page)
with open('public-rules.js', 'w', encoding='utf-8') as f:
    f.write(scripts[0])
print('built', out, len(page.encode('utf-8')), 'bytes')
