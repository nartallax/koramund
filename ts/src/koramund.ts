import * as Http from "http"
import * as Ws from "ws"
import * as ChildProcess from "child_process"
import {ProjectController} from "project_controller"
import {Imploder} from "@nartallax/imploder"
import {Logger} from "logger"
import {NodeEnvController} from "node_env_controller"

export namespace Koramund {

	export async function create(opts: ProjectControllerOptions): Promise<ProjectController> {
		let logger = new Logger({
			getProject: () => null,
			log: opts.log,
			logDebug: opts.verboseLogging
		})

		let nodeEnv = await NodeEnvController.create(logger)

		return new ProjectController(opts, logger, nodeEnv)
	}

	export interface ProjectControllerOptions {
		log(opts: LoggingLineOptions): void
		/** If true, controller won't attempt to handle signals received by the tool process instance */
		preventSignalHandling?: boolean
		/** For debugging purposes */
		verboseLogging?: boolean
	}

	/** An initial entrypoint for any action in framework */
	export interface ProjectController {
		addProject(p: BaseProjectParams): BaseProject<BaseProjectParams>
		addProject(p: ImploderProjectParams): ImploderProject
		addProject(p: LaunchableProjectParams): LaunchableProject
		addProject(p: ImploderProjectParams & LaunchableProjectParams): ImploderProject & LaunchableProject
		addProject(p: HttpProxifyableProjectParams): HttpProxifyableProject
		addProject(p: ImploderProjectParams & HttpProxifyableProjectParams): ImploderProject & HttpProxifyableProject

		readonly nodeEnv: NodeEnvironmentController

		/** Build all the buildable projects */
		buildAll(): Promise<BuildResult[]>

		/** Gracefully stop all the running processes
		 * You probably don't need to invoke this explicitly,
		 * as controller will handle signals by itself (see its options).
		 * If shutdown is requested through signal sending, you should pass it to the method
		 * as this signal is probably already passed to the child processes by OS
		 * and it needed to be taken into account */
		shutdown(signal?: NodeJS.Signals): Promise<void>

		/** Roughly stop all the running processes.
		 * Same as shutdown(), but won't use shutdown sequences and will just SIGKILL everything.
		 * Therefore could potentially lead to absense of proper cleanup. */
		shutdownRough(): Promise<void>
	}

	/** An object that provides various information about NodeJS and related tools, like npm */
	export interface NodeEnvironmentController {
		/** Path to NodeJS executable that was used to start the tool */
		nodeExecutablePath: string
		/** Path no npm executable that is bundled with the NodeJS that was used to start the tool */
		npmExecutablePath: string
		/** Path to something like ./node_modules/.bin/ */
		npmBinDirectory: string
		/** @param execName name of executable file provided by some package
		 * @returns full path to the executable */
		getPathToNpmPackageExecutable(execName: string): string
	}

	/** Common part of any project */
	export interface BaseProject<P extends BaseProjectParams = BaseProjectParams> {
		readonly name: string
		readonly params: P
		/** Shell helper with default working directory = program working directory */
		readonly shell: ShellHelper
		readonly logger: Logger

		/** Stop the project process, if present, and release all related resources (compiler, proxy etc) */
		shutdown(): Promise<void>
	}

	export interface LaunchableProject<P extends LaunchableProjectParams = LaunchableProjectParams> extends BaseProject<P> {
		/** Controller for the process of the project. */
		readonly process: ProcessController
		/** Should be invoked when launch is in progress to notify the project about its launch status */
		notifyLaunched(): void

		/** Start the project. Promise resolves when the project is started completely, i.e. after notifyLaunched() is invoked */
		start(): Promise<ProjectStartResult>

		/** Stop the project. Resolves when process exits.
		 * Note 1: it does not directly linked with shutdown sequence. Process may exit earlier or later.
		 * Note 2: it does not imply complete project shutdown. Just the process.
		 * Some resources may still remain loaded, like project's compiler, http proxy and so on. */
		stop(): Promise<void>

		/** stop() and then start(). Won't complain if project is not launched, so can be used as better start() variant */
		restart(): Promise<void>

