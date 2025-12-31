<p align="center">
  <img src="docs/images/icon.png" alt="ScrollLearn Logo" width="128" height="128">
</p>

<h1 align="center">ScrollLearn</h1>

<p align="center">
  <strong>Learn while you scroll</strong> - A Chrome extension that injects spaced repetition flashcard quizzes into your social media feeds.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Features

- **Feed Integration**: Quizzes appear naturally in Facebook and YouTube feeds after scrolling past N posts
- **Spaced Repetition**: SM-2 algorithm for optimal learning retention
- **Multiple Card Types**: 
  - Text (type your answer)
  - Multiple Choice (single select)
  - Multi-Select (check all correct answers)
  - Cloze (fill in the blanks)
  - Audio (listen and respond)
- **Import Formats**: Quizlet-like simple format, CSV, and JSON
- **Fuzzy Matching**: Intelligent answer matching with configurable thresholds
- **Progress Tracking**: Statistics, streaks, and review history
- **Keyboard Navigation**: Answer quickly with keyboard shortcuts
- **Customizable**: Configure quiz frequency, matching sensitivity, and more

## Installation

### Development Build

1. Clone the repository:
   ```bash
   git clone https://github.com/tasszz2k/scroll-learn.git
   cd scroll-learn
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### Development Mode

For development with hot-reload:

```bash
npm run dev
```

Then load the `dist` folder as an unpacked extension.

## Usage

### Creating Decks and Cards

1. Click the ScrollLearn extension icon or go to the options page
2. In the **Decks** tab, click "New Deck"
3. Click on a deck to expand it, then "Add Card"
4. Choose a card type and fill in the details

### Importing Cards

#### Simple Format (Quizlet-like)
```
Question 1|Answer 1
Question 2|Answer 2
[deck:Spanish]Hola|Hello
Capital of France?|Paris|London|Berlin|Madrid
```

#### CSV Format
```csv
front,back,kind,options,correct
What is 2+2?,4,text,,
Pick the color,Red,mcq-single,Red|Blue|Green,0
```

#### JSON Format
```json
[
  { "front": "Question", "back": "Answer", "kind": "text" },
  { 
    "front": "Pick one", 
    "back": "A", 
    "kind": "mcq-single",
    "options": ["A", "B", "C"],
    "correct": 0
  }
]
```

### Answering Quizzes

When a quiz appears in your feed:
- **MCQ**: Click an option or press 1-4
- **Text**: Type your answer
- **Cloze**: Fill in each blank
- Press **Enter** to submit
- Press **Escape** to skip (snooze for 10 minutes)
- Click **Pause 30m** to pause quizzes on the site

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| 1-4 | Select MCQ option |
| Enter | Submit answer |
| Escape | Skip card (snooze 10 min) |

## Configuration

In the **Settings** tab:

- **Quiz Behavior**
  - Show after N posts (1-20)
  - Pause after quiz (0-60 minutes)

- **Enabled Sites**
  - Toggle Facebook/YouTube

- **Answer Matching**
  - Characters to ignore
  - Case sensitivity
  - Fuzzy matching thresholds

## Architecture

```
src/
  background/       # Service worker, SM-2 scheduler
  content/          # Feed detection, quiz injection
  dashboard/        # React dashboard UI
  popup/            # Extension popup for quick access
  common/           # Shared types, storage, parsers
```

### Key Components

- **Background Service Worker**: Handles card scheduling, storage, and messaging
- **Content Scripts**: Detect feed posts and inject quiz UI
- **Dashboard**: React app for deck/card management and import
- **Popup**: Quick access to stats and settings

### SM-2 Scheduling

Cards are scheduled using the SM-2 algorithm:
- **Grade 0 (Again)**: Reset to 1 day, reduce ease
- **Grade 1 (Hard)**: Small interval, slight ease reduction
- **Grade 2 (Good)**: Standard progression
- **Grade 3 (Easy)**: Bonus interval, increase ease

## Development

### Project Structure

```
scroll-learn/
  src/
    background/     # Service worker
    content/        # Content scripts
    dashboard/      # React dashboard
    common/         # Shared utilities
    popup/          # Extension popup
    styles/         # CSS files
  tests/            # Unit tests
  samples/          # Sample decks
  docs/             # Documentation and sample files
  public/           # Static assets
```

### Scripts

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run test      # Run tests
npm run lint      # Lint code
```

### Testing

```bash
npm run test
```

Tests cover:
- Parser functions (normalizeText, parseSimpleLine, etc.)
- SM-2 scheduler (grade calculations, intervals)

### Extending to New Sites

1. Create a new detector in `src/content/`:
   ```typescript
   export const newSiteDetector: DomainDetector = {
     name: 'NewSite',
     domain: /newsite\.com$/i,
     getPostSelector: () => 'article',
     getFeedContainer: () => document.querySelector('main'),
     isValidPost: (el) => /* validation */,
     getInsertionPoint: (post) => post,
     getPostId: (post) => /* unique ID */,
   };
   ```

2. Add to content script domain detection
3. Update manifest host_permissions

## Sample Decks

Import sample decks from the `samples/` or `docs/samples/` folders:
- `language-deck.json` - Spanish basics
- `programming-deck.json` - Programming concepts
- `spanish-basics.txt` - Simple format Spanish vocabulary
- `javascript-fundamentals.txt` - JavaScript quiz questions
- `world-capitals.csv` - Geography flashcards (CSV format)
- `react-concepts.json` - React concepts (JSON format)

## Tech Stack

- **Framework**: React + TypeScript
- **Build**: Vite + @crxjs/vite-plugin
- **Styling**: Tailwind CSS
- **Storage**: Chrome Storage API
- **Testing**: Vitest

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Submit a pull request

## License

MIT License - See LICENSE file for details.

## Roadmap

- [ ] Anki .apkg import/export
- [ ] Cloud sync
- [ ] More site support (Twitter/X, Reddit)
- [ ] Image cards
- [ ] Deck sharing
- [ ] Spaced repetition statistics visualization
