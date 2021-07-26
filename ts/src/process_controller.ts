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
	{wait: 60},
	{signal: "SIGKILL"}
];



/** Wrapper around some program that could be started and stopped */
export class ProcessController implements Koramund.ProcessController {

	private proc: ChildProcess.ChildProcess | null = null;
	readonly onLaunchCompleted = makeAsyncEvent();
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
		if(!this.proc){
			return this.isStarting? "starting": "stopped";
		} else {
			return this.isStopping? "stopping": "running";
		}
	}

	async notifyLaunchCompleted(): Promise<void> {
		await this.onLaunchCompleted.fire();
	}

	private async withWaitLogging(actionName: string, action: () => Promise<void>): Promise<void> {
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
					this.opts.logger.logTool("Stop requested, but no process is running. Won't do anything.")
				}
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
					// let's allow some freedom about signal name case
					let signal = action.signal.toUpperCase() as NodeJS.Signals;
					proc.kill(signal);
				} else if(isWaitShutdownSequenceItem(action)){
					let isStopped = await Promise.race([
						new Promise<boolean>(ok => setTimeout(() => ok(false), Math.ceil(action.wait * 1000))),
						stopPromise
					]);
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

	async start(): Promise<void> {
		if(this.isStarting){
			this.opts.logger.logTool("Requested start more than once simultaneously. Will only start once.");
			return;
		}
		let state = this.state;
		this.isStarting = true;

		switch(state){
			case "running":
				this.opts.logger.logTool("Start requested, but the process is already running. Won't do anything.")
				return;
			case "starting": // wtf? how could this even happen
			this.opts.logger.logTool("Start requested, but the process is already starting. Won't initiate start second time.")
				await this.onLaunchCompleted.wait();
				// clear hasUserInitiatedStart here...? don't know, it's unobvious how this could happen at all
				return;
			case "stopping":
				await this.onStop.wait();
				break;
		}

		let launchPromise = this.onLaunchCompleted.wait();
		let launchCommand = await Promise.resolve(this.opts.getLaunchCommand());

		await this.withWaitLogging("launch", async () => {
			if(this.proc){
				this.opts.logger.logTool("Start requested, but some process is already running in state " + this.state + ". Won't start second time.");
				this.isStarting = false;
				return;
			}

			try {
				await this.onBeforeStart.fire();
			} catch(e){
				this.opts.logger.logTool("Could not start process: " + (e.message || e))
				this.isStarting = false;
				return;
			}
			
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
					if(!this.isStopping){
						// if nothing waits for shutdown event - the shutdown is considered unexpected
						this.opts.logger.logTool("Process unexpectedly " + (signal? "stopped with signal " + signal: "exited with code " + code));
					}
					let expected = this.isStopping
					this.isStopping = false;
					this.onStop.fire({ code, signal, expected });
				}
			});

			await this.onProcessCreated.fire({process: this.proc});

			await launchPromise;
			this.isStarting = false;
		});
	}

}