# @superinstance/player

**Embeddable web player widget for LucidDreamer.AI streams.**

A glassmorphism HLS audio player with real-time visualizer, now-playing polling, and listener feedback. Drop it into any website.

## Install

```bash
npm install @superinstance/player
```

## Quick Start

### As a standalone page

Open `index.html` in a browser or serve it with any static host. Configure the stream URL and API endpoints in the `<script>` section.

### Embedded in a site

```html
<link rel="stylesheet" href="@superinstance/player/style.css">

<div id="luciddreamer-player"></div>

<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
<script src="@superinstance/player/app.js"></script>
```

### Configuration

```javascript
// Override defaults before loading app.js
window.LD_PLAYER_CONFIG = {
  streamUrl: 'https://stream.luciddreamer.ai/live/index.m3u8',
  nowPlayingEndpoint: 'https://now-playing.luciddreamer.ai/api/now-playing',
  feedbackEndpoint: 'https://feedback.luciddreamer.ai/api/feedback',
  pollInterval: 10000,
};
```

## Features

- **HLS streaming** — uses hls.js with graceful fallback to native HLS (Safari/iOS)
- **Real-time visualizer** — Web Audio API frequency analysis with mirror-symmetric bars
- **Now-playing polling** — fetches current track metadata from the now-playing worker
- **Listener feedback** — submit feedback to the fleet, with offline retry
- **Progress bar** — seekable, keyboard accessible, touch-friendly
- **Up next** — shows the upcoming schedule
- **Media Session API** — OS-level media controls (lock screen, media keys)
- **Responsive** — mobile-first, works from 320px to desktop
- **Accessible** — ARIA labels, keyboard navigation, reduced motion support, high contrast mode

## Configuration Endpoints

The player expects three Cloudflare Workers (or compatible APIs):

1. **Stream URL** — HLS `.m3u8` endpoint
2. **Now-Playing** — `GET /api/now-playing` returns `{ title, model, mood, description, durationSeconds, elapsedSeconds, upNext[], listenerCount }`
3. **Feedback** — `POST /api/feedback` accepts `{ feedback, track, timestamp }`

## Standalone Deployment

Deploy to Cloudflare Pages:

```bash
npx wrangler pages deploy . --project-name luciddreamer-player
```

## License

MIT
