import {Imploder} from "@nartallax/imploder";
import {AsyncEvent, makeAsyncEvent} from "async_event";
import {BaseProjectInternal} from "base_project";
import {CallBuffer} from "call_buffer";
import {isLaunchableProject} from "launchable_project";
import {Koramund} from "koramund";

export interface ImploderProjectInternal extends Koramund.ImploderProject {
	onBuildFinished: AsyncEvent<Koramund.BuildResult>
}

export function createImploderProject<P extends Koramund.ImploderProjectParams>(base: BaseProjectInternal<P>): BaseProjectInternal<P> & ImploderProjectInternal {

	let imploderStorage = new CallBuffer<Imploder.Context>(async () => {
		base.logger.logTool("Launching Imploder.");
		let imploder = await Imploder.runFromTsconfig(base.params.imploderTsconfigPath, {
			profile: base.params.imploderProfile,
			writeLogLine: str => base.logger.logTool(str)
		});
		await imploder.compiler.waitBuildEnd()
		return imploder;
	});

	let proj: BaseProjectInternal<P> & ImploderProjectInternal = {
		...base,

		onBuildFinished: makeAsyncEvent<Koramund.BuildResult>(),

		getImploderOrNull(): Imploder.Context | null {
			return imploderStorage.getValueOrNull();
		},

		getImploder(): Imploder.Context {
			let result = this.getImploderOrNull();
			if(!result){
				throw new Error("Have no Imploder instance, but expected to.");
			}
			return result;
		},

		getOrStartImploder(): Promise<Imploder.Context> {
			return imploderStorage.get();
		},

		async build(): Promise<Koramund.BuildResult>{
			let imploderWasLaunched = imploderStorage.hasValue();
			let imploder = await imploderStorage.get();

			if(imploder.config.lazyStart && !imploder.compiler.isStarted){
				await imploder.compiler.run();
			} else if(imploderWasLaunched){
				if(!imploder.config.watchMode){
					await imploder.compiler.run();
				} else {
					await imploder.compiler.waitBuildEnd();
				}
			}

			if(!imploder.compiler.lastBuildWasSuccessful){
				let result: Koramund.BuildResult = {success: false, project: this};
				await this.onBuildFinished.fire(result)
				return result;
			}
			await imploder.bundler.produceBundle();
			let result: Koramund.BuildResult = {success: true, project: this};
			await this.onBuildFinished.fire(result)
			return result;
		}

	}

	proj.onShutdown(async () => {
		if(imploderStorage.hasValue()){
			base.logger.logDebug("Stopping Imploder.");
			await Promise.resolve(imploderStorage.getValue().stopEverything());
		}
	});

	if(isLaunchableProject(proj)){
		proj.process.onBeforeStart(async () => {
			let res = await proj.build()
			if(!res.success){
				throw new Error("Build is not successful.");
			}
		});
	}

	return proj;

}

export function isImploderProject<P extends Koramund.BaseProjectParams>(project: BaseProjectInternal<P>): project is BaseProjectInternal<P> & ImploderProjectInternal {
	return !!(project as BaseProjectInternal<P> & ImploderProjectInternal).onBuildFinished
}

export function isImploderProjectParams(params: Koramund.BaseProjectParams): params is Koramund.ImploderProjectParams {
	return typeof((params as Koramund.ImploderProjectParams).imploderTsconfigPath) === "string";
}