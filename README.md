# Dispatchlist

Driver Check-In Portal for Classic Towing. A single-page HTML app for dispatchers to track drivers on shift and assign calls. This is the live Pages site at [`elmerzc.github.io/Dispatchlist`](https://elmerzc.github.io/Dispatchlist/) — it's kept public specifically to keep that URL working.

> **Note:** There's a related (newer / more formalized) version of the same concept at [`dispatch-portal`](https://github.com/elmerzc/dispatch-portal). Dispatchlist is the original; worth consolidating at some point.

## What it does

Lets the dispatcher see who's on shift, when each driver checked in, and who's up next for a call. Uses a round-based queue to distribute calls fairly across drivers.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Single-page HTML + Tailwind (via CDN) |
| Hosting | GitHub Pages (`elmerzc.github.io/Dispatchlist`) |
| Backend | None — fully client-side |

## Files

```
index.html      Main app (everything lives here)
backend/        Reserved for future backend work
```

## Live URL

[https://elmerzc.github.io/Dispatchlist/](https://elmerzc.github.io/Dispatchlist/)

## Related Repos

- [`dispatch-portal`](https://github.com/elmerzc/dispatch-portal) — Newer / more formal version of the same driver check-in portal concept.
