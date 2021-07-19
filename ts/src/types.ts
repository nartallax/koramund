import * as Http from "http";
import * as Websocket from "websocket";
import * as ChildProcess from "child_process";
import {Imploder} from "@nartallax/imploder";

// тесты:
// можно прочесть все тело в обработчике http-запроса, и оно будет передано вызываемому серверу
// можно не читать тело в обработчике http-запроса, и оно будет потоково застримлено серверу
// вебсокеты
// можно запускать имплодер-проект без хттп прокси
// при бесконечно не останавливающемся процессе логгер будет бесконечно логгировать то, что процесс не останавливается
// написать тесты на разнообразные сигналы (kill, например), а затем гонять их на винде

export namespace Koramund {

	export function create(opts: EngineOptions): Engine {
		void opts;
		throw new Error("Not implemented.")
	}

	export interface EngineOptions {
		log: (opts: LoggingLineOptions) => void;
		defaults?: Partial<CommonProgramParams>;
	}
	
	/** An initial entrypoint for any action in framework */
	export interface Engine {
		addImploderProject(params: ImploderProjectParams): Promise<ImploderProject>;
		addProgram<T extends CommonProgramParams>(params: T): Promise<CommonProgram<T>>;

		/** Path to NodeJS executable that runs the tool */
		readonly nodePath: string;
	}

	/** Common part of any project/program */
	export interface CommonProgram<P extends CommonProgramParams = CommonProgramParams> {
		readonly name: string;
		readonly params: P;
		/** Shell helper with default working directory = program working directory */
		readonly shell: ShellHelper;
		/** Controller for the process of the program/project. Could be null if project is not launchable */
		readonly process: ProcessController | null;
		/** Should be invoked when launch is in progress to notify the program about it's launch status */
		notifyLaunched(): void;

		/** Start the project. Promise resolves when the project is started completely, i.e. after notifyLaunched() is invoked */
		start(): Promise<void>;
		
		/** Stop the project. Resolves when stop sequence is completed. */
		stop(): Promise<void>;

		/** stop() and then start(). Won't throw project is not launched, so can be used as safer start() variant */
		restart(): Promise<void>;

		// note that some event handlers here and later expect to get promise sometimes
		// this means that these events will wait for all handlers to complete before carrying on usual actions
		/** New process just created for this project */
		onProcessCreated(handler: (event: ProcessCreatedEvent) => void): void;
		/** Startup completed (notifyLaunched invoked) */
		onStarted(handler: () => void): void;
		/** Process terminated */
		onStop(handler: (event: ProcessStopEvent) => void): void;
		/** A line appears on stdout of the process */
		onStdout(handler: (stdoutLine: string) => void): void;
		/** A line appears on stdin of the process */
		onStderr(handler: (stderrLine: string) => void): void;
	}

	/** An Imploder project.
 	* Imploder instance will be launched, and project code will be launched and restarted according to conditions. */
	export interface ImploderProject extends CommonProgram<ImploderProjectParams> {
		/** Imploder context of the project. Null means not started yet */
		readonly imploder: Imploder.Context | null;

		/** Set the TCP port last launched program instance listens on with HTTP server.
		 * Best set when program is starting. Could be different between different program
		 * It is highly recommended in development to bind on random port and parse this port's number from stdin/stderr.
		 * This way you can have same ports in development and in production: 
		 * in development requests will be proxified by the tool, and in production they will be handled by project directly. */
		notifyProcessHttpPort(port: number): void; 

		/** Build project.
		 * Default build type is release, because in development builds are performed automatically */
		build(buildType?: BuildType): Promise<BuildResult>;

		/** Start Imploder instance.
		 * Is not nessessary to call before start() or build(), as they will call this on its own.
		 * Should be called in case of development of in-browser projects, which won't really "start" on their own.
		 * Best runs with lazyStart Imploder option, allowing to postpone actual start of compiler. */
		startImploder(): Promise<Imploder.Context>;

		/** A build of the project is finished. Note that the build could be unsuccessful. */
		onBuildFinished(handler: (buildResult: BuildResult) => void): void;
		/** Proxy receives HTTP request */
		onHttpRequest(handler: (request: HttpRequest) => PromiseOrValue<void>): void;
		/** Proxy receives websocket connect request */
		onWebsocketConnectStarted(handler: (request: Websocket.request) => PromiseOrValue<void>): void;
		/** Proxy connected incoming client connection to server */
		onWebsocketConnected(handler: (request: Websocket.request) => void): void;
		/** Proxy detected disconnect of one of the parties */
		onWebsocketDisconnected(handler: (event: WebsocketDisconnectEvent) => void): void
		/** Proxy got message from one of the parties */
		onWebsocketMessage(handler: (event: WebsocketMessageEvent) => PromiseOrValue<void>): void;
	}

