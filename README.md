# CodeTime Tracker ⏱️

**Track your real coding time in VS Code — no distractions, no fluff.**

> **Only counts when you type, edit, or move the cursor.**  
> **Encrypted local storage** — students can't delete data.  
> **Beautiful dashboard** with graphs, streaks, and achievements.

---

## Features

| Feature | Description |
|--------|-------------|
| **Accurate Time Tracking** | Only active coding (typing, editing, cursor movement) |
| **Encrypted Storage** | Data saved in `globalStorage` — **cannot be deleted** |
| **Interactive Dashboard** | Click the clock → see graphs, streaks, code origin |
| **Code Origin Detection** | Green = typed, Yellow = Copilot, Red = pasted |
| **Daily Goal & Streak** | 2h/day goal → fire streak + badge |
| **Achievements** | "1000 Minutes Coded", "Pure Coder", "5-Day Streak" |
| **PDF Export** | One-click report: "My Coding Week" |
| **Dark/Light Theme** | Auto-matches VS Code |
| **No Server, 100% Local** | Works offline |

---

## Installation

1. Open **VS Code**
2. Go to **Extensions** (`Ctrl+Shift+X`)
3. Search: **`CodeTime Tracker`**
4. Click **Install**

> Time starts **automatically** when you code!

---

## Dashboard

Click the clock icon in the status bar to open:

![Dashboard Preview](https://i.imgur.com/EXAMPLE.png)  
*(Coming soon: real screenshot)*

- **7-day bar chart**
- **Today / Week / Month** summary
- **Code origin log** (typed / Copilot / pasted)
- **Achievement badges**
- **Export to PDF** button

---

## Commands

| Command | Shortcut | Description |
|--------|----------|-------------|
| `CodeTime: Open Dashboard` | Click status bar clock | View stats |
| `CodeTime: Export to PDF` | — | Save report |

---

## Privacy & Security

- **No data leaves your computer**
- **Encrypted with Base64 + file isolation**
- **Students cannot reset or delete stats**
- **No internet required**

---

## For Teachers

Perfect for classrooms:

- See **who codes, who pastes**
- Track **Copilot usage**
- Export **PDF reports** for grading
- **No server setup**

---

## Settings (Coming Soon)

```json
// code-time-tracker.settings
{
  "codetime.dailyGoalMinutes": 120,
  "codetime.enableCopilotDetection": true,
  "codetime.showAchievements": true
}