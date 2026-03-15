# Output Templates

Examples of each output file. Use these as structural guides, not rigid templates.
Adapt content length and detail to the actual data volume.

## report.md

```markdown
# Grammar Police Report -- March 2026

## Summary

| Metric | Count |
|---|---|
| Total entries processed | 87 |
| Grammar entries | 72 |
| Translate entries | 8 |
| Filtered out (minor/duplicate/bad correction) | 7 |
| Usable grammar entries | 65 |

## Error Category Distribution

| Category | Count | % |
|---|---|---|
| verb-form | 18 | 28% |
| spelling | 12 | 18% |
| article | 10 | 15% |
| plural | 8 | 12% |
| preposition | 7 | 11% |
| word-choice | 5 | 8% |
| sentence-structure | 3 | 5% |
| professional-phrasing | 2 | 3% |

## Most Common Mistakes

### verb-form (18 occurrences)

Subject-verb agreement and tense errors remain the top issue.

| Input (error) | Correct | Pattern |
|---|---|---|
| "we has missed scanning" | "we have missed" | has -> have (plural subject) |
| "it require exactly matching" | "it requires exact matching" | require -> requires (3rd person) |
| "I have discuss with" | "I have discussed with" | past participle missing -ed |

### spelling (12 occurrences)

| Misspelled | Correct |
|---|---|
| reasign | reassign |
| pharse | phase |
| enterperise | enterprise |
| paraghrap | paragraph |
| comamnd | command |
| exept | except |

### article (10 occurrences)

Missing articles before nouns.

| Input | Correct | Rule |
|---|---|---|
| "working on other task" | "working on another task" | countable singular needs article |
| "in AI era" | "in the AI era" | specific concept needs "the" |

## Vocabulary List

| English | Vietnamese | Notes |
|---|---|---|
| synthesize | tổng hợp | verb: to combine elements |
| omitted | bỏ qua | past tense of "omit" |
| exemptions | miễn trừ | noun: exceptions to a rule |
| expertise | chuyên môn | noun: specialized knowledge |

## Weak Areas

1. **Subject-verb agreement** -- consistently using singular verb forms
   with plural subjects ("we has", "it depend", "configurations requires")
2. **Missing articles** -- dropping "the/a/an" before nouns, especially in
   technical descriptions
3. **Past participle forms** -- using base form instead of past participle
   ("I have discuss" instead of "I have discussed")

## Month-over-Month Comparison (vs February 2026)

| Category | Feb | Mar | Trend |
|---|---|---|---|
| verb-form | 22 | 18 | Improving |
| spelling | 15 | 12 | Improving |
| article | 8 | 10 | Getting worse |
| plural | 6 | 8 | Getting worse |
| preposition | 9 | 7 | Improving |

### Repeated Mistakes (persistent weak spots)
- "we has" pattern (plural subject + singular verb) -- appeared both months
- Missing "the" before specific nouns -- appeared both months
- "reasign" misspelling -- appeared both months

### Improvements
- Fewer preposition errors (9 -> 7)
- No more "access to" misuse (was common in Feb)

### New This Month
- "pharse" misspelling (new)
- Professional phrasing issues appearing for the first time

### Trend Summary
You improved on verb forms and spelling overall, but article usage got
slightly worse. Plural forms need more attention this month. Consider
focused practice on "the" usage with technical nouns.
```

## exercises.md

Exercises do NOT include answers. Answers go in a separate `answer_key.md`.

```markdown
# Grammar Exercises -- March 2026

## Spot the Error

Find the grammar mistake in each sentence.

1. "We has missed scanning those orgs."
2. "Other configuration still require user input."
3. "Currently, we tested the case lower resource."

## Fill in the Blank

Choose the correct word for each blank.

4. "We _____ already discussed this with the team." (has / have)
5. "Other _____ still require user input." (configuration / configurations)
6. "Please _____ this example." (follow / following)
7. "In _____ AI era, caching is important." (a / the / -)

## Rewrite

Rewrite each sentence correctly.

8. "reasign it to me to fix from CI"
9. "deployment config depend on across warehouse?"
10. "it works, but the posts are remove too slow"

## Vocabulary Matching

Match each English word with its Vietnamese translation.

| | English | | Vietnamese |
|---|---|---|---|
| 1 | synthesize | A | miễn trừ |
| 2 | omitted | B | chuyên môn |
| 3 | exemptions | C | tổng hợp |
| 4 | expertise | D | bỏ qua |
```

