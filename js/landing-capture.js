import { createCaptureRecorder } from './capture.js';

// Opt-in review tools for the main experience. Only the local output player is
// observed; microphone audio, provider identifiers and user transcripts stay out.
export function createLandingCapture({ stream, controls, host = window }) {
  const recorder = createCaptureRecorder(stream, { onChange: update });
  function update() {
    const count = recorder.count;
    controls.download.textContent = `Download captures (${count})`;
    controls.download.disabled = controls.text.disabled = count === 0;
  }
  function save(session, contents, type, prefix, extension) {
    const url = host.URL.createObjectURL(new host.Blob([contents], { type }));
    const link = host.document.createElement('a');
    link.href = url;
    link.download = `${prefix}-${session.capturedAt.replace(/[:.]/g, '-')}.${extension}`;
    host.document.body.append(link);
    link.click();
    link.remove();
    host.setTimeout(() => host.URL.revokeObjectURL(url), 1000);
  }
  controls.capture.addEventListener('change', () => recorder.setEnabled(controls.capture.checked));
  controls.download.addEventListener('click', () => {
    const session = recorder.snapshot();
    if (session.replies.length) save(session, JSON.stringify(session), 'application/json', 'nova-captures', 'json');
  });
  controls.text.addEventListener('click', () => {
    const session = recorder.snapshot();
    if (!session.replies.length) return;
    const replies = session.replies.map((reply, i) =>
      `Reply ${i + 1}${reply.interrupted ? ' (interrupted)' : ''}\n${reply.text}`).join('\n\n');
    save(session, `Seni replies — ${session.capturedAt}\n\n${replies}\n`,
      'text/plain;charset=utf-8', 'seni-replies', 'txt');
  });
  recorder.setEnabled(controls.capture.checked);
  update();
}
