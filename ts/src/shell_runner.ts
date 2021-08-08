import * as ChildProcess from "child_process";
import {Logger} from "logger";
import * as Readline from "readline";
import * as Stream from "stream";
import {Koramund} from "types";


export class ShellRunner implements Koramund.ShellHelper {

	constructor(
		readonly workingDirectory: string,
		private readonly logger: Logger
	){}

	async runCommandExpectAnyCode(command: string): Promise<Koramund.ShellCommandRunResult>{
		return await new Promise((ok,bad) => {
			try {
				let process = ChildProcess.exec(command, {
					cwd: this.workingDirectory
				}, (err, stdout, stderr) => {
					if(err){
						bad(err);
					} else {
						ok({
							exitCode: process.exitCode,
							signal: process.signalCode,
							stdout, stderr
						})
					}
				});
			} catch(e){
				bad(e);
			}
		})
	}

	async runCommand(command: string): Promise<Koramund.ShellCommandRunResult>{
		let result = await this.runCommandExpectAnyCode(command);
		if(result.exitCode !== 0){
			throw new Error(`Command ${command} exited with code ${result.exitCode}.\nStdout is ${result.stdout}\nStderr is ${result.stderr}`);
		}
		return result;
	}

	protected createReadline(stream: Stream.Readable | null, handler?: (line: string) => void): Readline.Interface | null {
		if(!stream || !handler){
			return null;
		}

		let result = Readline.createInterface({ input: stream });
		result.on("line", handler)
		return result;
	}

	async startProcess(opts: Koramund.StartProgramOptions): Promise<ChildProcess.ChildProcess>{
		if(opts.command.length < 1){
			throw new Error("Expected at least one value in process start command.");
		}
		let proc = ChildProcess.spawn(opts.command[0], opts.command.slice(1), { 
			cwd: this.workingDirectory,
			stdio: ["ignore", opts.onStdout? "pipe": "ignore", opts.onStderr? "pipe": "ignore"]
		});

		proc.on("error", err => {
			this.logger.logTool(`Process ${JSON.stringify(opts.command)} gave error: ${err.message}`);
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

	runProcess(opts: Koramund.StartProgramOptions): Promise<Koramund.ProcessRunResult>{
		return this.runProcessExpectAnyCode({
			...opts,
			onExit: (code, signal) => {
				if(code !== 0){
					throw new Error(`Process ${JSON.stringify(opts.command)} exited with code ${code}.`);
				}

				if(opts.onExit){
					opts.onExit(code, signal)
				}
			}
		});
	}

	runProcessExpectAnyCode(opts: Koramund.StartProgramOptions): Promise<Koramund.ProcessRunResult>{


		return new Promise((ok, bad) => {
			this.startProcess({ 
				...opts,
				onExit: (code, signal) => {
					if(opts.onExit){
						try {
							opts.onExit(code, signal)
						} catch(e){
							bad(e);
						}
					}
					ok({signal, exitCode: code});
				}
			}).catch(bad);
		})
	}

}