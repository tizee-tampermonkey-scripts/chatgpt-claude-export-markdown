# ChatGPT / Claude Export to Markdown

Tampermonkey userscript that adds one-click Markdown export to [chatgpt.com](https://chatgpt.com) and [claude.ai](https://claude.ai) conversations.

## Features

- **Copy as Markdown** -- copies the full conversation to clipboard with front matter (source URL, export date)
- **Open Markdown** -- opens a rendered Markdown view in a new browser tab
- **Download as `.md`** -- saves the conversation as a date-stamped file (`chatgpt_title_2026-06-23_1430.md`)
- **Auto-detects platform** -- adapts extraction logic and UI icons for ChatGPT vs Claude
- **SPA-aware** -- re-injects the export button on client-side navigation using a `MutationObserver`
- **No external dependencies** -- pure vanilla JS, no libraries, no API calls

## Output Format

```markdown
---
url: "https://chatgpt.com/c/abc123"
exported_date: "2026-06-23T12:00:00.000Z"
---

# Conversation Title

**User**

User message text...

---

**Assistant**

Assistant response with full formatting (code blocks, headings, lists, links, bold/italic, blockquotes).

---

**User**

...
```

HTML elements converted: headings (`h1`-`h6`), code blocks with language detection, inline code, links, bold/italic, blockquotes, lists.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Open the [raw script](chatgpt-export-markdown.user.js) and Tampermonkey will prompt you to install.
   - Or copy the script content and create a new userscript manually in the Tampermonkey dashboard.
3. Visit [chatgpt.com](https://chatgpt.com) or [claude.ai](https://claude.ai) -- a **Copy** button with a dropdown arrow appears in the conversation header.

## Supported Sites

| Site | URL pattern | Header integration |
|------|-------------|-------------------|
| ChatGPT | `chatgpt.com/*`, `*.openai.com/*` | `#conversation-header-actions` |
| Claude | `claude.ai/*`, `*.claude.ai/*` | `[data-testid="wiggle-controls-actions"]` |

## License

MIT
