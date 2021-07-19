import {AsyncEvent} from "async_event";
import {Koramund} from "types";

export interface LoggerOptions {
	readonly project: Koramund.CommonProgram;
	readonly log: (opts: Koramund.LoggingLineOptions) => void;
}

/** Class that contains most of logic about tool output */
export class Logger {
	readonly onLine = new AsyncEvent<Koramund.LoggingLineOptions>(); // for testing purposes
	private vals: LoggingLineCommonValues;
	
	constructor(private readonly opts: LoggerOptions){
		this.vals = {
			project: opts.project,
			maxNameLength: opts.project.name.length, // is there better initial value..?
			paddedName: opts.project.name
		}
	}

	setNameLength(len: number): void {
		this.vals.paddedName = this.vals.paddedName.trim().padEnd(len, " ");
		this.vals.maxNameLength = len;
	}

	private log(message: string, source: Koramund.LoggingLineSource): void {
		let lineOpts = new LoggingLineOptionsImpl(this.vals, source, message);
		this.opts.log(lineOpts);

		if(this.onLine.listenersCount > 0){
			this.onLine.fire(lineOpts);
		}
	}

	logTool(message: string): void {
		this.log(message, "tool")
	}

	logStderr(message: string): void {
		this.log(message, "stderr")
	}

	logStdout(message: string): void {
		this.log(message, "stdout")
	}
}

interface LoggingLineCommonValues {
	project: Koramund.CommonProgram;
	maxNameLength: number;
	paddedName: string;
}

let twoDig = (x: number) => (x < 10? "0": "") + x;
let threeDig = (x: number) => (x < 10? "00": x < 100? "0": "") + x;

class LoggingLineOptionsImpl implements Koramund.LoggingLineOptions {
	private readonly now = new Date();

	constructor(private readonly vals: LoggingLineCommonValues,
		readonly source: Koramund.LoggingLineSource, 
		readonly message: string){}

	get dateStr(): string {
		let d = this.now;
		return `${d.getFullYear()}.${twoDig(d.getMonth() + 1)}.${twoDig(d.getDate())}`;
	}

	get timeStr(): string {
		let d = this.now;
		return `${twoDig(d.getHours())}:${twoDig(d.getMinutes())}:${twoDig(d.getSeconds())}:${threeDig(d.getMilliseconds())}`
	}

	get paddedProjectName(): string {
		return this.vals.paddedName;
	}

	get maxNameLength(): number {
		return this.vals.maxNameLength;
	}

	get project(): Koramund.CommonProgram {
		return this.vals.project
	}
}