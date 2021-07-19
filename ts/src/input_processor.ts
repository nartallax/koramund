import {ImploderProjectDefinition, ProjectDefinition, ProjectEventReference, ProxyUrlRegexp, StdioParsingRegexp} from "types";
import {ImploderProject} from "imploder_project";
import {Project} from "project";
import {arrayOfMaybeArray, isJsonDataPath, isProjectEventReference, isProxyUrlRegexp, isShellCommand, isStdioParsingRegexp, nameOf} from "utils";
import {AsyncEvent} from "utils/async_event";

/** Class that processes all the inputs (stdio, http) and fires the events */
export class InputProcessor {

	private readonly projectMap: {[k: string]: Project | undefined } = {};
	readonly onLaunchCompleted = new AsyncEvent<string>();
	readonly onRestart = new AsyncEvent<string>();

	async preRegisterProjects(projects: ReadonlyArray<Project>): Promise<void>{
		projects.forEach(project => {
			let name = project.name;
			if(name in this.projectMap){
				throw new Error(`Duplicate project name: "${name}"`);
			}
			this.projectMap[name] = project;
		});
	}

	async registerProject(project: Project): Promise<void> {
		// order is important
		// we need to acquire http port first, and "allow" launch to be completed just after that
		// order of listeners is important
		// TODO: rewrite to priorities
		if(project instanceof ImploderProject){
			this.processRestartCondition(project);
			await this.processHttpPortConditions(project);
		}
		this.processLaunchCompletedCondition(project);
	}

	private async processHttpPortConditions(project: ImploderProject): Promise<void> {
		let logics = arrayOfMaybeArray(project.def.projectHttpPort);
		if(logics.length === 0 && project.onHttpRequest){
			throw new Error(`Project ${project.name} provides ${nameOf<ImploderProjectDefinition>("proxyHttpPort")}, but no ${nameOf<ImploderProjectDefinition>("projectHttpPort")}. That means proxy won't be able to send HTTP requests to project, as proxy does not know project's HTTP port; this is misconfiguration.`);
		} else if(logics.length !== 0 && !project.onHttpRequest){
			project.logger.logTool(`Project got ${nameOf<ImploderProjectDefinition>("projectHttpPort")}, but no ${nameOf<ImploderProjectDefinition>("proxyHttpPort")}. It is not strictly an error, just meaningless configuration. Also it means proxy won't be launched.`);
		}

		for(const logic of logics){
			if(typeof(logic) === "number"){
				project.onHttpPortAcquired(logic);
			} else if(isJsonDataPath(logic)){
				project.onHttpPortAcquired(await project.runJsonDataPathForNumber(logic));
			} else if(isShellCommand(logic)){
				project.onHttpPortAcquired(await project.runShellCommandToInt(logic.shell));
			} else if(isStdioParsingRegexp(logic)) {
				this.attachStdioListener(project, logic, (match, line) => {
					let firstGroup = match[1];
					if(!firstGroup){
						project.logger.logTool(`Failed to acquire HTTP port: regexp ${logic.stdioParsingRegexp} matched on line "${line}", but did not extracted first group. Expected first group to contain the port number.`);
					}

					let port = parseInt(firstGroup);
					if(Number.isNaN(port)){
						project.logger.logTool(`Failed to acquire HTTP port: regexp ${logic.stdioParsingRegexp} matched on line "${line}", and first group was "${firstGroup}"; could not parse port number out of it.`);
					}

					project.onHttpPortAcquired(port);
				})

			}
		}
	}

	private processRestartCondition(project: ImploderProject): void {
		let conds = arrayOfMaybeArray(project.def.restartCondition);
		if(conds.length === 0){
			return;
		}

		let doRestart = async () => {
			await project.restart();
			await this.onRestart.fire(project.name);
		}

		for(const cond of conds){
			if(isStdioParsingRegexp(cond)){
				this.attachStdioListener(project, cond, doRestart);
			} else if(isProxyUrlRegexp(cond)){
				this.attachProxyUrlListener(project, cond, doRestart);
			} else if(isProjectEventReference(cond)){
				this.attachProjectEventReference(cond, doRestart);
			} else {
				throw new Error(`Could not understand type of ${nameOf<ImploderProjectDefinition>("restartCondition")} of project ${project.name} (full condition is ${JSON.stringify(cond)}).`);
			}
		}
	}

