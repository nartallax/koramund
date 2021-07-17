import {ProjectDefinition} from "types";
import {ExternalProgram} from "external_program";
import {ImploderProject} from "imploder_project";
import {InputProcessor} from "input_processor";
import {Logger} from "logger";
import {Project} from "project";
import {isExternalProgramDefinition, isImploderProjectDef} from "utils";
import {assembleConfig, FullToolConfig} from "config";

export class Koramund {

	projects: ReadonlyArray<Project> | null = null;
	inputProcessor: InputProcessor | null = null;

	readonly logger: Logger = new Logger({
		...((this.cfg.defaultProjectSettings || {}).logging || {}),
		projectName: ""
	});

	get startedForDevelopment(): boolean {
		return !!this.inputProcessor;
	}

	constructor(private readonly cfg: FullToolConfig){}

	run(): Promise<void>{
		switch(this.cfg.mode){
			case "development": return this.runDevelopment();
			case "build": return this.runBuild();
			case "build-all": return this.runBuildAll();
			default: throw new Error("Unknown mode: " + this.cfg.mode);
		}
	}

	async gracefulStop(signal?: NodeJS.Signals): Promise<void> {
		await Promise.all((this.projects || []).map(async x => {
			try {
				await x.beforeShutdown(signal)
			} catch(e){
				x.logger.logTool("Failed to shutdown gracefully: "+ e.message);
			}
		}));
	}
	
	async immediateStop(): Promise<void> {
		for(let project of this.projects || []){
			if(project.process){
				project.process.stopImmediatelyAndRough();
			}
		}
	}

	private async runDevelopment(): Promise<void>{
		let projects = this.createProjects(false);
		let inputProcessor = this.inputProcessor = new InputProcessor();

		inputProcessor.preRegisterProjects(projects);
		await this.forEachProject(projects, "wireup", proj => inputProcessor.registerProject(proj));
		await this.forEachProject(projects, "prepare", proj => proj.prepareForDevelopment());
		await this.forEachProject(projects, "initial launch", proj => proj.onInitialLaunch());

		let isFirstStop = true;
		process.on("SIGINT", async signal => {
			try {
				if(isFirstStop){
					isFirstStop = false;
					this.logger.logTool(`${signal}: shutting down.`);
					this.gracefulStop(signal);
					process.exit(0);
				} else {
					this.immediateStop();
					this.logger.logTool(`${signal}: second shutdown signal, stopping immediately.`);
					process.exit(0);
				}
			} catch(e){
				this.logger.logTool(`Error processing ${signal}. Stopping immediately. Error is ${e.message}`);
			}			
		});

		process.on("exit", () => {
			this.immediateStop();
		});

		this.logger.logTool("Initialized.");
	}

	private async runBuild(): Promise<void>{
		let allProjects = this.createProjects(true);
		let project = allProjects.find(x => x.name === this.cfg.project);

		if(!project){
			throw new Error(`Could not build project "${this.cfg.project}": no such project is defined.`);
		}

		if(!(project instanceof ImploderProject)){
			throw new Error(`Could not build project "${this.cfg.project}": this project is not Imploder project and therefore is not buildable.`);
		}

		await this.buildProject(project)
	}

	private async runBuildAll(): Promise<void> {
		let allProjects = this.createProjects(true);
		let buildableProjects = allProjects.filter(x => x instanceof ImploderProject) as ImploderProject[]
		await this.forEachProject(buildableProjects, "build", project => this.buildProject(project));
	}

	private async buildProject(project: ImploderProject): Promise<void> {
		let success = await project.build();
		if(!success){
			throw new Error(`Failed to build project "${this.cfg.project}".`);
		}
		await project.doPostBuildActions();
	}

	private createProjects(isSingleTimeBuild: boolean): ReadonlyArray<Project> {
		this.projects = this.cfg.projects.map(def => this.createProject(def, isSingleTimeBuild));
		let maxLen = this.projects.map(x => x.name.length).reduce((a, b) => Math.max(a, b), 0);
		this.projects.forEach(proj => proj.logger.setNameLength(maxLen));
		this.logger.setNameLength(maxLen);
		return this.projects;
	}

	private createProject(def: ProjectDefinition, isSingleBuild: boolean): Project {
		if(isImploderProjectDef(def)){
			return new ImploderProject(def, isSingleBuild);
		} else if(isExternalProgramDefinition(def)){
			return new ExternalProgram(def);
		} else {
			throw new Error("Bad def: " + JSON.stringify(def)); // should be already handled at this time actually
		}
	}

	private async forEachProject<T extends Project>(projects: ReadonlyArray<T>, stepName: string, action: (project: T) => void | Promise<void>): Promise<void>{
		let hadErrors = false;
		for(let proj of projects){
			try {
				await Promise.resolve(action(proj));
			} catch(e){
				hadErrors = true;
				this.logger.logTool(`Project ${(proj.def.name || "").trim()} failed to ${stepName}: ${e.message || e.stack || e}`)
			}
		}
		if(hadErrors){
			throw new Error(`Failed to ${stepName}: there were errors.`);
		}
	}

	static async start(args?: ReadonlyArray<string>): Promise<Koramund>{
		let cfg = await assembleConfig(args);
		let tool = new Koramund(cfg);
		await tool.run();
		return tool;
	}
}

export async function main(): Promise<void | never> {
	try {
		await Koramund.start();
	} catch(e){
		console.error(e.message);
		process.exit(1);
	}
}