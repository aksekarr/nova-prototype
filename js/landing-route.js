// Keep existing study links working without starting the landing renderer first.
// Resolving a route is pure: it neither navigates nor starts a voice session.
export function resolveLandingRoute(href) {
  const source = new URL(href);
  const params = source.searchParams;
  if (params.get('tune') === '1' || params.get('live') === '1') {
    const target = new URL('./study.html', source);
    target.search = source.search;
    target.hash = source.hash;
    return target.href === source.href ? null : target.href;
  }
  if (params.get('orbit') === '1') {
    const target = new URL('./orbit.html', source);
    if (params.has('n')) target.searchParams.set('n', params.get('n'));
    return target.href;
  }
  return null;
}