		// note that some event handlers here and later expect to get promise sometimes
		// this means that these events will wait for all handlers to complete before carrying on usual actions
		/** New process just created for this project */
		onProcessCreated: AsyncEvent<ProcessCreatedEvent>
		/** Startup completed (notifyLaunched invoked) */
		onStarted: AsyncEvent<ProjectStartResult>
		/** Process terminated */
		onStop: AsyncEvent<ProcessStopEvent>
		/** A line appears on stdout of the process */
		onStdout: AsyncEvent<string>
		/** A line appears on stdin of the process */
		onStderr: AsyncEvent<string>
	}

	/** A project buildable with Imploder. */
	export interface ImploderProject<P extends ImploderProjectParams = ImploderProjectParams> extends BaseProject<P> {
		/** Starts Imploder if current profile allows it to start in watch mode */
		startImploderInWatchMode(): Promise<void>

		readonly imploderConfig: Imploder.Config
		readonly imploderStartedInWatchMode: boolean

		/** Build project. Also starts imploder if not yet.
		 * Is invoked implicitly before project restarts, if the project is also launchable.
		 * After that imploder is guaranteed to be started. */
		build(): Promise<BuildResult>

		/** A build of the project is finished. Note that the build could be unsuccessful. */
		onBuildFinished: AsyncEvent<BuildResult>
	}

	/** A launchable project that has HTTP interface and is able to be proxifyed for this interface */
	export interface HttpProxifyableProject<P extends HttpProxifyableProjectParams = HttpProxifyableProjectParams> extends LaunchableProject<P> {
		/** Set the TCP port last launched program instance listens on with HTTP server.
		 * Best set when program is starting. Could be different for different launches
		 * It is highly recommended in development to bind on random port and parse this port's number from stdin/stderr.
		 * This way you can have same ports in development and in production:
		 * in development requests will be proxified by the tool, and in production they will be handled by project directly. */
		notifyProjectHttpPort(port: number): void

		/** Start a proxy without starting the rest of the project.
		 * Is called automatically on first project start.
		 * It is encouraged to lazy-start the projects, because this way randomly-selected ports will never be the same as proxy's. */
		startHttpProxy(): Promise<void>

		/** Port on which HTTP proxy listens */
		getProxyHttpPort(): number
		/** Port on which project process listens.
		 * This is last value passed to notifyProcessHttpPort() */
		getProjectHttpPort(): number

		/** Proxy receives HTTP request */
		onHttpRequest: AsyncEvent<HttpRequest>
		/** Proxy receives websocket connect request */
		onWebsocketConnectStarted: AsyncEvent<WebsocketConnectionStartEvent>
		/** Proxy connected incoming client connection to server */
		onWebsocketConnected: AsyncEvent<WebsocketConnectionCompletedEvent>
		/** Proxy detected disconnect of one of the parties */
		onWebsocketDisconnected: AsyncEvent<WebsocketDisconnectEvent>
		/** Proxy got message from one of the parties */
		onWebsocketMessage: AsyncEvent<WebsocketMessageEvent>
	}

	/** Common parts of project definition. */
	export interface BaseProjectParams {
		/** Name of project */
		readonly name: string

		/** Working directory of the project.
		 * Determines where project-related shell commands are launched, and project itself, if it is launchable.
		 * If not specified, defaults to path to project config file, or tool instance working directory. */
		readonly workingDirectory?: string
	}

	export interface LaunchableProjectParams extends BaseProjectParams {
		/** How to launch the project - path to an executable and its arguments.
		 * If not passed, project should not be launched. This makes sense in case of Imploder projects that only need running Imploder instance. */
		getLaunchCommand(): PromiseOrValue<ReadonlyArray<string>>

		/** Description of graceful way of process shutdown.
		 * Default is "send SIGINT, wait 60 seconds, send SIGKILL"
		 * Process shutdown occurs on tool termination, and on process-specific conditions. */
		readonly shutdownSequence?: RoArrayOrSingle<ShutdownSequenceItem>

		// stdio options. sometimes could help fight performance issues if stdout/stderr is big and useless
		// passing false here will drop all input to onStderr/onStdout completely, as well as input to logger
		readonly dropStdout?: boolean
		readonly dropStderr?: boolean
	}

	export interface HttpProxifyableProjectParams extends LaunchableProjectParams {
		/** Set the TCP port the tool will listen for incoming requests on.
		 * Proxifying HTTP requests in development is the way to achieve advanced control over projects
		 * (lazy-start of project/compiler, intercepting and triggering on http requests to project, and more) */
		readonly proxyHttpPort: number

