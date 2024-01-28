import {BaseProjectInternal, createBaseProject} from "base_project"
import {createHttpProxifyableProject, isHttpProxifyableProjectParams} from "http_proxifyable_project"
import {createImploderProject, isImploderProject, isImploderProjectParams} from "imploder_project"
import {createLaunchableProject, isLaunchableProject, isLaunchableProjectParams, LaunchableProjectInternal} from "launchable_project"
import {Koramund} from "koramund"
import * as Path from "path"
import {Logger} from "logger"

export class ProjectController implements Koramund.ProjectController {

	private projects: BaseProjectInternal<Koramund.BaseProjectParams>[] = []

	constructor(private readonly opts: Koramund.ProjectControllerOptions,
		readonly logger: Logger,
		readonly nodeEnv: Koramund.NodeEnvironmentController) {

		if(!opts.preventSignalHandling){
			this.setupSignalHandling()
		}

		this.setupProcessExitNotice()
	}

	private setupProcessExitNotice() {
		let origExit = process.exit
		process.exit = (code?: number): never => {
			let launchableProjects = this.projects.filter(proj => isLaunchableProject(proj)) as
				(BaseProjectInternal & LaunchableProjectInternal)[]

			let runningProjects = launchableProjects.filter(proj => proj.process.state !== "stopped")
			if(runningProjects.length > 0){
				let names = runningProjects.map(p => p.name).join(", ")
				console.error("You really should NOT call process.exit() like this!\nThere could be processes still running (of project(s) " + names + "), which won't stop on their own. You now should stop them manually.\nBetter use shutdown() method of process controller, which will gracefully shut down all the processes. If it does not work - tweak your shutdown sequences.")
			}
			this.shutdown()
			origExit.call(process, code)
			throw new Error(`process.exit(${code}) did not shut down the process!`)
		}
	}

	private onExit = (signal?: NodeJS.Signals) => {
		this.logger.logDebug("Exiting (signal = " + signal + ")")
		this.shutdown(signal)
	}



	private setupSignalHandling(): void {
		process.on("SIGINT", this.onExit)
		// it won't really do much
		process.on("exit", this.onExit)
	}

	private clearSignalHandling(): void {
		process.off("SIGINT", this.onExit)
		process.off("exit", this.onExit)
	}

	async buildAll(): Promise<Koramund.BuildResult[]> {
		let result: Koramund.BuildResult[] = []
		for(let project of this.projects){
			if(isImploderProject(project)){
				result.push(await project.build())
			}
		}
		return result
	}

	shutdownRough(): Promise<void> {
		this.logger.logDebug("Rough shutdown requested")
		return this.shutdownInternal(proj => {
			if(isLaunchableProject(proj)){
				proj.process.stopImmediatelyAndRough()
			}
			return proj.shutdown()
		})
	}

	shutdown(signal?: NodeJS.Signals): Promise<void> {
		this.logger.logDebug("Shutdown requested (signal = " + signal + ")")
		return this.shutdownInternal(proj => proj.shutdown(signal))
	}

	private async shutdownInternal(action: (proj: BaseProjectInternal) => Promise<void>): Promise<void> {
		this.logger.logDebug("Shutting down.")
		if(!this.opts.preventSignalHandling){
			this.clearSignalHandling()
		}
		await Promise.all(this.projects.map(async project => {
			try {
				project.logger.logDebug("Shutdown action requested.")
				await action(project)
				project.logger.logDebug("Shutdown action completed.")
			} catch(e){
				project.logger.logTool("Failed to shutdown gracefully: ", e)
			}
		}))
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any does not really go anywhere as function type is explicitly defined in interface
	addProject<P extends Koramund.BaseProjectParams>(params: P): any {
		if(isImploderProjectParams(params) && params.imploderTsconfigPath && !params.workingDirectory){
			params = {
				...params,
				workingDirectory: Path.dirname(params.imploderTsconfigPath)
			}
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- it will be any, or I will have to cast it manually every time, which is essentially the same
		let baseProject: any = createBaseProject(params, this.opts)

		if(isLaunchableProjectParams(params)){
			baseProject = createLaunchableProject(baseProject)

			if(isHttpProxifyableProjectParams(params)){
				baseProject = createHttpProxifyableProject(baseProject)
			}
		}

		if(isImploderProjectParams(params)){
			baseProject = createImploderProject(baseProject)
		}

		this.projects.push(baseProject)

		this.updateLoggers()

		return baseProject
	}

	private updateLoggers() {
		let maxLength = 0
		this.projects.forEach(project => {
			maxLength = Math.max(maxLength, project.name.length)
		})

		this.projects.forEach(project => {
			project.logger.setNameLength(maxLength)
		})
		this.logger.setNameLength(maxLength)
	}

}