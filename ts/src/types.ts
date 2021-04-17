/** Contents of config file */
export interface ToolConfig {
	/** Definitions of the projects that are managed by the tool
	 * Note that projects are started sequentally in this order (if launch is not delayed). */
	projects: ProjectDefinition[];
	/** "base" project. You can put some default values here and override them in project definitions. */
	defaultProjectSettings?: Partial<ProjectDefinition>;
}

/** Definition of a single project.
 * Using this definition, the tool could run compiler, launch the project and parse its outputs. */
export type ProjectDefinition = ImploderProjectDefinition | ExternalProgramDefinition;

/** Common parts of project definition. */
export interface CommonProjectDefinition {
	/** How to launch the project - a program and its arguments.
	 * If not passed, project should not be launched. Makes sense in case of Imploder projects that only need running Imploder instance.
	 * Placeholders could be used here. General syntax of placeholder is ${variableName}
	 * Available variables:
	 * bundle - path to Imploder bundle
	 * node - same nodejs path as used to launch the tool
	 * So command could look like this:
	 * ["${node}" "${bundle}" "--this-is-debug-launch" "--config" "./config.cfg"] */
	launchCommand?: string[];

	/** A way for the tool to know when the project is launched and ready to work.
	 * Should be supplied if launchCommand is present, otherwise project is never considered launched. */
	launchCompletedCondition?: RoArrayOrSingle<LaunchCompletedCondition>;

	/** Directory to launch program in.
	 * Relative paths are resolved starting at config file location.
	 * If not specified, path to project config file, or this config directory is used. */
	workingDirectory?: string;

	/** Name of program. Will be used in logs.
	 * If not specified, name of workingDirectory will be used. */
	name?: string;

	/** Options about project outputs and logging */
	logging?: LoggingOptions;

	/** Description of graceful way of process shutdown.
	 * Default is "send SIGINT, wait 60 seconds, send SIGKILL"
	 * Process shutdown occurs on tool termination, and on process-specific conditions. */
	shutdownSequence?: RoArrayOrSingle<ShutdownSequenceItem>;
}

/** Some external program which is just need to be running.
 * We could not smart-control it, so it just will be running at the start of tool without any other assumptions. */
export interface ExternalProgramDefinition extends CommonProjectDefinition {
	/** What to do on program shutdown.
	 * Default option is "restart". */
	onShutdown?: OnShutdownActionName;
}

/** An Imploder project.
 * Imploder instance will be launched, and project code will be launched and restarted according to conditions. */
export interface ImploderProjectDefinition extends CommonProjectDefinition {

	/** Path to tsconfig.json of Imploder project.
	 * Relative paths are resolved starting at config file location. */
	imploderProject: string;

	/** On what TCP port the project binds when run?
	 * Expecting for project to listen for HTTP requests on this port.
	 * It is highly recommended to bind on random port and parse this port's number from stdin/stderr.
	 * This way you can have same ports in development and in production: 
	 * in development requests will be proxified by the tool, and in production they will be handled by project directly. */
	projectHttpPort?: HttpPortAcquringMethod;

	/** On what TCP port should the tool proxy-listed for HTTP requests to project? */
	proxyHttpPort?: number | ShellCommand | JsonDataPath;
	
	/** Connect and read timeout for proxy. Milliseconds. Default is 180000 */
	proxyTimeout?: number;

	/** When the project should be launched for the first time after the tool is started? 
	 * Note that this option also affects start of Imploder instance for this project
	 * Default: if project have launchCommand, it will be launched on firstRequest, otherwise on toolStart.
	 * Logic here is that we want the tool to start as fast as possible, so default is lazy-loading firstRequest,
	 * but there are purely frontend project who need to have just Imploder instance and nothing more,
	 * and if we default just to firstRequest, it will never be launched. */
	initialLaunchOn?: "toolStart" | "firstRequest";

