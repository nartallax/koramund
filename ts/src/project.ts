import {AsyncEvent} from "async_event";
import {CommonProjectDefinition, OnShutdownActionName} from "types";
import {Logger} from "logger";
import {ProcessController} from "process_controller";
import * as stringFormat from "string-format";
import {ShellRunner} from "shell_runner";

/** A project - some piece of software. Could launch a process. */
export abstract class Project<D extends CommonProjectDefinition = CommonProjectDefinition> extends ShellRunner {

	readonly process: ProcessController | null;
	
	readonly onProcessCreated = new AsyncEvent();
	readonly onStdout = new AsyncEvent<string>();
	readonly onStderr = new AsyncEvent<string>();

	get name(): string {
		return this.def.name || "."
	}

	get workingDirectory(): string {
		return this.def.workingDirectory || ".";
	}

	readonly logger: Logger = new Logger({
		projectName: this.name, 
		...this.def.logging
	});

	constructor(readonly def: D){
		super();
		const launchCmd = def.launchCommand;
		this.process = !launchCmd? null: new ProcessController({
			getLaunchCommand: () => this.fixCommandParts(launchCmd),
			logger: this.logger,
			onUnexpectedShutdown: this.getActionOnUnexpectedShutdown(),
			workingDirectory: this.def.workingDirectory || ".",
			onProcessCreated: () => this.onProcessCreated.fire(),
			onStdout: line => this.onStdout.fire(line),
			onStderr: line => this.onStderr.fire(line),
			shouldCaptureStdout: () => this.onStdout.listenersCount > 0,
			shouldCaptureStderr: () => this.onStderr.listenersCount > 0,
			shutdownSequence: def.shutdownSequence
		});
	}

	protected async fixCommand(template: string): Promise<string>{
		let args = await this.getLaunchCommandTemplateArgs();
		return stringFormat(template, args)
	}

	protected async fixCommandParts(template: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
		let args = await this.getLaunchCommandTemplateArgs();
		return template.map(part => stringFormat(part, args))
	}

	protected isPreStarting = false;
	/** Start or restart project */
	async restart(): Promise<void>{
		if(!this.process){
			this.logger.logTool("Requested to start/restart, but this project is not expected to have running process.");
			return;
		}

		if(this.process.couldStopInThisState()){
			await this.process.stop();
		}

		if(this.process.couldStartInThisState() && !this.isPreStarting){
			this.isPreStarting = true;
			let shouldStart = false;
			try {
				shouldStart = await this.beforeStart();
			} finally {
				this.isPreStarting = false;
			}
			if(shouldStart){
				await this.process.start();
			}
		}
	}

	async beforeShutdown(withSignal?: NodeJS.Signals): Promise<void> {
		if(!this.process){
			return;
		}

		// here I could also check for "starting" and wait for start
		// but it could lead to deadlock if started condition relies on different process
		// which is already dead at the moment
		// so it is better to send shutdown signals when process is starting rather than deadlock
		if(this.process.state === "stopping"){
			this.logger.logTool("Shutdown: process is already stopping, waiting for it.")
			await this.process.waitStopCompleted();
		} else if(this.process.state !== "stopped"){
			this.logger.logTool("Shutdown: stopping process.")
			await this.process.stop(true, withSignal);
		}
	}

	// on detected that launch is completed
	async onLaunchCompleted(): Promise<void>{
		if(this.process){
			await this.process.onLaunchCompleted();
		} else {
			this.logger.logTool("Detected completed launch of process, but this project is not expected to have process... how is this even happened?");
		}
	}

	// some methods to override
	// on prepare stage
	async prepareForDevelopment(): Promise<void>{
		// nothing here by default
	}
	// on initial launch stage
	abstract onInitialLaunch(): Promise<void>;
	protected abstract getActionOnUnexpectedShutdown(): OnShutdownActionName;

	protected async beforeStart(): Promise<boolean>{
		return true;
	}

	// on http port detected
	onHttpPortAcquired(port: number): void {
		this.logger.logTool("This project have nothing to do with its process' HTTP port (got " + port + ")");
	}
	protected async getLaunchCommandTemplateArgs(): Promise<{[name: string]: string}>{
		return { node: process.argv[0] }
	}

	protected getProjectSourcesRootDir(): string | undefined {
		return undefined;
	}

}