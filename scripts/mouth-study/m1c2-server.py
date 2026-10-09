"""Read-only, loopback M1c2 Safari harness. Source and private replay remain in memory.
Only new m1c2 evidence is written beside this script. Baseline uses all baseline JS.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from functools import lru_cache
from urllib.parse import urlsplit
import subprocess, json, base64, re, hashlib, threading

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parents[1]
QA = ROOT / 'refs/qa'
QA.mkdir(parents=True, exist_ok=True)
BASELINE = '98bc3ee'
STATUS = {}
LOCK = threading.Lock()
PRIVATE_CAPTURE = 'refs/live/nova-captures-2026-10-08T21-18-43-294Z.json'
HOOKED = {'index.html', 'js/main.js', 'js/face.js', 'js/facewarp.js', 'js/stage.js', 'js/tuning.js', 'js/voice.js'}

def replace(source, old, new):
    if source.count(old) != 1:
        raise ValueError('M1c2 hook count mismatch')
    return source.replace(old, new, 1)

@lru_cache(None)
def baseline(path):
    return subprocess.check_output(['git', '--no-optional-locks', 'show', BASELINE + ':' + path], cwd=ROOT)

def fingerprints(old):
    if old:
        paths = subprocess.check_output(
            ['git', '--no-optional-locks', 'ls-tree', '-r', '--name-only', BASELINE, '--', 'js/'], cwd=ROOT
        ).decode().splitlines()
        return {path: hashlib.sha256(baseline(path)).hexdigest() for path in paths if path.endswith('.js')}
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT / 'js').rglob('*.js'))}

def instrument(path, source, old=False):
    if path == 'index.html':
        init = {'seed': 0x72acf91, 'initialSeed': 0x72acf91, 'frame': 0, 'errors': [], 'warnings': [],
                'baseline': BASELINE, 'version': 'baseline' if old else 'current', 'sourceHashes': fingerprints(old),
                'shadowEnabled': False, 'comparePixels': False, 'timing': {}, 'visibilityChanges': 0}
        script = '<script>window.__qa=' + json.dumps(init) + ''';
Math.random=()=>{let s=__qa.seed;s^=s<<13;s^=s>>>17;s^=s<<5;__qa.seed=s;return(s>>>0)/4294967296;};
for(const key of ['error','warn']){const original=console[key];console[key]=(...args)=>{__qa[key==='error'?'errors':'warnings'].push('console.'+key);original(...args);};}
addEventListener('error',()=>__qa.errors.push('window.error'));
addEventListener('unhandledrejection',()=>__qa.errors.push('unhandledrejection'));
document.addEventListener('visibilitychange',()=>__qa.visibilityChanges++);
</script>'''
        return source.replace('</head>', script + '</head>')
    if path == 'js/facewarp.js':
        source = replace(source, '    updateWarp(expression, gaze, blink, envelope, shape);',
            '    const qaStart=performance.now();\n    updateWarp(expression, gaze, blink, envelope, shape);\n    qaTime.value=performance.now()-qaStart;')
        source = replace(source, '  function update(clock, expression, gaze, blink, envelope, shape) {',
            '  const qaTime={value:0};\n  function update(clock, expression, gaze, blink, envelope, shape) {')
        return replace(source, '  return { update, applyTuning };',
            '  return { update, applyTuning, qa: { samplePositions, featureLight, updateWarp, mouthHalf, weights, seam, seamStart, seamEnd, qaTime } };')
    if path == 'js/face.js':
        return replace(source, 'mapped: mappedFace.diagnostics,', 'mapped: mappedFace.qa,')
    if path == 'js/voice.js':
        # Extend the factory's public object without repeating its full signature;
        # the historical baseline has no activate() method, while current does.
        pattern = r'^  return \{ (?P<members>[^{}\n]*\bpreload\b[^{}\n]*) \};$'
        def expose_audio(match):
            return """  // Temporary QA: expose only context state/time, never text, PCM, IDs or cues.
  function qaAudioState(){return {state:ac?.state??'absent',currentTime:ac?.currentTime??null};}
  function qaResumeAudio(){ensureAudio();return ac.resume();}
  return { """ + match['members'] + ', qaAudioState, qaResumeAudio };'
        source, count = re.subn(pattern, expose_audio, source, flags=re.MULTILINE)
        if count != 1:
            raise ValueError('M1c2 voice factory hook mismatch')
        return source
    if path == 'js/tuning.js':
        return source + '\nwindow.__qa.sequenceDefinitions=MOUTH_SEQUENCES;\n'
    if path == 'js/main.js':
        source = replace(source, "mode: 'nebula', modeT: 0, clock: 0", "mode: 'face', modeT: 0, clock: 20")
        controls = 'replayCapture,stopAll' if old else 'replayCapture:flow.replayCapture,stopAll:flow.stopAll'
        return source + '\nObject.assign(window.__qa,{face,voice,shapes,state,' + controls + """});
