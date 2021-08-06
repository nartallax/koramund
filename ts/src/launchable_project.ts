import {BaseProjectInternal} from "base_project";
import {ProcessController} from "process_controller";
import {Koramund} from "types";

export interface LaunchableProjectInternal extends Koramund.LaunchableProject {
	process: ProcessController
	shutdown(withSignal?: NodeJS.Signals): Promise<void>
	stop(withSignal?: NodeJS.Signals): Promise<void>
}

export function createLaunchableProject<P extends Koramund.LaunchableProjectParams>(base: BaseProjectInternal<P>): BaseProjectInternal<P> & Koramund.LaunchableProject {

	let procController = new ProcessController({
		getLaunchCommand: base.params.getLaunchCommand,
		logger: base.logger,
		shell: base.shell,
		shouldCaptureStdout: !base.params.dropStdout,
		shouldCaptureStderr: !base.params.dropStderr,
		shutdownSequence: base.params.shutdownSequence
	})

	let proj: BaseProjectInternal<P> & LaunchableProjectInternal = {
		...base,
		process: procController,

		onProcessCreated: procController.onProcessCreated,
		onStarted: procController.onLaunchCompleted,
		onStop: procController.onStop,
		onStderr: procController.onStderr,
		onStdout: procController.onStdout,

		async stop(withSignal?: NodeJS.Signals): Promise<void> {
			this.process.stop(false, withSignal);
		},

		async restart(): Promise<void>{
			await Promise.all([
				this.process.stop(true),
				this.start()
			]);
		},
	
		async start(): Promise<Koramund.ProjectStartResult>{
			return await this.process.start();
		},

		async notifyLaunched(): Promise<void>{
			if(this.process.state === "starting"){
				await this.process.notifyLaunchCompleted();
			} else {
				this.logger.logTool("Detected completed launch of process, but the process is in " + this.process.state + " state (and not starting). Won't do anything.");
			}
		}

	}

	proj.onShutdown(withSignal => proj.process.stop(true, withSignal));

	return proj

}

export function isLaunchableProjectParams(params: Koramund.BaseProjectParams): params is Koramund.LaunchableProjectParams {
	return typeof((params as Koramund.LaunchableProjectParams).getLaunchCommand) === "function"
}

export function isLaunchableProject<P extends Koramund.BaseProjectParams>(project: Koramund.BaseProject<P>): project is BaseProjectInternal<P> & LaunchableProjectInternal {
	return !!(project as BaseProjectInternal<P> & LaunchableProjectInternal).process
}