		/** Connect and read timeout for proxy. Milliseconds. Default is 180000 */
		readonly proxyTimeout?: number
	}

	export interface ImploderProjectParams extends BaseProjectParams {
		/** Path to tsconfig.json of Imploder project */
		readonly imploderTsconfigPath: string

		/** Name of Imploder profile. Profiles are specified in tsconfig.json
		 * This profile will be used when tool is trying to be built.
		 * Tool will launch Imploder on release build (expects single-time build)
		 * and before process start/restart (expects watch mode) */
		readonly imploderProfile?: string
	}

	export interface Logger {
		logTool(message: string, error?: unknown): void
		logStderr(message: string): void
		logStdout(message: string): void
	}

	export type LoggingLineSource = "stdout" | "stderr" | "tool"

	export interface LoggingLineOptions {
		/** Where does this message comes from - from stdio of the project, or from the tool itself? */
		readonly source: LoggingLineSource
		readonly project: BaseProject | null
		/** White-padded project name to make outputs more beautiful */
		readonly paddedProjectName: string
		/** Longest name length among active projects */
		readonly maxNameLength: number
		readonly message: string
		readonly timeStr: string
		readonly dateStr: string
	}

	export type RoArrayOrSingle<T> = ReadonlyArray<T> | T
	export type PromiseOrValue<T> = Promise<T> | T

	export interface BuildResult<T = ImploderProject> {
		success: boolean
		project: T
	}

	export interface HttpRequest {
		method: string
		url: string
		headers: Http.IncomingHttpHeaders
		getBody(): Promise<Buffer>
	}

	export interface WebsocketConnectionStartEvent {
		clientConnection: Ws
		request: Http.IncomingMessage
	}

	export interface WebsocketConnectionCompletedEvent {
		serverConnection: Ws
		clientConnection: Ws
		request: Http.IncomingMessage
	}

	export interface WebsocketDisconnectEvent {
		from: "client" | "server"
		error: Error | null
		code: number
		description: string
	}

	export interface WebsocketMessageEvent {
		data: Ws.Data
		from: "client" | "server"
	}

	/** A single action in shutdown sequence */
	export type ShutdownSequenceItem = SignalShutdownSequenceItem | WaitShutdownSequenceItem

	/** Action "send system signal to a process" */
	export interface SignalShutdownSequenceItem {
		signal: NodeJS.Signals
	}

	/** Action "wait" */
	export interface WaitShutdownSequenceItem {
		/** How long to wait in milliseconds */
		wait: number
	}

	export interface ProcessStopEvent {
		code: number | null
		signal: NodeJS.Signals | null
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
		runProcess(opts: StartProgramOptions): Promise<ProcessRunResult>
		runProcessExpectAnyCode(opts: StartProgramOptions): Promise<ProcessRunResult>
	}

	export interface ProcessRunResult {
		signal: NodeJS.Signals | null
		exitCode: number | null
	}

	export interface ShellCommandRunResult extends ProcessRunResult {
		stdout: string
		stderr: string
	}

	export interface StartProgramOptions {
		command: ReadonlyArray<string>
		onStdout?: ((line: string) => void) | undefined
		onStderr?: ((line: string) => void) | undefined
		onExit?(code: number | null, signal: NodeJS.Signals | null): void
	}

	export type ProcessRunState = "stopped" | "starting" | "running" | "stopping"

	/** Wrapper around some program that could be started and stopped */
	export interface ProcessController {
		readonly process: ChildProcess.ChildProcess | null
		readonly state: ProcessRunState
	}

	/** An event that allows for asynchronous listeners
	 * This implies that entity that fires the event will wait for all the listeners to complete */
	export interface AsyncEvent<T = void> {
		readonly listenersCount: number

		(handler: (value: T) => PromiseOrValue<unknown>): void
		once(handler: (value: T) => PromiseOrValue<unknown>): void
		detach(handler: (value: T) => PromiseOrValue<unknown>): void
		wait(): Promise<T>
	}

	export interface ProjectStartResult {
		/** Type of start result outcome.
		 * started = launched successfully, running
		 * already_running = was already running at the time of invocation, no action was performed
		 * invalid_state = process could not be launched from current project state (could not compile, for instance) */
		readonly type: "started" | "already_running" | "invalid_state"
	}

}