# Strudel Interactive Sound Page

An interactive web page where sounds play based on pointer position - both when hovering over elements and when the pointer is near elements (proximity-based). Supports both synthesized sounds (via Web Audio API) and pre-recorded audio files.

## Features

- **Hover Detection**: Sounds trigger when the pointer hovers over elements
- **Proximity Detection**: Sounds trigger when the pointer is near elements (configurable threshold)
- **Synthesized Sounds**: Generated drum patterns using Web Audio API
- **Pre-recorded Audio**: Support for audio file playback (MP3, WAV, etc.)
- **Adjustable Controls**: 
  - Proximity threshold (20-200px)
  - Enable/disable hover sounds
  - Enable/disable proximity sounds
  - Volume control (0-100%)

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

This will start the Vite development server, typically at `http://localhost:3000`.

### Building for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Usage

1. **Enable Audio**: Click anywhere on the page to enable audio (required for Web Audio API)
2. **Move Your Pointer**: Hover over or move near the interactive elements to trigger sounds
3. **Adjust Settings**: Use the controls panel to adjust proximity threshold, enable/disable triggers, and control volume

## Adding Audio Files

Place your audio files in the `assets/sounds/` directory and update the paths in `src/config.js`.

Example:
```javascript
{
  id: 'element-4',
  selector: '[data-sound-id="element-4"]',
  type: 'audio',
  audioFile: '/assets/sounds/sample1.mp3',
  description: 'Pre-recorded sample 1'
}
```

## Customizing Sounds

Edit `src/config.js` to:
- Change synthesized patterns (currently supports: bd, sd, hh, cp)
- Add or remove elements
- Change audio file paths
- Adjust default settings

## Project Structure

```
├── src/
│   ├── main.js          # Entry point - wires everything together
│   ├── soundManager.js  # Handles sound synthesis and playback
│   ├── pointerTracker.js # Detects hover and proximity
│   ├── ui.js            # UI controls handler
│   ├── config.js        # Sound mappings and settings
│   └── styles.css       # Styling
├── assets/
│   └── sounds/          # Audio files directory
├── index.html           # Main HTML page
└── vite.config.js       # Vite configuration
```

## Browser Support

Requires modern browsers with Web Audio API support:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## Notes

- Audio context initialization requires user interaction (click, touch, or keypress)
- Synthesized sounds use simple pattern parsing for drum sounds (bd=kick, sd=snare, hh=hihat, cp=clap)
- Audio files are cached after first load for better performance

