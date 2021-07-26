import {Imploder} from "@nartallax/imploder";
import {AsyncEvent, makeAsyncEvent} from "async_event";
import {BaseProjectInternal} from "base_project";
import {isLaunchableProject} from "launchable_project";
import {Koramund} from "types";

export interface ImploderProjectInternal extends Koramund.ImploderProject {
	onBuildFinished: AsyncEvent<Koramund.BuildResult>
}

export function createImploderProject<P extends Koramund.ImploderProjectParams>(base: BaseProjectInternal<P>): BaseProjectInternal<P> & ImploderProjectInternal {

	let _imploder: Promise<Imploder.Context> | Imploder.Context | null = null;

	let proj: BaseProjectInternal<P> & ImploderProjectInternal = {
		...base,

		onBuildFinished: makeAsyncEvent<Koramund.BuildResult>(),

		get imploder(): Imploder.Context | null {
			return !_imploder || _imploder instanceof Promise? null: _imploder;
		},

		async startImploder(): Promise<Imploder.Context> {
			if(_imploder === null){
				this.logger.logTool("Launching Imploder.");
				_imploder = Imploder.runFromTsconfig(this.params.tsconfigPath, {
					profile: this.params.profile,
					writeLogLine: str => this.logger.logTool(str)
				});
			}
	
			if(_imploder instanceof Promise){
				_imploder = await _imploder;
			}
	
			return _imploder;
		},

		async build(buildType: Koramund.BuildType = "release"): Promise<Koramund.BuildResult>{
			let imploder = await this.startImploder();
			await imploder.compiler.waitBuildEnd();
			if(!imploder.compiler.lastBuildWasSuccessful){
				let result: Koramund.BuildResult = {success: false, type: buildType, project: this};
				await this.onBuildFinished.fire(result)
				return result;
			}
			await imploder.bundler.produceBundle();
			let result: Koramund.BuildResult = {success: true, type: buildType, project: this};
			await this.onBuildFinished.fire(result)
			return result;
		}

	}

	if(isLaunchableProject(proj)){
		proj.process.onBeforeStart(() => proj.build());
		proj.onShutdown(async () => {
			let imploder = proj.imploder;
			if(imploder){
				await Promise.resolve(imploder.compiler.stop());
			}
		})
	}

	return proj;

}

export function isImploderProject<P extends Koramund.BaseProjectParams>(project: BaseProjectInternal<P>): project is BaseProjectInternal<P> & ImploderProjectInternal {
	return !!(project as BaseProjectInternal<P> & ImploderProjectInternal).onBuildFinished
}

export function isImploderProjectParams(params: Koramund.BaseProjectParams): params is Koramund.ImploderProjectParams {
	return typeof((params as Koramund.ImploderProjectParams).tsconfigPath) === "string";
}