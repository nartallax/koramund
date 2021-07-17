import * as ChildProcess from "child_process";
import {JsonDataResolver} from "json_data_resolver";
import {Logger} from "logger";
import * as Readline from "readline";
import * as Stream from "stream";

export interface ShellCommandRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface StartProgramOptions {
	command: ReadonlyArray<string>;
	onStdout?: ((line: string) => void) | undefined;
	onStderr?: ((line: string) => void) | undefined;
	onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

// TODO: weird inheritance chain, refactor
// this is used to pass utility functions
export abstract class ShellRunner extends JsonDataResolver {
	protected abstract readonly workingDirectory: string;
	protected abstract readonly logger: Logger;

	protected async fixCommand(command: string): Promise<string>{ return command; }
	protected async fixCommandParts(commandParts: ReadonlyArray<string>): Promise<ReadonlyArray<string>>{ return commandParts; }

	async runShellCommand(command: string): Promise<ShellCommandRunResult>{
		command = await this.fixCommand(command);
		return await new Promise((ok,bad) => {
			try {
				let process = ChildProcess.exec(command, {
					cwd: this.workingDirectory
				}, (err, stdout, stderr) => {
					if(err){
						bad(err);
					} else {
						ok({exitCode: process.exitCode, stdout, stderr})
					}
				});
			} catch(e){
				bad(e);
			}
		})
	}

	async runShellCommandWithZeroCode(command: string): Promise<ShellCommandRunResult>{
		let result = await this.runShellCommand(command);
		if(result.exitCode !== 0){
			throw new Error(`Command ${command} exited with code ${result.exitCode}.\nStdout is ${result.stdout}\nStderr is ${result.stderr}`);
		}
		return result;
	}

	async runShellCommandToStdout(command: string): Promise<string> {
		return (await this.runShellCommandWithZeroCode(command)).stdout;
	}

	async runShellCommandToInt(command: string): Promise<number>{
		let dirtyResult = await this.runShellCommandToStdout(command);
		let clearResult = dirtyResult.replace(/[\s\n\t\r]/g, "");
		let numberResult = parseInt(clearResult);
		if(Number.isNaN(numberResult)){
			throw new Error(`Failed to get number from shell command "${command}": could not parse int from shell execution result "${dirtyResult}"`);
		}
		return numberResult
	}

	protected createReadline(stream: Stream.Readable | null, handler?: (line: string) => void): Readline.Interface | null {
		if(!stream || !handler){
			return null;
		}

		let result = Readline.createInterface({ input: stream });
		result.on("line", handler)
		return result;
	}

	async startProcessFromCommand(opts: StartProgramOptions): Promise<ChildProcess.ChildProcess>{
		let launchCommand = await this.fixCommandParts(opts.command);
		let proc = ChildProcess.spawn(launchCommand[0], launchCommand.slice(1), { 
			cwd: this.workingDirectory,
			stdio: ["ignore", opts.onStdout? "pipe": "ignore", opts.onStderr? "pipe": "ignore"],
			gid: process.getgid()
		});

		proc.on("error", err => {
			this.logger.logTool("Process gave error: " + err.message);
		});

		proc.on("exit", (code, signal) => {
			stdoutReader?.close();
			stdoutReader = null;
			stderrReader?.close();
			stderrReader = null;
			opts.onExit && opts.onExit(code, signal);
		});

		let stdoutReader = this.createReadline(proc.stdout, opts.onStdout);
		let stderrReader = this.createReadline(proc.stderr, opts.onStderr);

		return proc;
	}

	startProcessFromCommandPassLogs(opts: StartProgramOptions): Promise<ChildProcess.ChildProcess>{

		let updateOption = (stderr: boolean) => {
			const oldHandler = stderr? opts.onStderr: opts.onStdout;
			const haveLogHandler = stderr? this.logger.opts.showStderr !== false: this.logger.opts.showStdout !== false;
			if(haveLogHandler || oldHandler){
				const logHandler = (stderr? this.logger.logStderr: this.logger.logStdout).bind(this.logger);
				const newHandler: (line: string) => void = oldHandler? line => {
					logHandler(line);
					oldHandler(line);
				}: logHandler;
				if(stderr){
					opts.onStderr = newHandler;
				} else {
					opts.onStdout = newHandler;
				}
			}
		}

		updateOption(false);
		updateOption(true);

		return this.startProcessFromCommand(opts);
	}

	startProcessFromCommandPassLogsWaitZeroExit(command: string[]): Promise<{signal: NodeJS.Signals | null}>{
		return new Promise((ok, bad) => {
			this.startProcessFromCommandPassLogs({ 
				command,
				onExit: (code, signal) => {
					if(code !== 0){
						bad(new Error(`Process ${JSON.stringify(command)} exited with code ${code}.`));
						return;
					}

					ok({signal});
				}
			}).catch(bad);
		})
	}


}