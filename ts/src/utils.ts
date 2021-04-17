import {RoArrayOrSingle, ExternalProgramDefinition, ImploderProjectDefinition, ProjectDefinition, StdioParsingRegexp, ShutdownSequenceItem, SignalShutdownSequenceItem, WaitShutdownSequenceItem, ProxyUrlRegexp, ShellCommand, ProgramLaunchCommand, ProjectEventReference, JsonDataPath} from "types";

export function errorAndExit(msg: string): never {
	console.error(msg);
	process.exit(1);
}

export function isImploderProjectDef(def: ProjectDefinition): def is ImploderProjectDefinition {
	return !!(def as ImploderProjectDefinition).imploderProject;
}

export function isExternalProgramDefinition(def: ProjectDefinition): def is ExternalProgramDefinition {
	return !(def as ImploderProjectDefinition).imploderProject; // ewww
}

export function isStdioParsingRegexp(x: unknown): x is StdioParsingRegexp {
	return typeof(x) === "object" && !!x && !!(x as StdioParsingRegexp).stdioParsingRegexp
}

export function isProxyUrlRegexp(x: unknown): x is ProxyUrlRegexp {
	return typeof(x) === "object" && !!x && !!(x as ProxyUrlRegexp).proxyUrlRegexp
}

export function arrayOfMaybeArray<T>(x?: RoArrayOrSingle<T>): ReadonlyArray<T> {
	return x === undefined? [] as ReadonlyArray<T>: Array.isArray(x)? x as ReadonlyArray<T>: [x as T];
}

export function isSignalShutdownSequenceItem(item: ShutdownSequenceItem): item is SignalShutdownSequenceItem {
	return !!(item as SignalShutdownSequenceItem).signal;
}

export function isWaitShutdownSequenceItem(item: ShutdownSequenceItem): item is WaitShutdownSequenceItem {
	return typeof((item as WaitShutdownSequenceItem).wait) === "number";
}

export function isShellCommand(x: unknown): x is ShellCommand {
	return typeof(x) === "object" && !!x && !!(x as ShellCommand).shell
}

export function isProgramLaunchCommand(x: unknown): x is ProgramLaunchCommand {
	return typeof(x) === "object" && !!x && !!(x as ProgramLaunchCommand).programLaunch;
}

export function isProjectEventReference(x: unknown): x is ProjectEventReference {
	return typeof(x) === "object" && !!x && !!(x as ProjectEventReference).eventType;
}

// just to check that k is keyof T
export function nameOf<T>(k: keyof T & string): keyof T & string {
	return k;
}

export function isJsonDataPath(x: unknown): x is JsonDataPath {
	return typeof(x) === "object" && !!x && !!(x as JsonDataPath).jsonFilePath
}