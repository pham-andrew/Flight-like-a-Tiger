# Flight-like-a-Tiger

A Phaser 3 tilemap-based game built with Tiled map editor integration and interactive dialog systems.

## Developer Startup Instructions

### Prerequisites
- Node.js (v12 or higher)
- npm (comes with Node.js)

### Initial Setup

1. **Clone or navigate to the project directory**
   ```bash
   cd Flight-like-a-Tiger
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```
   This launches Browser-sync, which automatically opens the game in your browser at `http://localhost:3000` (or similar).

### Development

- **The game runs locally** with hot-reload enabled. Any changes to files are automatically detected and the browser refreshes.
- **Main entry point**: `index.js` contains the Phaser game configuration, scene logic, dialog handling, and inventory system.
- **Map files**: TMX files are located in `assets/` and referenced in the game. Each tileset image used by a TMX must be manually loaded in the `preload()` function.
- **Assets**: 
  - `assets/dialog/` - NPC dialog scripts
  - `assets/sounds/` - Audio files and pitch configuration
  - `assets/femalestudent/` - Character sprite animations
  - `assets/atlas/` - Sprite atlases and tilesets

### Key Features to Know

- **Dialog System**: Dialog supports bracketed sound tokens like `[hello.wav] text` for audio playback during interactions. Use `/help` in-game for console commands.
- **Inventory System**: Items have internal IDs and metadata. Use `/inventory` to check player inventory and `/about itemname` for item descriptions.
- **Speech Synthesis**: NPC dialog is synthesized using the Web Audio API. Pitch can be customized in `assets/sounds/pitch.txt`.
- **In-Game Console**: A persistent bottom console displays dialog, player feedback, and supports slash commands.

### Available npm Scripts

- `npm run dev` - Start development server with hot-reload
- `npm run serve` - Alias for dev
- `npm run prettier` - Format code files
- `npm run deploy` - Deploy to GitHub Pages

### Debugging Tips

- Open browser DevTools (F12) to see console errors and logs.
- Check that all tileset images referenced in TMX files are loaded in the `preload()` function.
- Verify spawn points in Tiled use names like `PlayerSpawn` or `Start`.
- Use the in-game console (`/help` command) to explore available debugging commands.