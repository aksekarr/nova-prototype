"""Separate loopback preview; source served with temporary hooks only."""
import importlib.util, json
from pathlib import Path
from urllib.parse import urlsplit
from http.server import ThreadingHTTPServer

TOOLS = Path(__file__).resolve().parent
OUT = TOOLS.parents[1] / 'refs/qa'
OUT.mkdir(parents=True, exist_ok=True)
SPEC = importlib.util.spec_from_file_location('previous_qa', TOOLS / 'm1c2-server.py')
old = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(old)

def instrument(path, source):
    data = old.instrument(path, source)
    if path == 'js/main.js':
        data = old.replace(data, '/m1c2-browser.js', '/m1c3-browser.js')
    return data

class Handler(old.Handler):
    def do_GET(self):
        path = urlsplit(self.path).path.lstrip('/') or 'index.html'
        if path == 'm1c3-browser.js':
            return self.data((TOOLS / path).read_bytes(), 'text/javascript')
        if path.startswith(('refs/live/', 'baseline/')):
            return self.send_error(404)
        if path in old.HOOKED:
            data = instrument(path, old.source_bytes(path).decode())
            return self.data(data.encode(), self.guess_type(path))
        return super().do_GET()

    def do_POST(self):
        if self.path != '/m1c3-check':
            return self.send_error(404)
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size < 100000:
                return self.send_error(400)
            obj = json.loads(self.rfile.read(size))
            allowed = {'kind','variant','word','speed','opening','shapeTargets','sequence','frames','finite','seen','minimumAperture','maximumClosure','errors','viewport','browser','clock','playing'}
            if not isinstance(obj, dict) or set(obj) - allowed:
                return self.send_error(400)
            with old.LOCK:
                with (OUT / 'm1c3-preview-checks.jsonl').open('a') as f:
                    f.write(json.dumps(obj) + '\n')
            return self.data({'ok': True})
        except Exception:
            return self.send_error(400)

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 4205), Handler).serve_forever()