Object.defineProperty(window.__qa,'mouthLab',{get:()=>mouthLab});
const {installMouthQA}=await import('/m1c2-browser.js');await installMouthQA(window.__qa);
"""
    if path == 'js/stage.js':
        source += '\nwindow.__qa.tuning=TUNING;\n'
        source = replace(source, '  function applyTuning() {', '''  const qa=window.__qa;
  Object.assign(qa,{renderer,camera,points,geometry:geom,uniforms,featureClearance,display:DISPLAY_POS,colours:COL,source:POS});
  function applyTuning() {''')
        source = source.replace('headDisplay?.transformPoint(projectPoint);', 'if(!qa.frozen)headDisplay?.transformPoint(projectPoint);')
        # The current renderer also has frameFormMorph(). Its camera/render calls
        # are not this face-only harness's hooks. Select the study loop first.
        marker = '  function frame(nowMs) {'
        if source.count(marker) != 1:
            raise ValueError('M1c2 study frame hook mismatch')
        before, marker, frame = source.partition(marker)
        frame = replace(frame, '    const now = nowMs / 1000, elapsed = now - last, dt = Math.min(0.05, elapsed);',
            '    const qaStart=performance.now();\n    const now = nowMs / 1000, elapsed = now - last, dt = qa.frozen ? 1/60 : Math.min(0.05, elapsed);')
        frame = replace(frame, '    state.clock += dt;', '    if(!qa.frozen)state.clock += dt;')
        frame = replace(frame, '    updateFace(dt, clock);', '''    if(!qa.frozen)updateFace(dt, clock);
    else if(qa.hold){
      qa.heldStep?.(dt);
      qa.heldMapper.update(20,qa.neutral,{x:0,y:0},1,qa.hold.opening,qa.hold.shape);
      for(let i=0;i<FEATURE_END;i++){FACE[i*3]=shapes.BASE[i*3];FACE[i*3+1]=shapes.BASE[i*3+1];}
    }''')
        frame = replace(frame, "    points.rotation.x += ((mode === 'face' ? mouse.y * 0.08 : 0) - points.rotation.x) * Math.min(1, dt * 2);",
            "    points.rotation.x += ((mode === 'face' ? mouse.y * 0.08 : 0) - points.rotation.x) * Math.min(1, dt * 2);\n    if(qa.frozen)points.rotation.set(0,0,0);")
        frame = replace(frame, '    if (headDisplay) headDisplay.apply(POS, DISPLAY_POS, headMix);',
            '    if(qa.frozen)DISPLAY_POS.set(POS);\n    else if (headDisplay) headDisplay.apply(POS, DISPLAY_POS, headMix);')
        frame = replace(frame, '    camera.lookAt(0, 0, 0);',
            '    if(qa.frozen){camera.position.x=0;camera.position.y=0;camera.position.z=mapFitDepth;}\n    camera.lookAt(0, 0, 0);')
        frame = replace(frame, '    composer.render();', '''    composer.render();
    qa.frame++;
    qa.onRender?.({canvas,dt,clock,frameMs:elapsed*1000,cpu:performance.now()-qaStart,
      warpMs:(qa.frozen?qa.heldMapper?.qa:qa.face?.diagnostics?.mapped)?.qaTime?.value||0});''')
        return before + marker + frame
    return source

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        pass
    def data(self, data, mime='application/json'):
        if not isinstance(data, bytes):
            data = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        path = urlsplit(self.path).path.lstrip('/')
        if path == 'm1c2-status':
            with LOCK:
                return self.data(dict(STATUS))
        if path == 'm1c2-browser.js':
            return self.data((TOOLS / path).read_bytes(), 'text/javascript')
        if re.fullmatch(r'm1c2-[A-Za-z0-9_-]+\.(?:html|png|json|txt)', path):
            evidence = (QA / path).resolve()
            if evidence.is_relative_to(QA) and evidence.is_file():
                return self.data(evidence.read_bytes(), self.guess_type(path))
            return self.send_error(404)
        old = path.startswith('baseline/')
        if old:
            path = path[len('baseline/'):]
        path = path or 'index.html'
        try:
            target = (ROOT / path).resolve()
            if not target.is_relative_to(ROOT) or any(part.startswith('.') for part in Path(path).parts):
                return self.send_error(404)
            if path.startswith('refs/live/') and path != PRIVATE_CAPTURE:
                return self.send_error(404)
            data = baseline(path) if old and path.startswith('js/') else target.read_bytes()
            if path in HOOKED:
                data = instrument(path, data.decode(), old).encode()
            return self.data(data, self.guess_type(path))
        except Exception:
            if path.endswith('.js'):
                return self.data(b'throw Error("M1c2 module serving failure");', 'text/javascript')
            return self.send_error(404)
    def do_POST(self):
        try:
            obj = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            if self.path == '/m1c2-status':
                with LOCK:
                    STATUS[obj['version']] = obj
                    (QA / 'm1c2-status.json').write_text(json.dumps(STATUS, indent=2) + '\n')
                return self.data({'ok': True})
            if self.path != '/m1c2-write':
                return self.send_error(404)
            name = obj.pop('name')
            image = obj.pop('image', None)
            if not re.fullmatch(r'm1c2-[A-Za-z0-9_-]+', name):
                return self.send_error(400)
            if image:
                (QA / (name + '.png')).write_bytes(base64.b64decode(image.split(',', 1)[1]))
            (QA / (name + '.json')).write_text(json.dumps(obj, indent=2) + '\n')
            return self.data({'ok': True})
        except Exception:
            return self.send_error(400)

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 4204), Handler).serve_forever()
