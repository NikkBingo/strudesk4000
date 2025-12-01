<!--
  Strudesk 4000
  Copyright 2025 eKommissar. All Rights Reserved.
-->

# Strudel Interactive Sound Page

Strudel turns any modern browser into an exploratory sound surface. Every interactive element on the page responds to pointer hover and proximity, blending Web Audio synthesis with curated samples so visitors can sculpt evolving textures without touching a DAW. The experience is optimized for touchpads, tablets, and large-format installations where wanderers are encouraged to “play the interface.”

## At a Glance
- **Dual Trigger Modes** – Hover-based and proximity-based detection share the same routing graph so you can mix subtle ambience with deliberate hits.
- **Hybrid Sound Engine** – Web Audio synth voices (bd, sd, hh, cp) run next to user-provided WAV/MP3 samples with per-element gain staging.
- **Adaptive UI** – Settings such as proximity radius, trigger toggles, waveform banks, and volume persist via `settingsStore` for consistent sessions.
- **Install Anywhere** – Ships as a Vite SPA; deploy on any static host or bundle into kiosk hardware.

## Table of Contents
1. [Project Overview](#project-overview)
2. [User Manual](#user-manual)
   - [Prerequisites](#prerequisites)
   - [First Run](#first-run)
   - [Exploring the Interface](#exploring-the-interface)
   - [Control Panel Reference](#control-panel-reference)
   - [Advanced Tweaks](#advanced-tweaks)
   - [Troubleshooting](#troubleshooting)
3. [Development Workflow](#development-workflow)
4. [Customization Guide](#customization-guide)
5. [Project Structure](#project-structure)
6. [Browser Support](#browser-support)
7. [License](#license)

## Project Overview
The system is composed of three cooperating layers:
- **Pointer tracker** monitors cursor position and computes distances to registered hit zones with throttled RAF updates.
- **Sound manager** owns the single AudioContext, instantiates synth voices, and pools sample buffers to minimize latency.
- **UI components** (e.g., `SettingsPanel`, `TheoryControls`) expose high-level toggles so non-technical operators can curate the experience live.

All logic lives in vanilla JavaScript for straightforward auditing and customization.

## User Manual

### Prerequisites
- A Chromium, Firefox, or Safari browser released within the last 18 months.
- Speakers or headphones connected to the host device.
- Optional: touch-enabled display or trackpad for fine-grained proximity control.

### First Run
1. **Install dependencies**  
   ```bash
   npm install
   ```
2. **Start the dev server**  
   ```bash
   npm run dev
   ```  
   Visit the printed URL (defaults to `http://localhost:3000`).
3. **Enable audio**  
   Click or tap anywhere on the canvas to unlock the AudioContext (browser security requirement).

### Exploring the Interface
1. Move the pointer around the highlighted elements to trigger hover sounds.
2. Drift near the borders to hear proximity swells; the default radius is 80 px.
3. Watch the visual indicators—the brighter the element, the closer you are to firing a sample.

### Control Panel Reference
- **Master Volume** – Scales the output gain node (0–100%). Keep headroom when loading external samples.
- **Hover / Proximity Toggles** – Enable each trigger mode independently for isolated testing.
- **Proximity Threshold Slider** – Set 20–200 px listening radius. Smaller values reduce accidental hits.
- **Waveform & Drum Banks** – Pick preset synth banks defined in `src/constants/banks.js`.
- **Sample Bank Picker** – Switch between curated sample sets stored under `assets/sounds/`.
- **Theory Controls** – Lock interaction to a musical scale or chord set when integrating with external gear.

Settings persist locally; reset them via the “Restore Defaults” button if behaviors seem off.

### Advanced Tweaks
- **Mapping New Elements** – Edit `src/config.js` to register DOM selectors with synth/sample definitions.
- **MIDI / OSC Bridges** – Use the exposed Web Audio nodes in `soundManager.js` as insert points for external routing.
- **Performance** – Disable proximity mode during crowded experiences, or lower the render loop frequency in `pointerTracker.js`.

### Troubleshooting
- **No sound after enabling** – Ensure browser tab has focus; Safari sometimes blocks audio until a second tap.
- **Clicks or pops** – Reduce master volume and confirm samples share the same sample rate.
- **Laggy cursor** – Disable proximity mode or reduce the number of active elements in `config.js`.
- **Persistent settings mismatch** – Clear `localStorage` entry `strudel-settings` or use the UI reset button.

## Development Workflow

### Build Commands
```bash
npm run dev      # Start Vite in watch mode
npm run build    # Generate production assets
npm run preview  # Serve the production build locally
```

Artifacts under `dist/` can be deployed to Netlify, Vercel, GitHub Pages, or any static hosting platform.

## Customization Guide

### Adding Audio Files
Place your audio under `assets/sounds/` and reference it inside `src/config.js`:
```javascript
{
  id: 'element-4',
  selector: '[data-sound-id=\"element-4\"]',
  type: 'audio',
  audioFile: '/assets/sounds/sample1.mp3',
  description: 'Pre-recorded sample 1'
}
```

### Editing Synth Patterns
Inside `config.js`, update the `pattern` strings (bd, sd, hh, cp). Patterns use a simple step sequencer notation where `x` = hit and `.` = rest.

### Deeper Styling
`src/styles.css` controls the neon aesthetic. For kiosk deployments, lock fonts locally and adjust the CSS custom properties at the top of the file.

## Project Structure
```
├── src/
│   ├── main.js            # Entry point - wires everything together
│   ├── soundManager.js    # Handles sound synthesis and playback
│   ├── pointerTracker.js  # Detects hover and proximity
│   ├── ui.js              # UI controls handler
│   ├── config.js          # Sound mappings and settings
│   └── styles.css         # Styling
├── assets/
│   └── sounds/            # Audio files directory
├── index.html             # Main HTML page
└── vite.config.js         # Vite configuration
```

## Browser Support
- Chrome / Edge (latest)
- Firefox (latest)
- Safari (latest)

## License
Strudel is distributed under the [GNU Affero General Public License v3.0](LICENSE). Commercial use is permitted as long as your network-facing modifications remain open. For alternative licensing terms, contact the maintainers.

