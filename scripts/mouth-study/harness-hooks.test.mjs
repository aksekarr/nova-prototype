import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Import only the instrumenters. No HTTP server starts, no browser runs, and no
// capture file is opened: inputs are the tracked HTML/JS or historical Git blobs.
const result = spawnSync('python3', ['-B', '-c', String.raw`
import importlib.util, json, pathlib, re, subprocess, sys
root = pathlib.Path.cwd()
def load(name):
    spec = importlib.util.spec_from_file_location(name, root / 'scripts/mouth-study' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
m2, m3 = load('m1c2-server'), load('m1c3-server')
results = []
for harness, old in [('m1c2', False), ('m1c2', True), ('m1c3', False)]:
    entry = {'harness': harness, 'old': old, 'paths': [], 'mainBinding': None}
    for path in sorted(m2.HOOKED):
        source = m2.source_bytes(path, old).decode()
        output = m2.instrument(path, source, old) if harness == 'm1c2' else m3.instrument(path, source)
        if path.endswith('.html'):
            expected = m2.baseline('index.html') if old else (root / 'study.html').read_bytes()
            assert source.encode() == expected
            assert 'src="./js/main.js"' in output and 'src="./js/landing.js"' not in output
            assert 'id="wake"' in output and 'id="r-voice"' in output
            assert output.count('window.__qa=') == 1
        scripts = [output] if path.endswith('.js') else re.findall(r'<script>(.*?)</script>', output, re.S)
        for script in scripts:
            checked = subprocess.run([sys.argv[1], '--input-type=module', '--check'], input=script,
                                     text=True, capture_output=True)
            if checked.returncode:
                raise AssertionError(harness + ':' + str(old) + ':' + path + '\n' + checked.stderr)
        entry['paths'].append(path)
        if path == 'js/main.js':
            entry['mainBinding'] = re.search(r'Object.assign\(window\.__qa,\{face,voice,shapes,state,.*?\}\);', output)[0]
            assert '/' + harness + '-browser.js' in output
        if path == 'js/voice.js':
            exported = re.search(r'^  return \{ ([^{}\n]*\bpreload\b[^{}\n]*) \};$', output, re.M)[1]
            assert 'qaAudioState' in exported and 'qaResumeAudio' in exported
            assert ('activate' in exported) == (not old)
        if path == 'js/stage.js':
            before, _, frame = output.partition('  function frame(nowMs) {')
            assert 'qa.onRender?.(' not in before
            assert frame.count('qa.onRender?.(') == 1
            assert frame.count('if(qa.frozen){camera.position.x=0;') == 1
    results.append(entry)
# Exercise actual request routing without opening a socket or reading captures.
for module, requests in [(m2, [('/', False), ('/index.html?tune=1', False),
                               ('/study.html?tune=1', False), ('/baseline/', True),
                               ('/baseline/index.html?tune=1', True), ('/baseline/study.html', True)]),
                         (m3, [('/', False), ('/index.html?tune=1', False), ('/study.html', False)])]:
    for request, historical in requests:
        served = []
        handler = module.Handler.__new__(module.Handler)
        handler.path = request
        handler.data = lambda data, mime: served.append((data, mime))
        handler.send_error = lambda code: (_ for _ in ()).throw(AssertionError('HTTP ' + str(code)))
        handler.do_GET()
        assert len(served) == 1, request
        html, mime = served[0]
        assert mime == 'text/html', request
        assert b'src="./js/main.js"' in html and b'id="wake"' in html, request
        assert b'src="./js/landing.js"' not in html, request
        assert ('"version": "' + ('baseline' if historical else 'current') + '"').encode() in html
print(json.dumps(results))
`, process.execPath], {
  cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', maxBuffer: 1024 * 1024
});

test('all historical/current M1c2 and current M1c3 hooks produce valid JavaScript', () => {
  assert.equal(result.status, 0, result.stderr);
  const reports = JSON.parse(result.stdout);
  assert.equal(reports.length, 3);
  for (const report of reports) {
    assert.ok(report.paths.includes('js/main.js'));
    assert.ok(report.paths.includes('js/stage.js'));
    assert.ok(report.paths.includes('js/voice.js'));
  }
});

test('instrumented QA entry exposes the correct current and historical playback methods', () => {
  assert.equal(result.status, 0, result.stderr);
  for (const report of JSON.parse(result.stdout)) {
    const replayCapture = () => {}, stopAll = () => {};
    const context = { window: { __qa: {} }, face: {}, voice: {}, shapes: {}, state: {},
      ...(report.old ? { replayCapture, stopAll } : { flow: { replayCapture, stopAll } }) };
    vm.runInNewContext(report.mainBinding, context);
    assert.equal(context.window.__qa.replayCapture, replayCapture);
    assert.equal(context.window.__qa.stopAll, stopAll);
  }
});