	private processLaunchCompletedCondition(project: Project): void {
		const conds = arrayOfMaybeArray(project.def.launchCompletedCondition);
		if(conds.length === 0 && project.def.launchCommand){
			throw new Error(`For project ${project.name} ${nameOf<ProjectDefinition>("launchCommand")} is provided, but not ${nameOf<ProjectDefinition>("launchCompletedCondition")}. That means this project will never be considered started; this is misconfuguration.`);
		} else if(conds.length !== 0 && !project.def.launchCommand){
			project.logger.logTool(`Project has no ${nameOf<ProjectDefinition>("launchCommand")}, but have ${nameOf<ProjectDefinition>("launchCompletedCondition")}. . It is not strictly an error, just meaningless configuration.`);
		}

		let doLaunchCompleted = async () => {
			await project.onLaunchCompleted();
			await this.onLaunchCompleted.fire(project.name);
		}

		for(const cond of conds){
			if(typeof(cond) === "number"){
				project.onProcessCreated.listen(() => {
					setTimeout(doLaunchCompleted, cond)
				});
			} else if(isStdioParsingRegexp(cond)) {
				this.attachStdioListener(project, cond, doLaunchCompleted);
			} else if(isProjectEventReference(cond)){
				this.attachProjectEventReference(cond, doLaunchCompleted);
			} else {
				throw new Error(`Could not understand type of ${nameOf<ProjectDefinition>("launchCompletedCondition")} of project ${project.name} (full condition is ${JSON.stringify(cond)}`);
			}
		}
	}

	private attachStdioListener(project: Project, cond: StdioParsingRegexp, action: (match: RegExpMatchArray, line: string) => void | Promise<void>){
		const targetProject = cond.projectName? this.projectMap[cond.projectName]: project;
		if(!targetProject){
			throw new Error(`Could not find project from stdio parsing condition by name "${cond.projectName}" (full condition is ${JSON.stringify(cond)})`);
		}
		let evt = cond.stderr? targetProject.onStderr: targetProject.onStdout;
		let regexp = new RegExp(cond.stdioParsingRegexp);
		evt.listen(async line => {
			let m = line.match(regexp)
			if(m){
				await Promise.resolve(action(m, line));
			}
		})
	}

	private attachProxyUrlListener(project: Project, cond: ProxyUrlRegexp, action: () => Promise<void>){
		const targetProject = cond.projectName? this.projectMap[cond.projectName]: project;
		if(!targetProject){
			throw new Error(`Could not find project from proxy url parsing condition by name "${cond.projectName}" (full condition is ${JSON.stringify(cond)})`);
		} else if(!(targetProject instanceof ImploderProject)){
			throw new Error(`Proxy url parsing condition requested on project "${targetProject.name}", but it's not Imploder project, and no proxy is supplied for it, so it's impossible to add HTTP conditions to this project (full condition is ${JSON.stringify(cond)}).`);
		} else if(!targetProject.onHttpRequest){
			throw new Error(`Proxy url parsing condition requested on project "${targetProject.name}", but this Imploder project does not have a proxy to attach listener to. You may define such proxy with ${nameOf<ImploderProjectDefinition>("proxyHttpPort")} and ${nameOf<ImploderProjectDefinition>("projectHttpPort")} (full condition is ${JSON.stringify(cond)}).`);
		}

		let regexp = new RegExp(cond.proxyUrlRegexp);
		targetProject.onHttpRequest.listen(async ({url, method}) => {
			if(cond.method && method.toUpperCase() !== cond.method.toUpperCase()){
				return;
			}
			if(url.match(regexp)){
				await action();
			}
		})
	}

	private attachProjectEventReference(cond: ProjectEventReference, action: () => Promise<void>){
		if(!(cond.projectName in this.projectMap)){
			throw new Error(`Bad project event reference: there is no project named "${cond.projectName}" (full condition is ${JSON.stringify(cond)}`)
		}

		let event: AsyncEvent<string>;
		switch(cond.eventType){
			case "launchCompleted":
				event = this.onLaunchCompleted;
				break;
			case "restart":
				event = this.onRestart;
				break;
			default: throw new Error(`Bad project event reference: unknown event type "${cond.eventType}" (full condition is ${JSON.stringify(cond)}`)
		}

		event.listen(name => {
			if(name === cond.projectName){
				action();
			}
		})
	}

}