	/** Common parts of project/program definition. */
	export interface CommonProgramParams {
		/** How to launch the project - a program and its arguments.
		 * If not passed, project should not be launched. This makes sense in case of Imploder projects that only need running Imploder instance.*/
		readonly getLaunchCommand?: () => PromiseOrValue<ReadonlyArray<string>>;

		/** If not specified, defaults to path to project config file, or this config directory is used. */
		readonly workingDirectory?: string;
		
		/** Name of program */
		readonly name: string;

		/** Description of graceful way of process shutdown.
		 * Default is "send SIGINT, wait 60 seconds, send SIGKILL"
		 * Process shutdown occurs on tool termination, and on process-specific conditions. */
		readonly shutdownSequence?: RoArrayOrSingle<ShutdownSequenceItem>;

		// stdio options. sometimes could help fight performance issues if stdout/stderr is big and useless
		// passing false here will drop all input to onStderr/onStdout completely, as well as input to logger
		readonly dropStdout?: boolean;
		readonly dropStderr?: boolean;
	}

	export interface ImploderProjectParams extends CommonProgramParams {
		/** Path to tsconfig.json of Imploder project */
		readonly tsconfigPath: string;

		/** Set the TCP port the tool will listen for incoming requests on.
		 * Proxifying HTTP requests in development is the way to achieve advanced control over projects
		 * (lazy-start of project/compiler, intercepting and triggering on http requests to project, and more) */
		readonly proxyHttpPort?: number;

		/** Connect and read timeout for proxy. Milliseconds. Default is 180000 */
		readonly proxyTimeout?: number;

		/** Name of Imploder profile. Profiles are specified in tsconfig.json
		 * This profile will be used when tool is trying to be built.
		 * Tool will launch Imploder on release build (expects single-time build) 
		 * and before process start/restart (expects watch mode) */
		readonly profile?: string;
	}

	export type LoggingLineSource = "stdout" | "stderr" | "tool";

	export interface LoggingLineOptions {
		/** Where does this message comes from - from stdio of the project, or from the tool itself? */
		readonly source: LoggingLineSource; 
		readonly project: CommonProgram;
		/** White-padded project name to make outputs more beautiful */
		readonly paddedProjectName: string;
		/** Longest name length among active projects */
		readonly maxNameLength: number;
		readonly message: string;
		readonly timeStr: string;
		readonly dateStr: string;
	}

	export type RoArrayOrSingle<T> = ReadonlyArray<T> | T;
	export type PromiseOrValue<T> = Promise<T> | T;

	export type BuildType = "development" | "release";

	export interface BuildResult {
		success: boolean;
		type: BuildType;
	}

	export interface HttpRequest {
		method: string;
		url: string;
		headers: Http.IncomingHttpHeaders;
		getBody(): Promise<Buffer>;
	}

	export interface WebsocketDisconnectEvent {
		from: "client" | "server";
		error: Error | null;
		code: number;
		description: string;
	}

	export interface WebsocketMessageEvent {
		message: Websocket.IMessage;
		from: "client" | "server";
	}

	/** A single action in shutdown sequence */
	export type ShutdownSequenceItem = SignalShutdownSequenceItem | WaitShutdownSequenceItem

	/** Action "send system signal to a process" */
	export interface SignalShutdownSequenceItem {
		signal: NodeJS.Signals;
	}

	/** Action "wait" */
	export interface WaitShutdownSequenceItem {
		wait: number;
	}

	export interface ProcessStopEvent {
		code: number | null;
		signal: NodeJS.Signals | null;
		/** Was this stop expected/initiated by tool, or the program just crashed/stopped spontaneously? */
		expected: boolean
	}

	export interface ProcessCreatedEvent {
		process: ChildProcess.ChildProcess
	}

	/** An utility to help run shell commands and spawn processes
	 * Expects zero exit code from any program running, but this is overrideable */
	export interface ShellHelper {
		runCommand(command: string): Promise<ShellCommandRunResult>
		runCommandExpectAnyCode(command: string): Promise<ShellCommandRunResult>
		startProcess(opts: StartProgramOptions): Promise<ChildProcess.ChildProcess>
		runProcess(opts: StartProgramOptions): Promise<{signal: NodeJS.Signals | null}>
		runProcessExpectAnyCode(opts: StartProgramOptions): Promise<{signal: NodeJS.Signals | null}>
	}

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

	export type ProcessRunState = "stopped" | "starting" | "running" | "stopping";

	/** Wrapper around some program that could be started and stopped */
	export interface ProcessController {
		readonly process: ChildProcess.ChildProcess | null;
		readonly state: ProcessRunState;
	}

}