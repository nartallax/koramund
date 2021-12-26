import {Imploder} from "@nartallax/imploder"
import {AsyncEvent, makeAsyncEvent} from "async_event"
import {BaseProjectInternal} from "base_project"
import {isLaunchableProject} from "launchable_project"
import {Koramund} from "koramund"
import {ProjectController} from "project_controller"
import * as Path from "path"
import * as ChildProcess from "child_process"

export interface ImploderProjectInternal extends Koramund.ImploderProject {
	onBuildFinished: AsyncEvent<Koramund.BuildResult>
}

export function createImploderProject<P extends Koramund.ImploderProjectParams>(base: BaseProjectInternal<P>, projCon: ProjectController): BaseProjectInternal<P> & ImploderProjectInternal {

	let config = Imploder.parseConfigSync(base.params.imploderTsconfigPath, {
		profile: base.params.imploderProfile
	})

	let externalInstance: Promise<Imploder.ExternalInstance> | null = null

	// тут может быть некоторая проблема с тем, что иногда externalInstance существует, а имплодер - нет
	// например, вследствие того, что имплодер упал, и мы не пытаемся его поднять
	// если будет реалистичный сценарий, когда такое может произойти - надо будет написать тест и зафиксить
	// но пока не вижу смысла
	function getExternalInstance(): Promise<Imploder.ExternalInstance> {
		if(!externalInstance){
			externalInstance = startExternalInstance()
		}

		return externalInstance
	}

	async function startExternalInstance(): Promise<Imploder.ExternalInstance> {
		let started = makeAsyncEvent()
		let imploderProcess = await startImploder(line => {
			let notification: Imploder.StdoutNotification = JSON.parse(line)
			if(notification.type === "started"){
				started.fire()
			}
		})

		let startResult = await Promise.race([
			base.shell.waitExitAnyCode(imploderProcess),
			started.wait()
		])

		if(startResult !== undefined){
			throw new Error("Imploder exits before complete start.")
		}

		return Imploder.externalInstance(config)
	}

	let hasRunningImploder = false
	let imploderStopped = makeAsyncEvent()
	let isShuttingDown = false
	let imploderProcess = null as null | ChildProcess.ChildProcess
	async function startImploder(onStdout?: (line: string) => void): Promise<ChildProcess.ChildProcess> {
		if(hasRunningImploder){
			base.logger.logTool("Already has running Imploder instance; waiting for it to shutdown.")
			while(hasRunningImploder){
				await imploderStopped.wait()
			}
		}
		if(isShuttingDown){
			throw new Error("Imploder won't be launched: shutdown requested.")
		}
		hasRunningImploder = true
		base.logger.logDebug("Launching Imploder.")

		let imploderBinPath = projCon.nodeEnv.getPathToNpmPackageExecutable("imploder")
		let launchCommand = [imploderBinPath, "--tsconfig", Path.resolve(base.params.imploderTsconfigPath), "--plain-logs", "--stdout-notifications"]
		if(base.params.imploderProfile !== undefined){
			launchCommand.push("--profile", base.params.imploderProfile)
		}
		if(base.params.imploderIdleTimeout !== undefined){
			launchCommand.push("--idle-timeout", base.params.imploderIdleTimeout + "")
		}

		imploderProcess = await base.shell.startProcess({
			command: launchCommand,
			onExit: () => {
				hasRunningImploder = false
				imploderProcess = null
				imploderStopped.fire()
			},
			onStdout,
			onStderr: line => base.logger.logTool(line)
		})
		return imploderProcess
	}

	let proj: BaseProjectInternal<P> & ImploderProjectInternal = {
		...base,

		onBuildFinished: makeAsyncEvent<Koramund.BuildResult>(),

		imploderConfig: config,
		get imploderStartedInWatchMode(): boolean {
			return !!config.watchMode && !!imploderProcess
		},

		async startImploderInWatchMode(): Promise<void> {
			if(!config.watchMode){
				throw new Error("Cannot start Imploder in watch mode: current profile has no watchMode enabled.")
			}
			await getExternalInstance()
		},

		async build(): Promise<Koramund.BuildResult> {
			let success = false

			if(config.watchMode){
				let externalInstance = await getExternalInstance()
				try {
					await externalInstance.assembleBundleSilent()
					success = true
				} catch(e){
					// nothing here
					// logs are already captured from stderr of the process
					// also there is nothing meaningful in the error
				}
			} else {
				let process = await startImploder()
				let {code} = await base.shell.waitExitAnyCode(process)
				success = code === 0
			}


			let result: Koramund.BuildResult = {success, project: this}
			await this.onBuildFinished.fire(result)
			return result
		}

	}

	proj.onShutdown(async() => {
		isShuttingDown = true
		if(imploderProcess){
			base.logger.logDebug("Stopping Imploder.")
			imploderProcess.kill("SIGINT")
		}
	})

	if(isLaunchableProject(proj)){
		proj.process.onBeforeStart(async() => {
			let res = await proj.build()
			if(!res.success){
				throw new Error("Build is not successful.")
			}
		})
	}

	return proj

}

export function isImploderProject<P extends Koramund.BaseProjectParams>(project: BaseProjectInternal<P>): project is BaseProjectInternal<P> & ImploderProjectInternal {
	return !!(project as BaseProjectInternal<P> & ImploderProjectInternal).onBuildFinished
}

export function isImploderProjectParams(params: Koramund.BaseProjectParams): params is Koramund.ImploderProjectParams {
	return typeof((params as Koramund.ImploderProjectParams).imploderTsconfigPath) === "string"
}