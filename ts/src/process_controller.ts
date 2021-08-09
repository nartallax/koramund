import * as ChildProcess from "child_process";
import {Logger} from "logger";
import {arrayOfMaybeArray, isSignalShutdownSequenceItem, isWaitShutdownSequenceItem} from "utils";
import {makeAsyncEvent} from "async_event";
import {ShellRunner} from "shell_runner";
import {Koramund} from "koramund";

export interface ProcessOptions {
	readonly shell: ShellRunner;
	readonly logger: Logger;
	readonly getLaunchCommand: () => Koramund.PromiseOrValue<ReadonlyArray<string>>;
	readonly shouldCaptureStdout: boolean;
	readonly shouldCaptureStderr: boolean;
	readonly shutdownSequence?: Koramund.RoArrayOrSingle<Koramund.ShutdownSequenceItem>;
}

const defaultShutdownSequence: ReadonlyArray<Koramund.ShutdownSequenceItem> = [
	{signal: "SIGINT"},
	{wait: 60000},
	{signal: "SIGKILL"}
];



/** Wrapper around some program that could be started and stopped */
export class ProcessController implements Koramund.ProcessController {

	private proc: ChildProcess.ChildProcess | null = null;
	// usercode deemed process launch to be completed, but we need do some final steps to actually make it completed
	private readonly onLaunchMarkedCompleted = makeAsyncEvent();
	// every part of the system considers the process to be fully launched
	readonly onLaunchCompleted = makeAsyncEvent<Koramund.ProjectStartResult>();
	readonly onStop = makeAsyncEvent<Koramund.ProcessStopEvent>();
	readonly onStdout = makeAsyncEvent<string>();
	readonly onStderr = makeAsyncEvent<string>();
	readonly onProcessCreated = makeAsyncEvent<Koramund.ProcessCreatedEvent>();
	readonly onBeforeStart = makeAsyncEvent();
	private isStopping = false;
	private isStarting = false;
	
	constructor(private readonly opts: ProcessOptions){}

	get process(): ChildProcess.ChildProcess | null {
		return this.proc;
	}

	get state(): Koramund.ProcessRunState {
		return this.isStopping? "stopping":
			this.isStarting? "starting":
			!this.proc? "stopped":
			"running";
	}

	async notifyLaunchCompleted(): Promise<void> {
		if(this.isStarting){
			await this.onLaunchMarkedCompleted.fire();
		} else {
			this.opts.logger.logTool("Detected completed launch of process, but the process is not starting. Won't do anything.");
		}
	}

	private async withWaitLogging<T>(actionName: string, action: () => Promise<T>): Promise<T> {
		let startedAt = Date.now();
		let interval = setInterval(() => {
			let timePassed = Date.now() - startedAt;
			this.opts.logger.logTool(`Taking too long to ${actionName} (${Math.round(timePassed / 1000)}s passed)`);
		}, 15000);

		try {
			return await action();
		} finally {
			clearInterval(interval)
		}
	}

	stopImmediatelyAndRough(): void {
		if(this.proc){
			sendSignal(this.proc, "SIGKILL");
		}
	}

