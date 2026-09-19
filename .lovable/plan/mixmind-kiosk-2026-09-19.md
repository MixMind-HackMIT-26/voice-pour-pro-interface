# MixMind kiosk

## Build
- Replace the starter page with one fixed 1024×600 touch interface and no scrolling or hover-dependent behavior.
- Implement all seven machine states with large high-contrast copy, inline SVG visuals, voice gauges, timed pouring progress, stirring, and serving.
- Poll `/api/state` every 200 ms, send start/reset commands, and automatically switch to a looping built-in demo when requested or disconnected.
- Use only bundled code, system fonts, semantic local styling, and inline artwork so the interface works fully offline.

## Verification
- Check the 1024×600 layout and touch interactions in the live preview.
- Confirm demo mode cycles through every state and displays its DEMO marker.
- Confirm the production build succeeds and every content page has MixMind metadata.

## Technical details
- Keep machine state and timing in a focused React controller on the index route.
- Derive active pour fill from `started_at_ms` and `duration_ms`; represent stirring after the final pour.
- Use CSS transitions with reduced-motion support and hard viewport overflow guards.
