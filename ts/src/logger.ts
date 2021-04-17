import {LoggingOptions} from "types";
import * as stringFormat from "string-format";
import {AsyncEvent} from "async_event";

let twoDig = (x: number) => (x < 10? "0": "") + x;
let threeDig = (x: number) => (x < 10? "00": x < 100? "0": "") + x;

function dateStr(d: Date): string {
	return `${d.getFullYear()}.${twoDig(d.getMonth() + 1)}.${twoDig(d.getDate())}`;
}

function timeStr(d: Date): string {
	return `${twoDig(d.getHours())}:${twoDig(d.getMinutes())}:${twoDig(d.getSeconds())}:${threeDig(d.getMilliseconds())}`;
}

export interface LoggerOptions extends LoggingOptions {
	readonly projectName: string;
}

/** Class that contains most of logic about tool output */
export class Logger {
	private readonly outputRegexp: RegExp | null;
	private readonly formatString: string;
	private name: string;
	readonly onLine = new AsyncEvent<string>(); // for testing purposes

	constructor(readonly opts: LoggerOptions){
		this.outputRegexp = !opts.outputExtractionRegexp? null: new RegExp(opts.outputExtractionRegexp);
		this.formatString = opts.format || "{projectName} | {date} {time} | {message}";
		this.name = opts.projectName;
	}

	setNameLength(len: number): void {
		this.name = this.name.trim().padEnd(len, " ");
	}

	private log(message: string): void {
		let d = new Date();
		let line = stringFormat(this.formatString, {
			projectName: this.name,
			date: dateStr(d),
			time: timeStr(d),
			message
		});

		console.error(line);

		if(this.onLine.listenersCount > 0){
			this.onLine.fire(line);
		}
	}

	logTool(message: string): void {
		if(this.opts.showToolLogs !== false){
			this.log(message)
		}
	}

	private extractOutputFromStdioAndLog(message: string): void {
		if(!this.outputRegexp){
			this.log(message);
			return;
		}

		let match = message.match(this.outputRegexp)
		if(match && match[1]){
			this.log(match[1]);
		}
	}

	logStderr(message: string): void {
		if(this.opts.showStderr !== false){
			this.extractOutputFromStdioAndLog(message);
		}
	}

	logStdout(message: string): void {
		if(this.opts.showStdout !== false){
			this.extractOutputFromStdioAndLog(message);
		}
	}
}