## answer_key.md

```markdown
# Answer Key -- March 2026

## Spot the Error

1. "has" should be "have" (plural subject "we")
2. "configuration" -> "configurations" (plural); "require" -> "requires" or keep "require" with plural subject
3. "lower" should be "with lower" (missing preposition); sentence needs restructuring

## Fill in the Blank

4. have
5. configurations
6. follow
7. the

## Rewrite

8. "Reassign it to me to fix from CI."
9. "Does the deployment config depend on the warehouse?"
10. "It works, but the posts are removed too slowly."

## Vocabulary Matching

1-C, 2-D, 3-A, 4-B
```

## related_knowledge.md

```markdown
# Related Knowledge -- March 2026

## Grammar Rules

### Subject-Verb Agreement

The verb must agree in number with its subject.

| Subject | Verb | Example |
|---|---|---|
| I / you / we / they | base form | "We **have** discussed this." |
| he / she / it | -s/-es form | "It **requires** manual setup." |

DevOps examples:
- "The CI pipeline **runs** every hour." (singular)
- "The pods **are** running with the old hash." (plural)
- "We **have** tested the VPA configuration." (plural "we")

Common trap: "There **are** some cases..." (not "there is some cases")

### Articles (a / an / the)

Use "the" when referring to a specific, known thing:
- "Please check **the** CI logs." (specific logs)
- "In **the** current sprint..." (specific sprint)

Use "a/an" for non-specific or first mention:
- "We need **a** new namespace."
- "This is **an** ArgoCD application."

Omit articles for general/uncountable concepts:
- "We use **-** Kubernetes for orchestration."

### Past Participle in Perfect Tenses

Pattern: have/has + past participle (not base form)

| Base | Past Participle | Example |
|---|---|---|
| discuss | discussed | "I have **discussed** this." |
| test | tested | "We have **tested** the config." |
| receive | received | "I haven't **received** any updates." |

## Commonly Confused Words

| Often Used | Should Be | Context |
|---|---|---|
| following | follow | "Please **follow** this example" (imperative) |
| fixed | fix | "Should not **fix** the list" (after modal verb) |
| ensure | ensuring | Depends on sentence structure |
| bump | update | Both acceptable in DevOps context |

## Professional Communication Patterns

### PR Review Comments
- "LGTM" -- Looks Good To Me (approval)
- "Could you please [action]?" instead of "[action] please"
- "I've addressed all review points." instead of "I've addressed all the review point."

### Slack Status Updates
- "I'm currently working on [task]. Will update by [time]."
- "The fix has been deployed. Please verify on your end."
- "I'll review this and respond as soon as possible."

### Escalation Emails
- "Could you please provide the current status of [X]?"
- "I haven't received any updates since [date]."
- "This may cause [impact] if not addressed by [deadline]."

## DevOps Abbreviations

| Abbreviation | Full Form | Usage in Sentence |
|---|---|---|
| PR | Pull Request | "The **PR** is ready for review." |
| CI/CD | Continuous Integration/Delivery | "The **CI** pipeline failed." |
| LGTM | Looks Good To Me | "The changes are **LGTM**." |
| VPA | Vertical Pod Autoscaler | "We need to configure the **VPA**." |
| GHA | GitHub Actions | "Add a release action to **GHA**." |
| GHEC | GitHub Enterprise Cloud | "Migrate repos to **GHEC**." |

## Vocabulary Deep Dive (Vietnamese)

### tổng hợp (synthesize)

**Nghĩa**: Kết hợp nhiều yếu tố lại với nhau thành một thể thống nhất.

**Ví dụ**:
- "Tôi cần tổng hợp dữ liệu từ nhiều nguồn." (I need to synthesize data from multiple sources.)
- "Báo cáo tổng hợp kết quả của sprint." (The report synthesizes the sprint results.)

**Từ liên quan**: phân tích (analyze), kết hợp (combine), tóm tắt (summarize)

### bỏ qua (omitted)

**Nghĩa**: Không bao gồm, bỏ đi, không xét đến.

**Ví dụ**:
- "Các trường không bắt buộc đã bị bỏ qua." (Optional fields were omitted.)
- "Chúng ta có thể bỏ qua bước này." (We can skip this step.)

**Từ liên quan**: loại trừ (exclude), bỏ đi (skip), bỏ sót (miss)
```