	/** A way for the tool to know when exactly project should be restarted
	 * On restart project is also rebuilt. */
	restartCondition?: RoArrayOrSingle<RestartCondition>;

	/** Name of Imploder profile, specified in tsconfig.json
	 * This profile will be used when tool is running in development mode.
	 * The tool expects Imploder to run in watch mode when launched with this profile. */
	imploderDevelopmentProfileName?: string;

	/** Name of Imploder profile, specified in tsconfig.json
	 * This profile will be used when tool is running to single-time build this project.
	 * Production settings expected, ie no watch mode, minification and so on */
	imploderBuildProfileName?: string;

	/** Some actions that should take place after successful build. */
	postBuildActions?: RoArrayOrSingle<ShellCommand | ProgramLaunchCommand>;
}

/** How a project outputs should be processed */
export interface LoggingOptions {
	/** Shoud pass stdout of project into tool logs? Default true. */
	showStdout?: boolean;
	/** Shoud pass stderr of project into tool logs? Default true. */
	showStderr?: boolean;
	/** Shoud show logs of the tool itself related to the project? Default true. */
	showToolLogs?: boolean;
	/** Format-string of tool log output related to the project.
	 * Default is "{projectName} | {date} {time} | {message}" */
	format?: string;
	/** if specified, this regexp will be applied to each line of stdout/stderr output of process to extract valuable part of it to present.
	 * First captured group will be taken. */
	outputExtractionRegexp?: string;
}

/** A way to acquire TCP port.
 * number - just the port number.
 * ShellCommand - some command that will output port number in stdout when launched.
 * The command will be executed once on tool start.
 * StdioParsingRegexp - if project outputs port into stdout/stderr, this is the way to extract the port. 
 * First regexp group is expected to contain the port value. */
export type HttpPortAcquringMethod = number | ShellCommand | StdioParsingRegexp | JsonDataPath;

/** A way to wait for project to launch.
 * number - wait this number of milliseconds after launch. Not recommended.
 * StdioParsingRegexp - wait for specific line in stderr/stdout. If regexp matched - project is started. */
export type LaunchCompletedCondition = number | StdioParsingRegexp | ProjectEventReference;

/** Condition that defines event on which project should be restarted.
 * The project is restarted if regexp matches on stderr/stdout line or proxy url. */
export type RestartCondition = StdioParsingRegexp | ProxyUrlRegexp | ProjectEventReference;

export interface ProxyUrlRegexp {
	proxyUrlRegexp: string;
	/** Way of filtering the requests urls of which will be used. Expecting POST/GET/PUT etc.
	 * If not specified, every request will be used regardless of method. */
	method?: string;
	/** Way of adding condition to another project http requests
	 * For instance, if you want to restart backend each time main page of frontend is refreshed. */
	projectName?: string;
}

/** A shell command.
 * Note that output of the command will be buffered and therefore won't be visible until execution is completed.
 * Do not use it if output will be huge. */
export interface ShellCommand {
	shell: string;
}

/** Path to some data inside some JSON file. */
export interface JsonDataPath {
	jsonFilePath: string;
	keys: RoArrayOrSingle<string | number>;
}

/** An instruction how to launch a program with some command-line arguments.
 * Output of the program will be displayed "live", if it is appropriate. */
export interface ProgramLaunchCommand {
	/** Template arguments are also present here, see CommonProjectDefinition.launchCommand */
	programLaunch: string[];
}

export interface StdioParsingRegexp {
	stdioParsingRegexp: string;
	/** Search in stderr instead of default stdout */
	stderr?: boolean;
	/** Way of adding condition to another project stdio output */
	projectName?: string;
}

export type RoArrayOrSingle<T> = T | ReadonlyArray<T>;

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

export type OnShutdownActionName = "restart" | "nothing";

export interface ProjectEventReference {
	/** "restart" is invoked when other project restartCondition is met
	 * "launchCompleted" is invoked when other project launchCompletedCondition is met */
	eventType: "restart" | "launchCompleted";
	projectName: string;
}