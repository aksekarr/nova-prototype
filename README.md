# Nova — prototype

Serve the static files with `python3 -m http.server 4173`, then open
`http://localhost:4173/` in Safari. Select **Face** or **Wake Nova**.

The default face is the light-stroke design. Add `?face=v1` for the preserved
original, or `?tune=1` for live lip prominence, eye glow, rim strength, interior
density and dissolve controls. Tuning is temporary and resets on reload.

Both designs use the same expressions, voice envelope, mouth shapes and sequence.
The new seeded geometry is appended after all existing random draws.
