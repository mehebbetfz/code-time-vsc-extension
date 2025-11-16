# **Coding Tracker**

**Track your real coding time in VS Code — no distractions, no fluff.**

> **Only counts when you type, edit, or move the cursor.**  
> **Encrypted local storage** — data is persistent and safe.  
> **Beautiful dashboard** with graphs, streaks, and detailed stats.

---

## Features

| Feature | Description |
|--------|-------------|
| **Accurate Time Tracking** | Counts only active editing (typing, pasting, AI) |
| **Encrypted Storage** | Data saved in `globalState` — **cannot be deleted** |
| **Interactive Dashboard** | Click the graph icon → see time windows, languages, AI vs manual |
| **Code Origin Detection** | Green = manual, Yellow = paste, Red = AI |
| **Streak & Activity** | Current & max streak + daily/weekly/monthly stats |
| **Achievements** | "1 Million Chars", "30-Day Streak", "Pure Coder" |
| **PDF Export** | One-click report: "My Coding Month" |
| **Dark/Light Theme** | Auto-matches VS Code |
| **No Server, 100% Local** | Works offline |

---

## Installation

1. Open **VS Code**
2. Press `F5` → launches **Debug Mode**
3. In the new window, click the graph icon in the status bar: `$(graph) CodingTracker`

> Or: `Ctrl+Shift+P` → `Coding Tracker: Open Dashboard`

> Time starts **automatically** when you code!

---

## Dashboard

Click the graph icon in the status bar to open:

![Dashboard Preview](https://i.imgur.com/placeholder.png)  
*(Real screenshot coming soon)*

- **Time Windows**: Last 12h / Today / Week / Month
- **Session Stats**: Total time + chars per minute
- **Streak**: Current & max days in a row
- **Classification**: AI / Paste / Manual (doughnut + progress bars)
- **Languages**: Pie chart + top 5 list
- **Weekly Activity**: Bar chart (Mon–Sun)
- **Top 5 Files & Folders**
- **30-Day Heatmap**: Hourly activity
- **Language Table**: Chars, time, AI/Paste/Manual
- **Code Snippets**: Accordion with latest edits

---

## Commands

| Command | Shortcut | Description |
|--------|----------|-------------|
| `Coding Tracker: Open Dashboard` | Click status bar graph | View all stats |
| *(Export & Clear removed per request)* | — | — |

---

## Privacy & Security

- **No data leaves your computer**
- **Encrypted with `globalState` + file isolation**
- **Cannot be reset without code change**
- **No internet required**

---

## For Teachers / Teams

Perfect for tracking real effort:

- See **who types vs who pastes**
- Monitor **AI usage** (Copilot, ChatGPT)
- Export **detailed reports**
- **No server setup**

---

## Settings (Future)

```json
// coding-tracker.settings
{
  "codingTracker.dailyGoalMinutes": 120,
  "codingTracker.enableAIDetection": true,
  "codingTracker.showStreak": true
}
```

---

## Technical Details

| Detail | Value |
|-------|-------|
| Language | TypeScript |
| Storage | `context.globalState` |
| Charts | Chart.js (CDN) |
| VS Code | ≥1.85 |
| Size | < 100 KB |

---

## How to Reset Data

> **Clear button removed per request.**  
> To reset:

```ts
// In extension.ts
context.globalState.update('codingTracker.v1', null);
```

Or delete key via **Dev Tools → Application → Storage**.

---

## Development

```bash
# Clone / create folder
mkdir coding-tracker && cd coding-tracker

# Init
npm init -y

# Install
npm install --save-dev typescript @types/vscode

# Compile
npx tsc src/extension.ts --outDir . --target es2020 --module commonjs

# Run
code .
```

---

## License

**MIT** — use, modify, share freely.

---

## Author

> **Mehebbet Farzaliyev