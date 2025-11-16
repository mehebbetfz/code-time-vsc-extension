import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'

/// <reference lib="dom" />

interface CodeFragment {
	text: string
	type: 'typed' | 'copilot' | 'pasted'
	timestamp: number
}

export function activate(context: vscode.ExtensionContext) {
	console.log('CodeTime Tracker v2.0 Activated')

	const storagePath = context.globalStorageUri.fsPath
	if (!fs.existsSync(storagePath))
		fs.mkdirSync(storagePath, { recursive: true })

	const statsFile = path.join(storagePath, 'codetime-stats.json')
	const fragmentsFile = path.join(storagePath, 'codetime-fragments.json')
	const achievementsFile = path.join(storagePath, 'achievements.json')

	let stats: Map<string, number> = new Map()
	let fragments: CodeFragment[] = []
	let achievements: string[] = []
	let lastActivity = Date.now()
	let isActive = false
	let sessionStart = 0
	const idleTimeout = 30 * 1000
	let idleCheck: NodeJS.Timeout
	let lastClipboard = ''
	let lastWasCopilot = false
	let streak = 0
	let todayGoal = 120 // 2 hours in minutes

	// === Load Data ===
	const load = () => {
		;[statsFile, fragmentsFile, achievementsFile].forEach(file => {
			if (fs.existsSync(file)) {
				const data = fs.readFileSync(file, 'utf-8')
				const decrypted = Buffer.from(data, 'base64').toString('utf-8')
				const json = JSON.parse(decrypted)
				if (file.includes('stats')) stats = new Map(Object.entries(json))
				if (file.includes('fragments')) fragments = json
				if (file.includes('achievements')) achievements = json
			}
		})
		updateStreak()
	}

	const save = () => {
		const encrypt = (obj: any) =>
			Buffer.from(JSON.stringify(obj)).toString('base64')
		fs.writeFileSync(statsFile, encrypt(Object.fromEntries(stats)))
		fs.writeFileSync(fragmentsFile, encrypt(fragments))
		fs.writeFileSync(achievementsFile, encrypt(achievements))
	}

	load()

	// === Keys ===
	const getKey = (type: 'day' | 'week' | 'month'): string => {
		const d = new Date()
		if (type === 'day') return d.toISOString().split('T')[0]
		if (type === 'month')
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
		const start = new Date(d)
		start.setDate(d.getDate() - d.getDay() + 1)
		const year = start.getFullYear()
		const week = Math.ceil(
			((start.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + 1) / 7
		)
		return `${year}-W${week}`
	}

	// === Time Tracking ===
	const addTime = (seconds: number) => {
		const keys = ['day', 'week', 'month'].map(t => `${t}:${getKey(t as any)}`)
		keys.forEach(k => stats.set(k, (stats.get(k) || 0) + seconds))
		save()
		updateStatusBar()
		checkAchievements()
	}

	const recordActivity = async () => {
		const now = Date.now()
		lastActivity = now
		if (!isActive) {
			isActive = true
			sessionStart = now
		}

		clearTimeout(idleCheck)
		idleCheck = setTimeout(() => {
			if (isActive && now - lastActivity > idleTimeout) {
				const sessionTime = Math.floor((now - sessionStart) / 1000)
				if (sessionTime > 5) addTime(sessionTime)
				isActive = false
			}
		}, idleTimeout + 5000)

		// === Copilot Detection ===
		const editor = vscode.window.activeTextEditor
		if (editor) {
			const doc = editor.document
			const selection = editor.selection
			const text = doc.getText(new vscode.Range(selection.start, selection.end))

			if (text && text.length > 3) {
				let isCopilot = false
				try {
					await vscode.commands.executeCommand(
						'editor.action.inlineSuggest.trigger'
					)
					isCopilot = true
				} catch {
					isCopilot = false
				}

				const type: CodeFragment['type'] = isCopilot
					? 'copilot'
					: lastWasCopilot
					? 'copilot'
					: 'typed'
				fragments.push({ text: text.slice(0, 200), type, timestamp: now })
				lastWasCopilot = isCopilot
			}
		}

		// === Paste Detection ===
		try {
			const clipboard = await vscode.env.clipboard.readText()
			if (clipboard && clipboard !== lastClipboard && clipboard.length > 5) {
				lastClipboard = clipboard
				fragments.push({
					text: clipboard.slice(0, 200),
					type: 'pasted',
					timestamp: now,
				})
			}
		} catch {}

		save()
	}

	// === Status Bar ===
	const statusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100
	)
	statusBar.text = '$(clock) CodeTime: 0 min'
	statusBar.command = 'codeTime.showDashboard'
	statusBar.show()
	context.subscriptions.push(statusBar)

	const updateStatusBar = () => {
		const today = getKey('day')
		const minutes = Math.floor((stats.get(`day:${today}`) || 0) / 60)
		const goal = minutes >= todayGoal ? '$(check)' : '$(circle-outline)'
		statusBar.text = `${goal} CodeTime: ${minutes} min`
	}

	// === Dashboard ===
	const showDashboard = () => {
		const panel = vscode.window.createWebviewPanel(
			'codeTimeDashboard',
			'CodeTime Dashboard',
			vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true }
		)

		panel.webview.html = getDashboardHTML()
	}

	const getDashboardHTML = () => {
		const theme = vscode.window.activeColorTheme.kind === 1 ? 'light' : 'dark'
		const bg = theme === 'dark' ? '#1e1e1e' : '#ffffff'
		const fg = theme === 'dark' ? '#cccccc' : '#333333'

		const dayData = getLast7Days()
		const weekMins = Math.floor((stats.get(`week:${getKey('week')}`) || 0) / 60)
		const monthMins = Math.floor(
			(stats.get(`month:${getKey('month')}`) || 0) / 60
		)
		const todayMins = Math.floor((stats.get(`day:${getKey('day')}`) || 0) / 60)

		return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>CodeTime Dashboard</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body { font-family: system-ui; background: ${bg}; color: ${fg}; padding: 20px; }
        .card { background: ${
					theme === 'dark' ? '#2d2d2d' : '#f9f9f9'
				}; padding: 16px; border-radius: 12px; margin: 12px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .summary { display: flex; justify-content: space-around; text-align: center; }
        .value { font-size: 28px; font-weight: bold; }
        .label { font-size: 14px; opacity: 0.8; }
        canvas { height: 220px !important; }
        .code { font-family: 'Courier New'; font-size: 12px; white-space: pre-wrap; }
        .typed { color: #4ade80; }
        .copilot { color: #fbbf24; }
        .pasted { color: #f87171; }
        .achievements { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
        .badge { background: #6366f1; color: white; padding: 4px 8px; border-radius: 8px; font-size: 12px; }
        button { background: #10b981; color: white; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; margin-top: 16px; }
      </style>
    </head>
    <body>
      <h1>CodeTime Dashboard</h1>

      <div class="card summary">
        <div>
          <div class="value">${todayMins}</div>
          <div class="label">Today</div>
        </div>
        <div>
          <div class="value">${weekMins}</div>
          <div class="label">This Week</div>
        </div>
        <div>
          <div class="value">${monthMins}</div>
          <div class="label">This Month</div>
        </div>
        <div>
          <div class="value">${streak}</div>
          <div class="label">Streak</div>
        </div>
      </div>

      <div class="card">
        <h3>Last 7 Days</h3>
        <canvas id="chart"></canvas>
      </div>

      <div class="card">
        <h3>Code Origin</h3>
        <div class="code">
          ${fragments
						.slice(-20)
						.reverse()
						.map(
							f =>
								`<div class="${f.type}">[${new Date(
									f.timestamp
								).toLocaleTimeString()}] ${f.text}</div>`
						)
						.join('')}
        </div>
      </div>

      <div class="card">
        <h3>Achievements</h3>
        <div class="achievements">
          ${
						achievements.map(a => `<span class="badge">${a}</span>`).join('') ||
						'<i>None yet</i>'
					}
        </div>
      </div>

      <button onclick="exportPDF()">Export to PDF</button>

      <script>
        new Chart(document.getElementById('chart'), {
          type: 'bar',
          data: {
            labels: ${JSON.stringify(dayData.map(d => d.label))},
            datasets: [{
              label: 'Minutes',
              data: ${JSON.stringify(dayData.map(d => d.value))},
              backgroundColor: '#10b981'
            }]
          },
          options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });

        function exportPDF() {
          window.print();
        }
      </script>
    </body>
    </html>`
	}

	const getLast7Days = () => {
		const result = []
		for (let i = 6; i >= 0; i--) {
			const d = new Date()
			d.setDate(d.getDate() - i)
			const key = d.toISOString().split('T')[0]
			result.push({
				label: d.toLocaleDateString('en-US', { weekday: 'short' }),
				value: Math.floor((stats.get(`day:${key}`) || 0) / 60),
			})
		}
		return result
	}

	// === Streak & Achievements ===
	const updateStreak = () => {
		const today = getKey('day')
		const yesterday = new Date()
		yesterday.setDate(yesterday.getDate() - 1)
		const yKey = yesterday.toISOString().split('T')[0]
		const todayMins = Math.floor((stats.get(`day:${today}`) || 0) / 60)
		const yesterdayMins = Math.floor((stats.get(`day:${yKey}`) || 0) / 60)

		if (todayMins >= todayGoal && yesterdayMins >= todayGoal) {
			streak = (streak || 0) + 1
		} else if (todayMins < todayGoal) {
			streak = 0
		}
	}

	const checkAchievements = () => {
		const totalMins = Math.floor(
			Array.from(stats.values()).reduce((a, b) => a + b, 0) / 60
		)
		const todayMins = Math.floor((stats.get(`day:${getKey('day')}`) || 0) / 60)
		const copilotCount = fragments.filter(f => f.type === 'copilot').length
		const noCopilotDay = todayMins >= 60 && copilotCount === 0

		const newAchievements = []
		if (totalMins >= 1000 && !achievements.includes('1000 Minutes Coded'))
			newAchievements.push('1000 Minutes Coded')
		if (streak >= 5 && !achievements.includes('5-Day Streak'))
			newAchievements.push('5-Day Streak')
		if (noCopilotDay && !achievements.includes('Pure Coder'))
			newAchievements.push('Pure Coder')

		if (newAchievements.length > 0) {
			achievements.push(...newAchievements)
			save()
			vscode.window.showInformationMessage(
				`Achievement Unlocked: ${newAchievements.join(', ')}!`
			)
		}
	}

	// === Commands ===
	context.subscriptions.push(
		vscode.commands.registerCommand('codeTime.showDashboard', showDashboard)
	)

	// === Listeners ===
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(recordActivity),
		vscode.window.onDidChangeTextEditorSelection(recordActivity),
		vscode.workspace.onDidChangeTextDocument(recordActivity),
		statusBar
	)

	// === Start ===
	recordActivity()
	updateStatusBar()
	setInterval(updateStatusBar, 30000)
}

export function deactivate() {}
