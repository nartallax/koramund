import {Logger} from "logger";
import {ProcessController} from "process_controller";
import {ShellRunner} from "shell_runner";
import {Koramund} from "types";

export interface CommonProjectParams extends Koramund.CommonProjectParams {
	log: (opts: Koramund.LoggingLineOptions) => void
}

/** A project - some piece of software. Could launch a process. */
export class CommonProject<P extends CommonProjectParams = CommonProjectParams> implements Koramund.CommonProject {

	readonly process: ProcessController | null;
	
	readonly logger: Logger = new Logger({
		project: this,
		log: this.params.log
	});

	readonly shell: ShellRunner = new ShellRunner(this.getWorkingDirectory(), this.logger)
	protected isPreStarting = false;

	constructor(readonly params: P){
		const getLaunchCommand = params.getLaunchCommand;
		this.process = !getLaunchCommand? null: new ProcessController({
			getLaunchCommand,
			logger: this.logger,
			shell: this.shell,
			shouldCaptureStdout: !params.dropStdout,
			shouldCaptureStderr: !params.dropStderr,
			shutdownSequence: params.shutdownSequence,
			beforeStart: () => this.beforeStart()
		});
	}

	get name(): string {
		return this.params.name;
	}

	async restart(): Promise<void>{
		if(!this.process){
			this.logger.logTool("Requested to restart, but this project is not expected to have running process.");
			return;
		}

		await this.process.stop(true);
		await this.start();
	}

	async start(): Promise<void>{
		if(!this.process){
			this.logger.logTool("Requested to start, but this project is not expected to have running process.");
			return;
		}

		if(!await this.beforeStart()){
			return;
		}
		await this.process.start();
	}

	async stop(withSignal?: NodeJS.Signals): Promise<void> {
		if(!this.process){
			return;
		}

		this.process.stop(false, withSignal);
	}

	// on detected that launch is completed
	async notifyLaunched(): Promise<void>{
		if(this.process){
			if(this.process.state === "starting"){
				await this.process.notifyLaunchCompleted();
			} else {
				this.logger.logTool("Detected completed launch of process, but the process is in " + this.process.state + " (and not starting). Won't do anything.");
			}
		} else {
			this.logger.logTool("Detected completed launch of process, but this project is not expected to have process... how is this even happened?");
		}
	}

	onProcessCreated(handler: (event: Koramund.ProcessCreatedEvent) => void): void {
		if(!this.process){
			throw new Error("This project never will launch a process.");
		}
		this.process.onProcessCreated.listen(handler);
	}

	onStarted(handler: () => void): void {
		if(!this.process){
			throw new Error("This project never will launch a process.");
		}
		this.process.onLaunchCompleted.listen(handler);
	}

	onStop(handler: (event: Koramund.ProcessStopEvent) => void): void {
		if(!this.process){
			throw new Error("This project never will launch (and therefore stop) a process.");
		}
		this.process.onStop.listen(handler);
	}

	onStdout(handler: (stdoutLine: string) => void): void {
		if(!this.process){
			throw new Error("This project never will launch a process (and therefore have stdio).");
		}
		this.process.onStdout.listen(handler);
	}

	onStderr(handler: (stderrLine: string) => void): void {
		if(!this.process){
			throw new Error("This project never will launch a process (and therefore have stdio).");
		}
		this.process.onStderr.listen(handler);
	}

	// some methods to override
	protected async beforeStart(): Promise<boolean>{
		return true;
	}

	protected getWorkingDirectory(): string {
		return this.params.workingDirectory || ".";
	}

	/** Stop completely, with all related resources */
	async shutdown(withSignal?: NodeJS.Signals): Promise<void> {
		this.stop(withSignal);
	}

}