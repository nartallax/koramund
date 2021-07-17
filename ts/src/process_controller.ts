import * as ChildProcess from "child_process";
import {Logger} from "logger";
import {RoArrayOrSingle, OnShutdownActionName, ShutdownSequenceItem} from "types";
import {arrayOfMaybeArray, isSignalShutdownSequenceItem, isWaitShutdownSequenceItem} from "utils";
import {AsyncEvent} from "async_event";
import {ShellRunner} from "shell_runner";

export interface ProcessOptions {
	readonly logger: Logger;
	readonly workingDirectory: string;
	readonly onUnexpectedShutdown: OnShutdownActionName;
	readonly getLaunchCommand: () => Promise<ReadonlyArray<string>>;
	readonly onStdout: (line: string) => void;
	readonly onStderr: (line: string) => void;
	readonly shouldCaptureStdout: () => boolean;
	readonly shouldCaptureStderr: () => boolean;
	readonly onProcessCreated?: () => void;
	readonly shutdownSequence?: RoArrayOrSingle<ShutdownSequenceItem>;
}

const defaultShutdownSequence: ReadonlyArray<ShutdownSequenceItem> = [
	{signal: "SIGINT"},
	{wait: 60},
	{signal: "SIGKILL"}
];

export type ProcessState = "stopped" | "starting" | "running" | "stopping";

/** Wrapper around some program that could be started and stopped */
export class ProcessController extends ShellRunner {

	proc: ChildProcess.ChildProcess | null = null;
	private stopWaitingList = new AsyncEvent();
	private launchCompletedWaitingList = new AsyncEvent();

	protected get workingDirectory(): string {
		return this.opts.workingDirectory;
	}

	protected get logger(): Logger {
		return this.opts.logger;
	}

	get state(): ProcessState {
		if(!this.proc){
			return this.launchCompletedWaitingList.listenersCount === 0? "stopped": "starting";
		} else {
			return this.stopWaitingList.listenersCount === 0? "running": "stopping";
		}
	}

	constructor(private readonly opts: ProcessOptions){
		super();
	}

	async onLaunchCompleted(): Promise<void> {
		await this.launchCompletedWaitingList.fire();
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

	private shouldKeepStdio(isStderr: boolean): boolean {
		let loggerOpts = this.opts.logger.opts;
		let haveLogs = isStderr? loggerOpts.showStderr !== false: loggerOpts.showStdout !== false;
		let haveOption = isStderr? this.opts.shouldCaptureStderr(): this.opts.shouldCaptureStdout();
		return haveLogs || haveOption;
	}

	couldStopInThisState(state: ProcessState = this.state): boolean {
		return state === "running"
	}

	couldStartInThisState(state: ProcessState = this.state): boolean {
		return state === "stopped";
	}

	stopImmediatelyAndRough(): void {
		if(this.proc){
			this.proc.kill("SIGKILL");
		}
	}

	stop(force?: boolean, skipFirstSignal?: NodeJS.Signals): Promise<void>{
		return new Promise((ok, bad) => {
			try {
				const proc = this.proc;
				if(!proc){
					this.opts.logger.logTool("Stop requested, but no process is running. That's strange.")
					return;
				}

				let state = this.state;
				if(!this.couldStopInThisState(state) && !force){
					this.opts.logger.logTool("Stop requested, but process is " + state + "; won't do it now.");
					return;
				}

				let stopped = false;
				this.waitStopCompleted().then(() => {
					stopped = true;
					ok();
				});
				this.withWaitLogging("stop", async () => {
					this.opts.logger.logTool("Stopping.")
					let shutdownSequence = arrayOfMaybeArray(this.opts.shutdownSequence || defaultShutdownSequence);
					let firstAction = shutdownSequence[0];
					let shouldSkipFirst = !!firstAction && 
						isSignalShutdownSequenceItem(firstAction) && 
						firstAction.signal.toUpperCase() === skipFirstSignal?.toUpperCase();
					for(let i = shouldSkipFirst? 1: 0; i < shutdownSequence.length; i++){
						const action = shutdownSequence[i];
						if(stopped){
							// this means application stopped before we got to the end of the sequence
							return;
						}
						if(isSignalShutdownSequenceItem(action)){
							// let's allow some freedom about signal name case
							let signal = action.signal.toUpperCase() as NodeJS.Signals;
							proc.kill(signal);
						} else if(isWaitShutdownSequenceItem(action)){
							await new Promise(ok => setTimeout(ok, action.wait));
						} else {
							throw new Error("Unknown shutdown sequence item: " + JSON.stringify(action));
						}
					}
				}).catch(bad);
			} catch(e){
				bad(e);
			}
		})
	}

	waitLaunchCompleted(): Promise<void>{
		return this.launchCompletedWaitingList.wait();
	}

	waitStopCompleted(): Promise<void>{
		return this.stopWaitingList.wait();
	}

	async start(): Promise<void> {
		let state = this.state;
		if(!this.couldStartInThisState(state)){
			this.opts.logger.logTool("Requested start, but process is " + state + ". Won't start now.");
			return;
		}

		let launchPromise = this.waitLaunchCompleted();
		let launchCommand = await this.opts.getLaunchCommand();

		await this.withWaitLogging("launch", async () => {
			let keepingStdout = this.shouldKeepStdio(false);
			let keepingStderr = this.shouldKeepStdio(true);

			this.proc = await this.startProcessFromCommand({
				command: launchCommand,
				onStdout: !keepingStdout? undefined: this.onStdout.bind(this),
				onStderr: !keepingStderr? undefined: this.onStderr.bind(this),
				onExit: (code, signal) => {
					this.proc = null;
					if(this.stopWaitingList.listenersCount > 0){
						this.stopWaitingList.fire();
					} else {
						// if nothing waits for shutdown event - the shutdown is considered unexpected
						this.opts.logger.logTool("Process " + (signal? "stopped with signal " + signal: "exited with code " + code));
						if(this.opts.onUnexpectedShutdown === "restart"){
							this.start();
						}
					}
				}
			});

			this.opts.onProcessCreated && this.opts.onProcessCreated();

			await launchPromise;
		});
	}

	private onStdout(line: string){
		this.opts.logger.logStdout(line);
		this.opts.onStdout(line);
	}

	private onStderr(line: string){
		this.opts.logger.logStderr(line);
		this.opts.onStderr(line);
	}

}