import * as ChildProcess from "child_process";
import {Logger} from "logger";
import {arrayOfMaybeArray, isSignalShutdownSequenceItem, isWaitShutdownSequenceItem} from "utils";
import {makeAsyncEvent} from "async_event";
import {ShellRunner} from "shell_runner";
import {Koramund} from "types";

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
			this.proc? "running":
			"stopped";
	}

	async notifyLaunchCompleted(): Promise<void> {
		await this.onLaunchMarkedCompleted.fire();
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
			this.proc.kill("SIGKILL");
		}
	}

	async stop(couldAlreadyBeStoppingOrStopped?: boolean, skipFirstSignal?: NodeJS.Signals): Promise<void>{
		if(this.isStopping){
			this.opts.logger.logTool("Stop requested more than one time simultaneously. Will only stop once.")
			return;
		}
		let state = this.state;
		this.isStopping = true;

		switch(state){
			case "stopped":
				if(!couldAlreadyBeStoppingOrStopped){
					this.opts.logger.logTool("Stop requested, but no process is running. Won't do anything.");
				}
				this.isStopping = false;
				return;
			case "starting":
				await this.onLaunchCompleted.wait();
				break;
			case "stopping":
				if(!couldAlreadyBeStoppingOrStopped){
					this.opts.logger.logTool("Stop requested, but the process is already stopping.")
				}
				await this.onStop.wait();
				return;
		}

		const proc = this.proc;
		if(!proc){
			this.opts.logger.logTool(`Stop requested, but no process is running in state ${this.state}. Won't do anything.`)
			this.isStopping = false;
			return;
		}

		await this.withWaitLogging("stop", async () => {
			let stopPromise = this.onStop.wait().then(() => true);
			this.opts.logger.logTool("Stopping.")
			let shutdownSequence = arrayOfMaybeArray(this.opts.shutdownSequence || defaultShutdownSequence);
			let firstAction = shutdownSequence[0];
			let shouldSkipFirst = !!firstAction && 
				isSignalShutdownSequenceItem(firstAction) && 
				firstAction.signal.toUpperCase() === skipFirstSignal?.toUpperCase();
			for(let i = shouldSkipFirst? 1: 0; i < shutdownSequence.length; i++){
				const action = shutdownSequence[i];
				if(isSignalShutdownSequenceItem(action)){
					proc.kill(action.signal);
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
		}
		let state = this.state;
		this.isStarting = true;

		switch(state){
			case "running":
				this.opts.logger.logTool("Start requested, but the process is already running. Won't do anything.")
				return { type: "already_running" }
			case "starting": // wtf? how could this even happen
				this.opts.logger.logTool("Start requested, but the process is already starting. Won't initiate start second time.")
				return await this.onLaunchCompleted.wait();
				// clear hasUserInitiatedStart here...? don't know, it's unobvious how this could happen at all
			case "stopping":
				await this.onStop.wait();
				break;
		}

		let launchMarkedCompletedPromise = this.onLaunchMarkedCompleted.wait();
		return await this.withWaitLogging<Koramund.ProjectStartResult>("launch", async () => {
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
	}

}