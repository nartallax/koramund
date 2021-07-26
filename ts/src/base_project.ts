import {Logger} from "logger";
import {ShellRunner} from "shell_runner";
import {Koramund} from "types";

export interface BaseProjectInternal<P extends Koramund.BaseProjectParams = Koramund.BaseProjectParams> extends Koramund.BaseProject<P> {
	logger: Logger;
	shell: ShellRunner
}

export function createBaseProject<P extends Koramund.BaseProjectParams>(params: P, controllerParams: Koramund.ProjectControllerOptions): BaseProjectInternal<P> {

	let workingDirectory = params.workingDirectory || ".";

	let logger = new Logger({
		log: controllerParams.log,
		getProject(){ return proj }
	})

	let proj: BaseProjectInternal<P> = {
		name: params.name,
		params: params,
		shell: new ShellRunner(workingDirectory, logger),
		logger: logger
	}

	return proj;
}