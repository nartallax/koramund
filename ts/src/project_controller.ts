import {CommonProject} from "common_project";
import {ImploderProject} from "imploder_project";
import {Koramund} from "types";

export class ProjectController implements Koramund.ProjectController {
	
	private projects: CommonProject[] = [];

	constructor(private readonly opts: Koramund.ProjectControllerOptions){
		if(!opts.preventSignalHandling){
			this.setupSignalHandling();
		}

		this.setupProcessExitNotice();
	}

	private setupProcessExitNotice(){
		let origExit = process.exit;
		process.exit = (code?: number): never => {
			let runningProjects = this.projects
				.filter(project => project.process?.state !== "stopped");
			if(runningProjects.length > 0){
				let names = runningProjects.map(p => p.name).join(", ");
				console.error("You really should NOT call process.exit() like this!\nThere could be processes still running (of project(s) " + names + "), which won't stop on their own. You now should stop them manually.\nBetter use shutdown() method of process controller, which will gracefully shut down all the processes. If it does not work - tweak your shutdown sequences.");
			}
			origExit.call(process, code);
			throw new Error(`process.exit(${code}) did not shut down the process!`);
		}
	}

	private setupSignalHandling(): void {
		process.on("SIGINT", async signal => {
			await this.shutdown(signal);
		});

		process.on("exit", () => {
			// it won't really do much
			this.shutdown();
		});
	}

	addImploderProject(params: Koramund.ImploderProjectParams): Koramund.ImploderProject {
		let prog = new ImploderProject({
			...params,
			log: this.opts.log
		});
		this.projects.push(prog);
		return prog;
	}

	addExternalProject<T extends Koramund.CommonProjectParams>(params: T): Koramund.CommonProject<T> {
		let prog = new CommonProject({
			...params,
			log: this.opts.log
		})
		this.projects.push(prog);
		return prog;
	}

	get nodePath(): string {
		return process.argv[0];
	}

	async buildAll(buildType?: Koramund.BuildType): Promise<Koramund.BuildResult[]>{
		let result: Koramund.BuildResult[] = [];
		for(let project of this.projects){
			if(!(project instanceof ImploderProject)){
				continue;
			}

			result.push(await project.build(buildType));
		}
		return result;
	}

	async shutdown(signal?: NodeJS.Signals): Promise<void> {
		await Promise.all(this.projects.map(async project => {
			try {
				await project.shutdown(signal)
			} catch(e){
				project.logger.logTool("Failed to shutdown gracefully: "+ e.message);
			}
		}));
	}

}