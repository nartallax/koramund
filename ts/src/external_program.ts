import {ExternalProgramDefinition, OnShutdownActionName} from "types";
import {Project} from "project";

/** Some external program/project that we make almost no assumptions about. */
export class ExternalProgram extends Project<ExternalProgramDefinition>{
	
	async onInitialLaunch(): Promise<void> {
		await this.restart();
	}

	protected getActionOnUnexpectedShutdown(): OnShutdownActionName {
		return this.def.onShutdown || "restart";
	}

}
