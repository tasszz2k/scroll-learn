# ScrollLearn Sample Data

This folder contains sample flashcard decks that you can import into the ScrollLearn extension.

## Available Samples

### Simple Text Format (.txt)
These files use the simple Quizlet-like format with `|` as a separator.

- **spanish-basics.txt** - Basic Spanish vocabulary (20 cards)
- **javascript-fundamentals.txt** - JavaScript core concepts (20 cards)
- **math-basics.txt** - Mental math practice (15 cards)

### CSV Format (.csv)
CSV files with full column support for different card types.

- **world-capitals.csv** - World geography capitals (15 text cards)
- **programming-mcq.csv** - Programming multiple choice questions (10 MCQ cards)

### JSON Format (.json)
Full-featured JSON format supporting all card types.

- **react-concepts.json** - React hooks and fundamentals (10 cards, mixed types)
- **git-commands.json** - Essential Git commands (15 text cards)

## How to Import

1. Open the ScrollLearn extension options page
2. Navigate to the "Import" tab
3. Select your import format (Simple, CSV, or JSON)
4. Paste the content or upload the file
5. Preview the cards and click "Import"

## Format Reference

### Simple Format
```
[deck:Deck Name]
Question|Answer
Another question|Another answer
```

### CSV Format
```
deck,kind,front,back,options,correct,fuzziness,mediaUrl,tags
My Deck,text,Question?,Answer,,,0.85,,tag1|tag2
My Deck,mcq-single,Question?,,Option1|Option2|Option3,0,,,tag1
```

### JSON Format
```json
[
  {
    "deckName": "My Deck",
    "kind": "text",
    "front": "Question?",
    "back": "Answer",
    "tags": ["tag1", "tag2"]
  }
]
```

## Card Types

- **text** - Free text answer with fuzzy matching
- **mcq-single** - Multiple choice, single answer
- **mcq-multi** - Multiple choice, multiple answers
- **cloze** - Fill in the blank (use {{blank}} syntax)
- **audio** - Audio-based questions (requires mediaUrl)

