import {AsyncEvent, makeAsyncEvent} from "async_event"
import {Logger} from "logger"
import {ShellRunner} from "shell_runner"
import {Koramund} from "koramund"

export interface BaseProjectInternal<P extends Koramund.BaseProjectParams = Koramund.BaseProjectParams> extends Koramund.BaseProject<P> {
	logger: Logger
	shell: ShellRunner
	shutdown(withSignal?: NodeJS.Signals): Promise<void>
	onShutdown: AsyncEvent<NodeJS.Signals | undefined>
}

export function createBaseProject<P extends Koramund.BaseProjectParams>(params: P, controllerParams: Koramund.ProjectControllerOptions): BaseProjectInternal<P> {

	let workingDirectory = params.workingDirectory || "."

	let logger = new Logger({
		log: controllerParams.log,
		getProject() {
			return proj
		},
		logDebug: controllerParams.verboseLogging
	})

	let proj: BaseProjectInternal<P> = {
		name: params.name,
		params: params,
		shell: new ShellRunner(workingDirectory, logger),
		logger: logger,

		onShutdown: makeAsyncEvent(),
		async shutdown(withSignal?: NodeJS.Signals): Promise<void> {
			await this.onShutdown.fire(withSignal)
		}
	}

	return proj
}