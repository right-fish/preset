import c from 'chalk'
import debug from 'debug'
import { emitter } from '@preset/core'
import type { Status, PresetContext } from '@preset/core'
import { createLogUpdate } from 'log-update'
import { makeReporter } from '../types'
import { contexts } from '../state'
import { formatResult, time } from '../utils'

// https://github.com/vitest-dev/vitest/blob/f2caced25fb0c5ac33368a8a64329467b796089e/packages/vitest/src/reporters/renderers/figures.ts
const format = {
	indent: (indent: number) => `${'  '.repeat(indent)}  `,
	dim: (text?: any)	=> c.gray(text),
	highlight: (text?: any)	=> c.bold(`${text}`),
	titleWorking: (text?: any)	=> c.bgYellowBright.white.bold(`${text}`),
	titleFail: (text?: any)	=> c.bgRed.white.bold(`${text}`),
	titleSuccess: (text?: any)	=> c.bgGreen.white.bold(`${text}`),
}

const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export const list = makeReporter({
	name: 'list',
	registerEvents: () => {
		debug.disable()

		const updateLog = createLogUpdate(process.stdout)
		let timer: NodeJS.Timer
		let index = 0

		// Might need a lil cleanup
		function render() {
			let text: string = ''
			index = ++index % spinner.length

			const symbol: Record<Status, string> = {
				applying: c.yellowBright.bold(spinner[index]),
				applied: c.green.bold('√'),
				failed: c.red.bold('×'),
			}

			// The main preset is specially formatted
			const main = contexts.at(0)!
			text += '\n\n'
			text += {
				applying: ` ${format.titleWorking(' RUN ')} ${format.dim(`Applying preset: ${format.highlight(main.name)}...`)}`,
				applied: ` ${format.titleSuccess(' OK ')} ${c.green(`Applied preset: ${format.highlight(main.name)}.`)}`,
				failed: ` ${format.titleFail(' ERR ')} ${c.red(`Failed applying: ${format.highlight(main.name)}.`)}`,
			}[main.status]
			text += '\n\n'

			function renderPresetActions(preset?: PresetContext) {
				if (!preset) {
					return
				}

				// Render actions
				preset.actions.forEach((action) => {
					text += format.indent(preset.count)
					text += symbol[action.status]
					text += ` ${{ applying: 'Running', applied: 'Ran', failed: 'Failed' }[action.status]} action: `
					text += format.highlight(c.white(action.options.title || action.name))

					// Nested presets
					if (action.name === 'apply-nested-preset') {
						const nestedPresetContext = contexts.find(({ applyOptions }) => applyOptions.actionContextId === action.id)

						if (nestedPresetContext) {
							text += format.dim(` (preset: ${format.highlight(nestedPresetContext?.name)})`)

							if (nestedPresetContext?.error) {
								text += '\n'
								text += format.indent(preset.count + 1)
								text += c.red(`↳ ${nestedPresetContext.error.message}`)
							}
						}

						renderPresetActions(nestedPresetContext)
					}

					// Install packages
					if (action.name === 'install-packages') {
						text += format.dim(` (${format.highlight(action.options.for)})`)
					}

					// Display logs if there are.
					if (action.log.length > 0 && action.status === 'applying') {
						text += '\n'
						text += format.indent(preset.count + 1)
						text += format.dim(`↳ ${action.log.at(-1) ?? '...'}`)
					}

					// Display errors if there are, except for nested presets which display its own errors.
					if (action.error && action.name !== 'apply-nested-preset') {
						text += '\n'
						text += format.indent(preset.count + 1)
						text += c.red(`↳ ${action.error.message}`)
					}

					text += '\n'
				})
			}

			// Render presets
			renderPresetActions(main)

			// Display stat results
			if (contexts[0].status !== 'applying') {
				const actionsFailed = contexts.reduce((failed, { actions }) => failed += actions.reduce((failed, { status }) => failed += (status === 'failed' ? 1 : 0), 0), 0)
				const actionsSucceeded = contexts.reduce((succeeded, { actions }) => succeeded += actions.reduce((succeeded, { status }) => succeeded += (status === 'applied' ? 1 : 0), 0), 0)
				const presetsFailed = contexts.reduce((failed, { status }) => failed += (status === 'failed' ? 1 : 0), 0)
				const presetsSucceeded = contexts.reduce((failed, { status }) => failed += (status === 'applied' ? 1 : 0), 0)

				text += '\n'
				text += `  Presets  ${formatResult({ count: presetsSucceeded, color: c.green.bold, text: 'applied' }, { count: presetsFailed, color: c.green.red, text: 'failed', excludeWhenEmpty: true })} \n`
				text += `  Actions  ${formatResult({ count: actionsSucceeded, color: c.green.bold, text: 'ran' }, { count: actionsFailed, color: c.green.red, text: 'failed', excludeWhenEmpty: true })} \n`
				text += `     Time  ${time(contexts[0].start, contexts[0].end)}`
				text += '\n'
			}

			updateLog(text)
		}

		emitter.on('preset:start', (context) => {
			contexts.push(context)
			render()

			if (context.count === 0) {
				if (timer) {
					clearInterval(timer)
				}

				timer = setInterval(() => render(), 150)
			}
		})

		emitter.on('preset:end', (context) => {
			if (context.count === 0) {
				setTimeout(() => {
					render()
					clearInterval(timer)
				}, 1)
			}
		})
	},
})
