import {Koramund} from "tool_main";
import * as path from "path";
import {promises as fs} from "fs";
import {ProcessState} from "process_controller";
import {copyRecursive, rmRfIgnoreEnoent} from "tests/test_utils";
import {Project} from "project";
import {ImploderProject} from "imploder_project";

const testProjectsDirectory = "./test_projects_temp_dir_for_tests"

export class TestToolInstance {
	constructor(readonly tool: Koramund){}

	private static async copyProjectsIntoTestTmp(){
		await rmRfIgnoreEnoent(testProjectsDirectory)
		await copyRecursive("./ts/tests", testProjectsDirectory);
		await copyRecursive("./test_projects", testProjectsDirectory);
	}

	static async start<T>(args: ReadonlyArray<string>, doWithTool: (tool: TestToolInstance) => Promise<T>): Promise<T>{
		let wrap: TestToolInstance | null = null;
		try {
			await this.copyProjectsIntoTestTmp();
			let tool = await Koramund.start(args);
			wrap = new TestToolInstance(tool);
			return await doWithTool(wrap);
		} finally {
			if(wrap && wrap.tool.startedForDevelopment){
				await wrap.tool.gracefulStop();
			}
			await rmRfIgnoreEnoent(testProjectsDirectory);
		}
	}

	static startDev<T>(conf: string, doWithTool: (tool: TestToolInstance) => Promise<T>): Promise<T>{
		return this.start(["--config", path.resolve(testProjectsDirectory, conf + ".json"), "--mode", "development"], doWithTool);
	}

	static runBuildAll<T>(conf: string, doWithTool: (tool: TestToolInstance) => Promise<T>): Promise<T>{
		return this.start(["--config", path.resolve(testProjectsDirectory, conf + ".json"), "--mode", "build-all"], doWithTool);
	}

	async writeFile(relPath: string, content: string): Promise<void>{
		await fs.writeFile(path.resolve(testProjectsDirectory, relPath), content);
	}

	getProject(name: string): Project {
		let proj = (this.tool.projects || []).find(x => x.name === name);
		if(!proj){
			throw new Error("No project named " + name + " found.");
		}
		return proj
	}

	getImploderProject(name: string): ImploderProject {
		let proj = this.getProject(name);
		if(!(proj instanceof ImploderProject)){
			throw new Error(`Expected project ${name} to be imploder project, but it's not.`);
		}
		return proj
	}

	checkProjectRunningState(name: string, ...states: ProcessState[]): void {
		let proj = this.getProject(name);
		if(!proj.process){
			throw new Error(`Project named ${name} is not startable.`);
		}
		if(!new Set(states).has(proj.process.state)){
			throw new Error(`Project named ${name} is in wrong running state: ${proj.process.state} (but should be in ${states.join(" or ")})`);
		}
	}

	checkProjectImploderState(name: string, isRunning: boolean): void {
		let proj = this.getImploderProject(name);
		if(proj.isImploderRunning() !== isRunning){
			throw new Error(`Project named ${name} Imploder running status (${proj.isImploderRunning()}) is not equals to expected (${isRunning}).`);
		}
	}
}