	async stop(couldAlreadyBeStoppingOrStopped?: boolean, skipFirstSignal?: NodeJS.Signals): Promise<void>{
		// check order is important
		if(this.isStopping){
			// first, if we are already stopping - it's better just wait for the other stop.
			// .process and .isStarting could have arbitrary values here
			// because there is at least one other process going on that alters them
			if(!couldAlreadyBeStoppingOrStopped){
				this.opts.logger.logTool("Stop requested, but the process is already stopping.")
			}
			await this.onStop.wait();
			return;
		} else if(this.isStarting){
			// second, if we are starting - let's wait for start to finish
			// because you can't finish something that did not start fully
			// (technically you can, that's just not good thing to do)
			this.isStopping = true;
			await this.onLaunchCompleted.wait();
		} 
		
		if(!this.proc) {
			// third, if we are not starting or stopping, and still have no process - 
			// it's already stopped, not much to do here
			if(!couldAlreadyBeStoppingOrStopped){
				this.opts.logger.logTool(`Stop requested, but no process is running. Won't do anything.`)
			}
			return;
		} else {
			this.isStopping = true;
		}

		await this.withWaitLogging("stop", async () => {
			let stopPromise = this.onStop.wait().then(() => true);
			this.opts.logger.logTool("Stopping.")
			let shutdownSequence = arrayOfMaybeArray(this.opts.shutdownSequence || defaultShutdownSequence);
			let firstAction = shutdownSequence[0];
			let shouldSkipFirst = !!firstAction && 
				isSignalShutdownSequenceItem(firstAction) && 
				firstAction.signal === skipFirstSignal &&
				process.platform !== "win32";
			for(let i = shouldSkipFirst? 1: 0; i < shutdownSequence.length; i++){
				const action = shutdownSequence[i];
				if(isSignalShutdownSequenceItem(action)){
					if(!this.proc){
						return;
					}
					sendSignal(this.proc, action.signal);
				} else if(isWaitShutdownSequenceItem(action)){
					let timeoutHandle: NodeJS.Timeout | null = null;
					let timerPromise = new Promise<boolean>(ok => {
						timeoutHandle = setTimeout(() => ok(false), action.wait);
					});

					let isStopped = await Promise.race([ timerPromise, stopPromise ]);

					if(timeoutHandle){
						clearTimeout(timeoutHandle);
					}

					if(isStopped){
						return;
					}
				} else {
					throw new Error("Unknown shutdown sequence item: " + JSON.stringify(action));
				}
			}
			await stopPromise;
		});
	}

	async start(): Promise<Koramund.ProjectStartResult> {
		if(this.isStarting){
			this.opts.logger.logTool("Requested start more than once simultaneously. Will only start once.");
			return await this.onLaunchCompleted.wait();
		} else if(this.isStopping){
			this.isStarting = true;
			await this.onStop.wait();
		} else if(this.proc) {
			this.opts.logger.logTool("Start requested, but the process is already running. Won't do anything.")
			return { type: "already_running" }
		} else {
			this.isStarting = true;
		}

		let launchMarkedCompletedPromise = this.onLaunchMarkedCompleted.wait();
		let result = await this.withWaitLogging<Koramund.ProjectStartResult>("launch", async () => {
			if(this.proc){
				// should not happen really
				this.opts.logger.logTool("Start requested, but some process is already running in state " + this.state + ". Won't start second time.");
				this.isStarting = false;
				return {type: "invalid_state"};
			}

			try {
				await this.onBeforeStart.fire();
			} catch(e){
				this.opts.logger.logTool("Could not start process: " + (e.message || e))
				this.isStarting = false;
				return {type: "invalid_state"};
			}
			
			// launch command must be acquired after onBeforeStart
			// because in getLaunchCommand imploder should be available
			// and imploder projects launch imploder instance only in onBeforeStart
			let launchCommand = await Promise.resolve(this.opts.getLaunchCommand());
			this.proc = await this.opts.shell.startProcess({
				command: launchCommand,
				onStdout: !this.opts.shouldCaptureStdout? undefined: line => {
					this.opts.logger.logStdout(line);
					this.onStdout.fire(line);
				},
				onStderr: !this.opts.shouldCaptureStderr? undefined: line => {
					this.opts.logger.logStderr(line);
					this.onStderr.fire(line);
				},
				onExit: (code, signal) => {
					this.proc = null;
					let expected = this.isStopping
					this.isStopping = false;
					if(!expected){
						this.opts.logger.logTool("Process unexpectedly " + (signal? "stopped with signal " + signal: "exited with code " + code));
					}
					this.onStop.fire({ code, signal, expected });
				}
			});

			await this.onProcessCreated.fire({process: this.proc});

			await Promise.race([
				launchMarkedCompletedPromise,
				this.onStop.wait()
			]);
			this.isStarting = false;

			let result: Koramund.ProjectStartResult = {type: "started"}
			if(this.proc){
				await this.onLaunchCompleted.fire(result);
			}
			return result;
		});

		return result;
	}

}

function sendSignal(proc: ChildProcess.ChildProcess, signal: NodeJS.Signals){
	proc.kill(process.platform === "win32"? undefined: signal);
}