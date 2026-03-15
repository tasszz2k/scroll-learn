# Scroll-Learn CSV Import Format

## Header

```
deck,kind,front,back,options,correct,fuzziness,mediaUrl,tags
```

## Column Definitions

| Column | Required | Description |
|---|---|---|
| deck | No | Deck name. Use `Grammar Police - Grammar` or `Grammar Police - Vocabulary` |
| kind | No | Card type: `text`, `mcq-single`, `mcq-multi`, `cloze`. Defaults to `text` |
| front | Yes | Question text displayed to the user |
| back | Yes* | Answer text. *For MCQ, derived from options+correct if omitted |
| options | MCQ only | Pipe-separated options: `opt1\|opt2\|opt3\|opt4` |
| correct | MCQ only | 0-based index of the correct option |
| fuzziness | No | Leave empty (uses system defaults) |
| mediaUrl | No | Leave empty (not used for grammar cards) |
| tags | No | Pipe-separated tags: `spelling\|verb-form` |

## Card Type Rules

### text

Question with a typed answer. Good for spelling, short translations, fill-in.

- `back` supports multiple accepted answers via `||` separator
- Keep answers 1-5 words to avoid frustrating typo failures

```csv
Grammar Police - Grammar,text,What is the correct spelling of 'reasign'?,reassign,,,,, spelling
Grammar Police - Vocabulary,text,Translate to Vietnamese: exemptions,miễn trừ,,,,, vocabulary
```

### mcq-single

Multiple choice with one correct answer.

- Provide exactly 4 options (pipe-separated)
- `correct` is the 0-based index of the right answer
- `back` can be omitted (derived from options[correct])
- Shuffle happens at display time -- order in CSV does not matter for learning

```csv
Grammar Police - Grammar,mcq-single,Which sentence is correct?,,We have discussed this|We has discussed this|We having discussed this|We had discuss this,0,,,,verb-form
Grammar Police - Grammar,mcq-single,Choose the correct word: 'Please ___ this example.',,follow|following|follows|followed,0,,,,word-choice
```

### cloze

Fill-in-the-blank. The `front` contains `{{answer}}` markers.

- The blanked word appears as `___` to the user
- `back` should contain the answer word
- Keep the blank to a single word or short phrase

```csv
Grammar Police - Grammar,cloze,"Other {{configurations}} still require user input.",configurations,,,,, plural
Grammar Police - Grammar,cloze,"I {{have}} already discussed this with the team.",have,,,,, verb-form
Grammar Police - Vocabulary,cloze,"The Vietnamese word for 'synthesize' is {{tổng hợp}}.",tổng hợp,,,,, vocabulary
```

## Quoting Rules

- Wrap values in double quotes if they contain commas, quotes, or newlines
- Escape quotes inside quoted values by doubling them: `""` -> `"`
- Front/back text with commas MUST be quoted

## Complete Example

```csv
deck,kind,front,back,options,correct,fuzziness,mediaUrl,tags
Grammar Police - Grammar,mcq-single,Which is correct?,,We have discussed this|We has discussed this|We having discussed|We had discuss,0,,,,verb-form
Grammar Police - Grammar,text,Correct the spelling: 'enterperise',enterprise,,,,, spelling
Grammar Police - Grammar,cloze,"Please {{follow}} this example.",follow,,,,, word-choice
Grammar Police - Grammar,text,"What article fits: '___ AI era'?",the,,,,, article
Grammar Police - Grammar,mcq-single,"Choose the correct plural:",,"other configurations|other configuration|other configuring|other configured",0,,,,plural
Grammar Police - Vocabulary,mcq-single,"What does 'omitted' mean in Vietnamese?",,bỏ qua|tổng hợp|miễn trừ|chuyên môn,0,,,,vocabulary
Grammar Police - Vocabulary,text,"Translate to English: 'tổng hợp'",synthesize,,,,, vocabulary
Grammar Police - Vocabulary,cloze,"The English word for 'miễn trừ' is {{exemptions}}.",exemptions,,,,, vocabulary
```
