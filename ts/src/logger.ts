import {makeAsyncEvent} from "async_event";
import {Koramund} from "koramund";

export interface LoggerOptions {
	getProject(): Koramund.BaseProject | null;
	logDebug?: boolean;
	readonly log: (opts: Koramund.LoggingLineOptions) => void;
}

/** Class that contains most of logic about tool output */
export class Logger {
	readonly onLine = makeAsyncEvent<Koramund.LoggingLineOptions>(); // for testing purposes
	private vals: LoggingLineCommonValues;
	
	constructor(private readonly opts: LoggerOptions){
		this.vals = {
			get project(): Koramund.BaseProject | null { return opts.getProject() },
			maxNameLength: 0,
			paddedName: "<not set yet>" // should not matter really
		}
	}

	setNameLength(len: number): void {
		let project = this.vals.project;
		this.vals.paddedName = (project?.name ?? "").trim().padEnd(len, " ");
		this.vals.maxNameLength = len;
	}

	private log(message: string, source: Koramund.LoggingLineSource): void {
		let lineOpts = new LoggingLineOptionsImpl(this.vals, source, message);
		this.opts.log(lineOpts);

		if(this.onLine.listenersCount > 0){
			this.onLine.fire(lineOpts);
		}
	}

	logDebug(message: string): void {
		if(this.opts.logDebug){
			this.log(message, "tool");
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
	project: Koramund.BaseProject | null;
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

	get project(): Koramund.BaseProject | null {
		return this.vals.project
	}
}