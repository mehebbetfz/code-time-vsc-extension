// src/extension.ts
import * as path from 'path'
import * as vscode from 'vscode'

type Classification = 'manual' | 'paste' | 'ai'

interface SnippetRecord {
	id: string
	file: string
	folder: string
	language: string
	text: string
	classification: Classification
	timestamp: number
	chars: number
	lines: number
}

interface FileStat {
	file: string
	folder: string
	language: string
	timeSeconds: number
	chars: number
	lines: number
	byClassification: Record<Classification, { chars: number; count: number }>
	snippets: SnippetRecord[]
	lastActive?: number
}

interface LanguageStat {
	language: string
	chars: number
	lines: number
	timeSeconds: number
	byClassification: Record<Classification, { chars: number; count: number }>
}

interface DailyStat {
	date: string
	totalChars: number
	totalTime: number
	byClassification: Record<Classification, { chars: number; count: number }>
}

interface Aggregate {
	files: Record<string, FileStat>
	languages: Record<string, LanguageStat>
	snippets: SnippetRecord[]
	lastUpdate: number
}

const STORAGE_KEY = 'codingTracker.v1'

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('CodingTracker')
	output.appendLine('CodingTracker activated')

	let store: Aggregate = context.globalState.get<Aggregate>(STORAGE_KEY) || {
		files: {},
		languages: {},
		snippets: [],
		lastUpdate: Date.now(),
	}

	const now = () => Date.now()
	const uid = () => Math.random().toString(36).slice(2, 9)

	function save() {
		store.lastUpdate = now()
		void context.globalState.update(STORAGE_KEY, store)
	}

	function getFolderFromUri(uri: vscode.Uri) {
		const ws = vscode.workspace.getWorkspaceFolder(uri)
		if (ws)
			return (
				ws.name + ':' + path.relative(ws.uri.fsPath, path.dirname(uri.fsPath))
			)
		return path.dirname(uri.fsPath)
	}

	function ensureFileStat(
		filePath: string,
		language: string,
		folder: string
	): FileStat {
		if (!store.files[filePath]) {
			store.files[filePath] = {
				file: filePath,
				folder,
				language,
				timeSeconds: 0,
				chars: 0,
				lines: 0,
				byClassification: {
					manual: { chars: 0, count: 0 },
					paste: { chars: 0, count: 0 },
					ai: { chars: 0, count: 0 },
				},
				snippets: [],
			}
		}
		return store.files[filePath]
	}

	function ensureLanguageStat(language: string): LanguageStat {
		if (!store.languages[language]) {
			store.languages[language] = {
				language,
				chars: 0,
				lines: 0,
				timeSeconds: 0,
				byClassification: {
					manual: { chars: 0, count: 0 },
					paste: { chars: 0, count: 0 },
					ai: { chars: 0, count: 0 },
				},
			}
		}
		return store.languages[language]
	}

	let lastActiveEditorUri: string | null = null
	let lastActiveTime = now()

	function setActiveEditor(editor: vscode.TextEditor | undefined) {
		const t = now()
		if (lastActiveEditorUri) {
			const delta = (t - lastActiveTime) / 1000
			const fileStat = store.files[lastActiveEditorUri]
			if (fileStat) {
				fileStat.timeSeconds += delta
				const langStat = ensureLanguageStat(fileStat.language)
				langStat.timeSeconds += delta
			}
		}
		lastActiveTime = t
		lastActiveEditorUri = editor?.document.uri.fsPath || null
		save()
	}

	setActiveEditor(vscode.window.activeTextEditor)

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			setActiveEditor(editor)
		})
	)

	context.subscriptions.push(
		vscode.window.onDidChangeWindowState(state => {
			if (!state.focused) {
				setActiveEditor(undefined)
			} else {
				setActiveEditor(vscode.window.activeTextEditor)
			}
		})
	)

	const PASTE_MIN_CHARS = 50
	const AI_MIN_CHARS = 20
	const AI_TIME_GAP_MS = 700

	let lastWasTyping = false
	let lastChangeTime = 0
	let lastKeypressTime = 0

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e => {
			const doc = e.document
			const filePath = doc.uri.fsPath
			const language = doc.languageId || 'unknown'
			const folder = getFolderFromUri(doc.uri)
			const fileStat = ensureFileStat(filePath, language, folder)
			const langStat = ensureLanguageStat(language)

			const tNow = now()

			for (const ch of e.contentChanges) {
				const text = ch.text || ''
				const chars = text.length
				const lines = text.length > 0 ? text.split(/\r\n|\r|\n/).length : 0

				let cls: Classification = 'manual'
				const gap = tNow - lastChangeTime

				if (chars >= PASTE_MIN_CHARS && ch.rangeLength === 0) {
					cls = 'paste'
				} else if (chars >= AI_MIN_CHARS) {
					if (gap <= 50) {
						cls = 'ai'
					} else if (gap <= AI_TIME_GAP_MS && !lastWasTyping) {
						cls = 'ai'
					} else {
						cls = 'manual'
					}
				} else {
					cls = 'manual'
				}

				fileStat.chars += chars
				fileStat.lines += lines
				fileStat.byClassification[cls].chars += chars
				fileStat.byClassification[cls].count += 1

				langStat.chars += chars
				langStat.lines += lines
				langStat.byClassification[cls].chars += chars
				langStat.byClassification[cls].count += 1

				if (chars > 0) {
					const s: SnippetRecord = {
						id: uid(),
						file: filePath,
						folder,
						language,
						text:
							text.length > 1000
								? text.slice(0, 1000) + '...[truncated]'
								: text,
						classification: cls,
						timestamp: tNow,
						chars,
						lines,
					}
					fileStat.snippets.push(s)
					store.snippets.push(s)
				}

				lastWasTyping = chars === 1 && ch.rangeLength === 0
				lastChangeTime = tNow
			}

			save()
		})
	)

	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(_doc => {
			save()
		})
	)

	let panel: vscode.WebviewPanel | undefined = undefined

	function createOrShowPanel() {
		if (panel) {
			panel.reveal(vscode.ViewColumn.One)
			sendDataToPanel()
			return
		}
		panel = vscode.window.createWebviewPanel(
			'codingTracker.dashboard',
			'Coding Tracker Dashboard',
			{ viewColumn: vscode.ViewColumn.One, preserveFocus: false },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		)

		panel.webview.html = getWebviewContent(panel.webview, context.extensionUri)
		panel.onDidDispose(() => {
			panel = undefined
		})

		panel.webview.onDidReceiveMessage(msg => {
			if (msg.command === 'requestData') {
				sendDataToPanel()
			}
		})

		sendDataToPanel()
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('codingTracker.openDashboard', () => {
			createOrShowPanel()
		})
	)

	function startOfDay(ts: number) {
		const d = new Date(ts)
		d.setHours(0, 0, 0, 0)
		return d.getTime()
	}

	function buildTimeWindows() {
		const t = now()
		const windows = [
			{
				id: 'last12h',
				from: t - 12 * 3600 * 1000,
				label: 'Последние 12 часов',
			},
			{ id: 'today', from: startOfDay(t), label: 'Сегодня' },
			{ id: 'week', from: t - 7 * 24 * 3600 * 1000, label: 'За неделю' },
			{ id: 'month', from: startOfMonth(t), label: 'За месяц' },
		]

		const results: Record<
			string,
			{ seconds: number; chars: number; lines: number }
		> = {}
		for (const w of windows) {
			let chars = 0
			let lines = 0
			for (const sn of store.snippets) {
				if (sn.timestamp >= w.from) {
					chars += sn.chars
					lines += sn.lines
				}
			}

			const totalChars = Object.values(store.files).reduce(
				(acc, f) => acc + f.chars,
				0
			)
			const totalSeconds = Object.values(store.files).reduce(
				(acc, f) => acc + f.timeSeconds,
				0
			)
			const sec = totalChars > 0 ? (chars / totalChars) * totalSeconds : 0

			results[w.id] = { seconds: Math.round(sec), chars, lines }
		}

		return results
	}

	function buildExtraStats() {
		const DAY_MS = 24 * 3600 * 1000
		const today = startOfDay(now())
		let currentStreak = 0
		let maxStreak = 0
		let lastDay = 0

		const sortedSnippets = [...store.snippets].sort(
			(a, b) => a.timestamp - b.timestamp
		)

		const activityDays: Set<number> = new Set()
		const weekdayCounts = Array(7).fill(0)

		for (const sn of sortedSnippets) {
			const day = startOfDay(sn.timestamp)
			activityDays.add(day)

			const d = new Date(sn.timestamp)
			weekdayCounts[d.getDay()]++
		}

		const uniqueDays = Array.from(activityDays).sort((a, b) => a - b)

		for (const day of uniqueDays) {
			if (day === lastDay + DAY_MS || lastDay === 0) {
				currentStreak++
			} else if (day !== lastDay) {
				maxStreak = Math.max(maxStreak, currentStreak)
				currentStreak = 1
			}
			lastDay = day
		}
		maxStreak = Math.max(maxStreak, currentStreak)

		const yesterday = today - DAY_MS
		const isActiveToday = activityDays.has(today)
		const isActiveYesterday = activityDays.has(yesterday)

		if (lastDay === today) {
		} else if (lastDay === yesterday) {
			if (!isActiveToday && currentStreak > 0) {
				let tempStreak = 0
				let currentDay = yesterday
				while (activityDays.has(currentDay)) {
					tempStreak++
					currentDay -= DAY_MS
				}
				currentStreak = tempStreak
			}
		} else {
			currentStreak = isActiveToday ? 1 : 0
		}

		return {
			totalEdits: store.snippets.length,
			currentStreak: Math.max(0, currentStreak),
			maxStreak: Math.max(0, maxStreak),
			weekdayCounts: weekdayCounts,
		}
	}

	// Новая функция для построения статистики по дням
	function buildDailyStats(): DailyStat[] {
		const dailyMap: Map<string, DailyStat> = new Map()

		// Собираем данные по дням из сниппетов
		for (const snippet of store.snippets) {
			const date = new Date(snippet.timestamp)
			const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD

			if (!dailyMap.has(dateStr)) {
				dailyMap.set(dateStr, {
					date: dateStr,
					totalChars: 0,
					totalTime: 0,
					byClassification: {
						manual: { chars: 0, count: 0 },
						paste: { chars: 0, count: 0 },
						ai: { chars: 0, count: 0 },
					},
				})
			}

			const dayStat = dailyMap.get(dateStr)!
			dayStat.totalChars += snippet.chars
			dayStat.byClassification[snippet.classification].chars += snippet.chars
			dayStat.byClassification[snippet.classification].count += 1
		}

		// Собираем данные по времени из файлов
		for (const file of Object.values(store.files)) {
			if (file.lastActive) {
				const date = new Date(file.lastActive)
				const dateStr = date.toISOString().split('T')[0]

				if (dailyMap.has(dateStr)) {
					dailyMap.get(dateStr)!.totalTime += file.timeSeconds
				}
			}
		}

		// Сортируем по дате (от новых к старым)
		return Array.from(dailyMap.values()).sort(
			(a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
		)
	}

	// Новая функция для построения heatmap данных (последние 90 дней)
	function buildHeatmapData() {
		const heatmapData: { date: string; value: number }[] = []
		const dailyStats = buildDailyStats()
		const today = new Date()
		today.setHours(0, 0, 0, 0)

		// Создаем данные для последних 90 дней
		for (let i = 89; i >= 0; i--) {
			const date = new Date(today)
			date.setDate(today.getDate() - i)
			const dateStr = date.toISOString().split('T')[0]

			const dayStat = dailyStats.find(stat => stat.date === dateStr)
			const value = dayStat ? dayStat.totalChars : 0

			heatmapData.push({
				date: dateStr,
				value: value,
			})
		}

		return heatmapData
	}

	function sendDataToPanel() {
		if (!panel) return
		const builds = buildTimeWindows()
		const extraStats = buildExtraStats()
		const dailyStats = buildDailyStats()
		const heatmapData = buildHeatmapData()

		panel.webview.postMessage({
			command: 'update',
			payload: {
				store,
				timeWindows: builds,
				extraStats: extraStats,
				dailyStats: dailyStats,
				heatmapData: heatmapData,
			},
		})
	}

	function startOfMonth(ts: number) {
		const d = new Date(ts)
		d.setDate(1)
		d.setHours(0, 0, 0, 0)
		return d.getTime()
	}

	const item = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100
	)
	item.text = '$(graph) CodingTracker'
	item.command = 'codingTracker.openDashboard'
	item.show()
	context.subscriptions.push(item)

	context.subscriptions.push({
		dispose: () => {
			save()
		},
	})

	function getWebviewContent(webview: vscode.Webview, _extUri: vscode.Uri) {
		const nonce = uid()
		const chartJs = `
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
 `

		return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Панель мониторинга Coding Tracker</title>
<style>
 :root {
  --bg: #0f1724;
  --card: #1a2332;
  --border: #2d3748;
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  --accent: #60a5fa;
  --ai: #ff5c5c;
  --paste: #fbbf24;
  --manual: #34d399;
 }
 body { 
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
  margin: 0; padding: 16px; 
  color: var(--text); background: var(--bg); 
  line-height: 1.5;
 }
 h1 { font-size: 1.5rem; margin: 0 0 12px; color: #fff; display: flex; align-items: center; gap: 8px; }
 h2 { font-size: 1.1rem; margin: 16px 0 8px; color: #fff; font-weight: 600; }
 .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 16px; }
 .chart-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; margin-bottom: 16px; }

 .card { 
  background: var(--card); 
  border-radius: 12px; 
  padding: 16px; 
  border: 1px solid var(--border); 
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  transition: transform 0.2s, box-shadow 0.2s;
 }
 .card:hover { box-shadow: 0 8px 20px rgba(0,0,0,0.4); }
 .controls { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
 button { 
  padding: 8px 12px; border-radius: 8px; background: #1e293b; color: #cbd5e1; 
  border: 1px solid var(--border); cursor: pointer; font-size: 0.9rem; 
  transition: all 0.2s;
 }
 button:hover { background: #334155; transform: translateY(-1px); }
 .stat { font-size: 1.8rem; font-weight: 700; margin: 4px 0; color: var(--accent); }
 .small { font-size: 0.85rem; color: var(--text-muted); }
 table { width:100%; border-collapse: collapse; font-size: 0.9rem; }
 th, td { padding: 6px 8px; text-align: left; }
 th { color: var(--text-muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; }
 tr:hover td { background: rgba(255,255,255,0.03); }
 .lang-tag { font-weight: 700; color: #e0f2fe; }
 .snippet { 
  white-space: pre-wrap; padding: 8px; border-radius: 6px; margin: 6px 0; 
  font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.4;
  max-height: 120px; overflow: auto;
 }
 .cls-paste { background: rgba(251,191,36,0.08); border-left: 3px solid var(--paste); }
 .cls-ai { background: rgba(239,68,68,0.08); border-left: 3px solid var(--ai); }
 .cls-manual { background: rgba(52,211,153,0.08); border-left: 3px solid var(--manual); }
 details { margin: 8px 0; }
 summary { 
  cursor: pointer; padding: 8px; background: rgba(255,255,255,0.03); 
  border-radius: 6px; font-weight: 600; font-size: 0.95rem;
 }
 summary:hover { background: rgba(255,255,255,0.06); }
 .chart-container { position: relative; height: 180px; margin: 12px 0; }
 .heatmap { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; margin: 12px 0; }
 .hour { width: 100%; height: 20px; background: #334155; border-radius: 2px; }
 .hour.active { background: var(--accent); }
 .hour.hot { background: #60a5fa; }
 .hour.very-hot { background: #3b82f6; }
 .top-item { display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.9rem; align-items: center; }
 .progress { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-top: 4px; }
 .progress-bar { height: 100%; border-radius: 3px; }
 .legend-item { display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.9rem; align-items: center; }
 .legend-item span:first-child { display: flex; align-items: center; }
 .color-box { width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
 
 .github-heatmap { 
  display: grid; 
  grid-template-columns: repeat(13, 1fr);
  gap: 2px; 
  margin: 12px 0;
 }
 .heatmap-day { 
  width: 30px; 
  height: 30px; 
  border-radius: 2px;
  background: #ebedf0;
 }
 .heatmap-day-0 { background: #ebedf0; }
 .heatmap-day-1 { background: #9be9a8; }
 .heatmap-day-2 { background: #40c463; }
 .heatmap-day-3 { background: #30a14e; }
 .heatmap-day-4 { background: #216e39; }
 .daily-table { width: 100%; font-size: 0.8rem; }
 .daily-table th { padding: 4px 8px; }
 .daily-table td { padding: 4px 8px; border-top: 1px solid var(--border); }
 .classification-bar { display: flex; height: 4px; border-radius: 2px; overflow: hidden; margin-top: 2px; }
 .classification-manual { background: var(--manual); }
 .classification-paste { background: var(--paste); }
 .classification-ai { background: var(--ai); }
 
 @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
 .fade-in { animation: fadeIn 0.4s ease-out; }
</style>
${chartJs}
</head>
<body>
 <h1>Панель мониторинга Coding Tracker</h1>
 <div class="controls">
  <button id="refresh">Обновить</button>
 </div>

 <div class="grid">
  <div class="card fade-in">
   <h2>Отслеживание времени</h2>
   <div id="timeWindows">Загрузка…</div>
  </div>
  <div class="card fade-in">
   <h2>Статистика сессии</h2>
   <div id="sessionInfo">—</div>
  </div>
 </div>

 <div class="grid">
  <div class="card fade-in">
   <h2>Серии активности</h2>
   <div id="streakInfo">—</div>
  </div>
  <div class="card fade-in">
   <h2>Общие изменения</h2>
   <div id="totalEditsInfo">—</div>
  </div>
 </div>

 <!-- Новая секция: Heatmap активности -->
 <div style='margin-bottom: 16px' class="card fade-in">
  <h2>Heatmap активности (90 дней)</h2>
  <div id="githubHeatmap" class="github-heatmap"></div>
  <div class="small" style="margin-top: 8px; display: flex; align-items: center; gap: 8px;">
   <span>Меньше</span>
   <div class="heatmap-day heatmap-day-0"></div>
   <div class="heatmap-day heatmap-day-1"></div>
   <div class="heatmap-day heatmap-day-2"></div>
   <div class="heatmap-day heatmap-day-3"></div>
   <div class="heatmap-day heatmap-day-4"></div>
   <span>Больше</span>
  </div>
 </div>

 <!-- Новая секция: Статистика по дням -->
 <div class="card fade-in">
  <h2>Статистика по дням</h2>
  <table class="daily-table" id="dailyStatsTable">
   <thead>
    <tr>
     <th>Дата</th>
     <th>Всего символов</th>
     <th>Время</th>
     <th>Вручную</th>
     <th>Вставка</th>
     <th>ИИ</th>
    </tr>
   </thead>
   <tbody id="dailyStatsBody"></tbody>
  </table>
 </div>

 <h2>Разбивка по вкладу</h2>
 <div class="chart-grid">
  <div class="card fade-in">
   <h3>Классификация (Символы)</h3>
   <div id="classificationChart" class="chart-container">
    <canvas id="classChart"></canvas>
   </div>
  </div>
  <div class="card fade-in" id="classificationLegend">
   <h3>Сводка</h3>
   <div id="classSummary">Загрузка...</div>
  </div>
 </div>

 <h2>Доминирование языков</h2>
 <div class="chart-grid">
  <div class="card fade-in">
   <h3>Топ языков (Символы)</h3>
   <div id="langChart" class="chart-container">
    <canvas id="langPie"></canvas>
   </div>
  </div>
  <div class="card fade-in" id="languageLegend">
   <h3>Топ-5 языков</h3>
   <div id="langSummary">Загрузка...</div>
  </div>
 </div>

 <div class="card fade-in" style="margin-top: 16px;margin-bottom: 16px;">
  <h2>Активность по дням недели</h2>
  <div id="weekdayChart" class="chart-container">
   <canvas id="weekDayChart"></canvas>
  </div>
 </div>

 <div class="grid">
  <div class="card fade-in">
   <h2>Топ-5 файлов</h2>
   <div id="topFiles">—</div>
  </div>
  <div class="card fade-in">
   <h2>Топ-5 папок</h2>
   <div id="topFolders">—</div>
   </div>
 </div>

 <div class="card fade-in" style="margin-top: 16px;">
  <h2>Почасовая активность (Последние 30 дней)</h2>
  <div class="heatmap" id="heatmap"></div>
  <div class="small" style="margin-top: 8px;">Активность на основе количества фрагментов кода в час.</div>
 </div>

 <div class="card fade-in" style="margin-top: 16px;">
  <h2>Языки (Подробная таблица)</h2>
  <table id="langTable">
   <thead><tr><th>Язык</th><th>Символы</th><th>Время</th><th>ИИ</th><th>Вставка</th><th>Вручную</th></tr></thead>
   <tbody></tbody>
  </table>
 </div>

 <div class="card fade-in" style="margin-top: 16px;">
  <h2>Недавние фрагменты кода</h2>
  <div id="accordion">Загрузка…</div>
 </div>

<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 let classChart = null, langPie = null, weeklyChart = null;

 function msToTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h > 0 ? \`\${h}ч \${m}м\` : m > 0 ? \`\${m}м \${sec}с\` : \`\${sec}с\`;
 }

 function formatNumber(n) { return n.toLocaleString('ru-RU'); }

 document.getElementById('refresh').onclick = () => vscode.postMessage({ command: 'requestData' });

 window.addEventListener('message', e => {
  const { store, timeWindows, extraStats, dailyStats, heatmapData } = e.data.payload;
  renderAll(store, timeWindows, extraStats, dailyStats, heatmapData);
 });

 function renderAll(store, tw, extraStats, dailyStats, heatmapData) {
  renderTimeWindows(tw);
  renderSession(store);
  renderStreakInfo(extraStats);
  renderTotalEditsInfo(extraStats);
  renderDailyStats(dailyStats);
  renderHeatmap(heatmapData);
  renderClassificationChart(store);
  renderLangPie(store);
  renderWeeklyActivity(extraStats);
  renderTopFiles(store);
  renderTopFolders(store);
  renderHourlyHeatmap(store);
  renderLangTable(store.languages);
  renderAccordion(store);
 }

 // Новая функция для отображения heatmap активности
 function renderHeatmap(heatmapData) {
  const container = document.getElementById('githubHeatmap');
  if (!heatmapData || heatmapData.length === 0) {
    container.innerHTML = '<div class="small">Нет данных за последние 90 дней</div>';
    return;
  }

  // Находим максимальное значение для нормализации
  const maxValue = Math.max(...heatmapData.map(d => d.value));
  
  let html = '';
  heatmapData.forEach(day => {
    let level = 0;
    if (day.value > 0) {
      const intensity = day.value / maxValue;
      if (intensity < 0.25) level = 1;
      else if (intensity < 0.5) level = 2;
      else if (intensity < 0.75) level = 3;
      else level = 4;
    }
    
    const date = new Date(day.date);
    const title = \`\${date.toLocaleDateString('ru-RU')}: \${formatNumber(day.value)} символов\`;
    html += \`<div class="heatmap-day heatmap-day-\${level}" title="\${title}"></div>\`;
  });
  
  container.innerHTML = html;
 }

 // Новая функция для отображения статистики по дням
 function renderDailyStats(dailyStats) {
  const tbody = document.getElementById('dailyStatsBody');
  if (!dailyStats || dailyStats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Нет данных</td></tr>';
    return;
  }

  let html = '';
  dailyStats.slice(0, 30).forEach(day => { // Показываем последние 30 дней
    const date = new Date(day.date);
    const dateStr = date.toLocaleDateString('ru-RU');
    const totalChars = day.totalChars;
    const totalTime = msToTime(day.totalTime);
    
    const manualChars = day.byClassification.manual.chars;
    const pasteChars = day.byClassification.paste.chars;
    const aiChars = day.byClassification.ai.chars;
    
    const totalClassification = manualChars + pasteChars + aiChars;
    const manualPercent = totalClassification > 0 ? (manualChars / totalClassification * 100).toFixed(1) : '0';
    const pastePercent = totalClassification > 0 ? (pasteChars / totalClassification * 100).toFixed(1) : '0';
    const aiPercent = totalClassification > 0 ? (aiChars / totalClassification * 100).toFixed(1) : '0';

    html += \`
      <tr>
        <td>\${dateStr}</td>
        <td>\${formatNumber(totalChars)}</td>
        <td>\${totalTime}</td>
        <td>
          \${formatNumber(manualChars)} (\${manualPercent}%)
          <div class="classification-bar">
            <div class="classification-manual" style="width: \${manualPercent}%"></div>
          </div>
        </td>
        <td>
          \${formatNumber(pasteChars)} (\${pastePercent}%)
          <div class="classification-bar">
            <div class="classification-paste" style="width: \${pastePercent}%"></div>
          </div>
        </td>
        <td>
          \${formatNumber(aiChars)} (\${aiPercent}%)
          <div class="classification-bar">
            <div class="classification-ai" style="width: \${aiPercent}%"></div>
          </div>
        </td>
      </tr>
    \`;
  });
  
  tbody.innerHTML = html;
 }

 function renderTimeWindows(tw) {
  const el = document.getElementById('timeWindows');
  el.innerHTML = '';
  const labels = { last12h: 'Последние 12 часов', today: 'Сегодня', week: 'За неделю', month: 'За месяц' };
  for (const k of ['last12h','today','week','month']) {
   const it = tw[k];
   const div = document.createElement('div');
   div.innerHTML = \`<strong>\${labels[k]}</strong>: \${msToTime(it.seconds)} — \${formatNumber(it.chars)} Символов\`;
   el.appendChild(div);
  }
 }

 function renderSession(store) {
  const totalTime = Object.values(store.files).reduce((a,f) => a + f.timeSeconds, 0);
  const totalChars = Object.values(store.languages).reduce((a,l) => a + l.chars, 0);
  const speed = totalTime > 0 ? Math.round(totalChars / totalTime * 60) : 0;
  const el = document.getElementById('sessionInfo');
  el.innerHTML = \`
   <div><strong class="stat">\${msToTime(totalTime)}</strong> Общее время</div>
   <div class="small">\${formatNumber(speed)} Символов/мин</div>
   <div class="small">Последнее обновление: \${new Date(store.lastUpdate).toLocaleTimeString('ru-RU')}</div>
  \`;
 }

 function renderStreakInfo(extraStats) {
  const el = document.getElementById('streakInfo');
  el.innerHTML = \`
   <div><strong class="stat">\${formatNumber(extraStats.currentStreak)}</strong> Дней подряд</div>
   <div class="small">Максимальная серия: \${formatNumber(extraStats.maxStreak)} дней</div>
   <div class="small">Активные дни — это дни с хотя бы одним фрагментом кода.</div>
  \`;
 }

 function renderTotalEditsInfo(extraStats) {
  const el = document.getElementById('totalEditsInfo');
  el.innerHTML = \`
   <div><strong class="stat">\${formatNumber(extraStats.totalEdits)}</strong> Общее количество фрагментов</div>
   <div class="small">Каждый фрагмент — это одно изменение содержимого.</div>
  \`;
 }

 function renderClassificationChart(store) {
  const data = { ai: 0, paste: 0, manual: 0 };
  for (const l of Object.values(store.languages)) {
   data.ai += l.byClassification.ai.chars;
   data.paste += l.byClassification.paste.chars;
   data.manual += l.byClassification.manual.chars;
  }
  
  const totalChars = data.ai + data.paste + data.manual;
  
  const ctx = document.getElementById('classChart').getContext('2d');
  if (classChart) classChart.destroy();
  classChart = new Chart(ctx, {
   type: 'doughnut',
   data: {
    labels: ['ИИ', 'Вставка', 'Вручную'],
    datasets: [{
     data: [data.ai, data.paste, data.manual],
     backgroundColor: ['var(--ai)', 'var(--paste)', 'var(--manual)'],
     borderWidth: 0
    }]
   },
   options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  const summaryEl = document.getElementById('classSummary');
  summaryEl.innerHTML = \`
   \${renderLegendItem('ИИ (AI)', data.ai, totalChars, 'var(--ai)')}
   \${renderLegendItem('Вставка (Paste)', data.paste, totalChars, 'var(--paste)')}
   \${renderLegendItem('Вручную (Manual)', data.manual, totalChars, 'var(--manual)')}
  \`;
 }

 function renderLangPie(store) {
  const langs = Object.values(store.languages).filter(l => l.chars > 0).sort((a,b) => b.chars - a.chars);
  const topLangs = langs.slice(0, 5);
  const otherChars = langs.slice(5).reduce((a,l) => a + l.chars, 0);
  
  const colors = ['#60a5fa','#a78bfa','#f472b6','#fb923c','#facc15','#94a3b8'];
  
  let chartData = topLangs.map(l => l.chars);
  let chartLabels = topLangs.map(l => l.language);
  
  if (otherChars > 0) {
   chartData.push(otherChars);
   chartLabels.push('Другие');
  }

  const ctx = document.getElementById('langPie').getContext('2d');
  if (langPie) langPie.destroy();
  langPie = new Chart(ctx, {
   type: 'pie',
   data: {
    labels: chartLabels,
    datasets: [{
     data: chartData,
     backgroundColor: colors.slice(0, chartData.length),
     borderWidth: 0
    }]
   },
   options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  const summaryEl = document.getElementById('langSummary');
  const totalChars = langs.reduce((a,l) => a + l.chars, 0);
  
  let html = '';
  for (let i = 0; i < topLangs.length; i++) {
   html += renderLegendItem(topLangs[i].language, topLangs[i].chars, totalChars, colors[i]);
  }
  if (otherChars > 0) {
   html += renderLegendItem('Другие', otherChars, totalChars, colors[topLangs.length]);
  }
  summaryEl.innerHTML = html;
 }
 
 function renderLegendItem(label, chars, total, color) {
  const percent = total > 0 ? Math.round((chars / total) * 100) : 0;
  return \`
   <div class="legend-item">
    <span><div class="color-box" style="background: \${color};"></div> \${escapeHtml(label)}</span>
    <span>\${formatNumber(chars)} (\${percent}%)</span>
   </div>
   <div class="progress"><div class="progress-bar" style="width: \${percent}%; background: \${color};"></div></div>
  \`;
 }

 function renderWeeklyActivity(extraStats) {
  const ctx = document.getElementById('weekDayChart').getContext('2d');
  if (weeklyChart) weeklyChart.destroy();
  
  const labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const data = [...extraStats.weekdayCounts];
  const shiftedData = [...data.slice(1), data[0]];

  weeklyChart = new Chart(ctx, {
   type: 'bar',
   data: {
    labels: labels,
    datasets: [{
     label: 'Фрагменты кода',
     data: shiftedData,
     backgroundColor: 'var(--accent)',
     borderColor: 'var(--accent)',
     borderWidth: 1
    }]
   },
   options: { 
    responsive: true, 
    maintainAspectRatio: false,
    plugins: { 
     legend: { display: false } 
    },
    scales: {
     x: { grid: { display: false } },
     y: { beginAtZero: true, ticks: { precision: 0 } }
    }
   }
  });
 }

 function renderTopFiles(store) {
  const files = Object.values(store.files).sort((a,b) => b.timeSeconds - a.timeSeconds).slice(0,5);
  const el = document.getElementById('topFiles');
  el.innerHTML = files.map(f => {
   const name = f.file.split(/[\\/]/).pop();
   return \`<div class="top-item"><span>\${name}</span><span>\${msToTime(Math.round(f.timeSeconds))}</span></div>\`;
  }).join('');
 }

 function renderTopFolders(store) {
  const folders = {};
  for (const f of Object.values(store.files)) {
   folders[f.folder] = (folders[f.folder] || 0) + f.timeSeconds;
  }
  const top = Object.entries(folders).sort((a,b) => b[1] - a[1]).slice(0,5);
  const el = document.getElementById('topFolders');
  el.innerHTML = top.map(([f,t]) => \`<div class="top-item"><span>\${f}</span><span>\${msToTime(Math.round(t))}</span></div>\`).join('');
 }

 function renderHourlyHeatmap(store) {
  const DAY_MS = 24 * 3600 * 1000;
  const THIRTY_DAYS_AGO = Date.now() - 30 * DAY_MS;
  
  const hours = Array(24).fill(0);
  for (const sn of store.snippets) {
   if (sn.timestamp >= THIRTY_DAYS_AGO) {
    const d = new Date(sn.timestamp);
    hours[d.getHours()]++;
   }
  }
  
  const max = Math.max(...hours, 1);
  const el = document.getElementById('heatmap');
  el.innerHTML = hours.map((c, i) => {
   const intensity = c === 0 ? '' : c > max * 0.7 ? 'very-hot' : c > max * 0.3 ? 'hot' : 'active';
   return \`<div class="hour \${intensity}" title="\${i}:00 — \${c} всего изменений"></div>\`;
  }).join('');
 }

 function renderLangTable(langs) {
  const tbody = document.querySelector('#langTable tbody');
  tbody.innerHTML = '';
  const arr = Object.values(langs).sort((a,b) => b.chars - a.chars);
  for (const l of arr) {
   const row = document.createElement('tr');
   row.innerHTML = \`
    <td class="lang-tag">\${escapeHtml(l.language)}</td>
    <td>\${formatNumber(l.chars)}</td>
    <td>\${msToTime(l.timeSeconds)}</td>
    <td>\${formatNumber(l.byClassification.ai.chars)}</td>
    <td>\${formatNumber(l.byClassification.paste.chars)}</td>
    <td>\${formatNumber(l.byClassification.manual.chars)}</td>
   \`;
   tbody.appendChild(row);
  }
 }

 function renderAccordion(store) {
  const acc = document.getElementById('accordion');
  acc.innerHTML = '';
  const byFolder = {};
  for (const f of Object.values(store.files)) {
   if (!byFolder[f.folder]) byFolder[f.folder] = [];
   byFolder[f.folder].push(f);
  }
  for (const [folder, files] of Object.entries(byFolder)) {
   const det = document.createElement('details');
   const sum = document.createElement('summary');
   sum.textContent = folder + ' (' + files.length + ' файлов)';
   det.appendChild(sum);
   for (const file of files) {
    const d2 = document.createElement('details');
    const s2 = document.createElement('summary');
    s2.textContent = file.file.split(/[\\/]/).pop() + ' — ' + msToTime(Math.round(file.timeSeconds));
    d2.appendChild(s2);
    for (const sn of file.snippets.slice(-30)) {
     const pre = document.createElement('pre');
     pre.className = 'snippet ' + (sn.classification === 'paste' ? 'cls-paste' : sn.classification === 'ai' ? 'cls-ai' : 'cls-manual');
     pre.textContent = sn.text.slice(0, 1500);
     d2.appendChild(pre);
    }
    det.appendChild(d2);
   }
   acc.appendChild(det);
  }
 }

 function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
 }

 vscode.postMessage({ command: 'requestData' });
</script>
</body>
</html>`
	}
}

export function deactivate() {
	// nothing special here — persistent state saved during runtime
}
