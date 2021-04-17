import {Imploder} from "@nartallax/imploder";
import {AsyncEvent} from "async_event";
import {ImploderProjectDefinition, OnShutdownActionName} from "types";
import {HttpProxy} from "http_proxy";
import {Project} from "project";
import * as path from "path";
import {arrayOfMaybeArray, isJsonDataPath, isProgramLaunchCommand, isShellCommand, nameOf} from "utils";

/** A Typescript project that uses Imploder. */
export class ImploderProject extends Project<ImploderProjectDefinition> {
	private readonly proxy: HttpProxy | null;

	readonly onHttpRequest: AsyncEvent<{url: string, method: string}> | null;

	constructor(opts: ImploderProjectDefinition, private readonly isSingleTimeBuild: boolean){
		super(opts);
		this.proxy = opts.proxyHttpPort === undefined? null: new HttpProxy({
			logger: this.logger,
			onRequest: async opts => {
				if(!this.onHttpRequest){
					throw new Error("Have request, but no request event!"); // never happen
				}
				if(this.def.initialLaunchOn !== "toolStart" && this.process?.state === "stopped"){
					await this.restart();
				}
				await this.onHttpRequest.fire(opts);
			},
			timeout: opts.proxyTimeout
		});
		this.onHttpRequest = !this.proxy? null: new AsyncEvent();
	}

	async prepareForDevelopment(): Promise<void> {
		if(this.proxy){
			let port = await this.getProxyHttpPort();
			await this.proxy.start(port);
		}
	}

	async build(): Promise<boolean>{
		let imploder = await this.getImploder();
		await imploder.compiler.waitBuildEnd();
		if(!imploder.compiler.lastBuildWasSuccessful){
			return false;
		}
		await imploder.bundler.produceBundle();
		return true;
	}

	async doPostBuildActions(): Promise<void>{
		for(let action of arrayOfMaybeArray(this.def.postBuildActions)){
			if(isShellCommand(action)){
				let {stdout, stderr} = await this.runShellCommandWithZeroCode(action.shell);
				stdout.split("\n").forEach(x => this.logger.logStdout(x));
				stderr.split("\n").forEach(x => this.logger.logStderr(x));
			} else if(isProgramLaunchCommand(action)){
				await this.startProcessFromCommandPassLogsWaitZeroExit(action.programLaunch);
			} else {
				throw new Error(`Unknown item type of ${nameOf<ImploderProjectDefinition>("postBuildActions")}: ${JSON.stringify(action)}`);
			}
		}
	}

	protected async getLaunchCommandTemplateArgs(){
		let imploder = await this.getImploder();

		return {
			...await super.getLaunchCommandTemplateArgs(),
			bundle: imploder.config.outFile
		}
	}

	protected beforeStart(): Promise<boolean>{
		return this.build();
	}

	async onInitialLaunch(): Promise<void> {
		if(this.def.initialLaunchOn === "toolStart"){
			await this.restart();
		} else if(!this.def.initialLaunchOn && !this.process){
			await this.getImploder();
		}
	}

	private async getProxyHttpPort(): Promise<number> {
		let getPortLogic = this.def.proxyHttpPort;
		if(getPortLogic === undefined){
			throw new Error("Need proxy port, but no acquiring logic is supplied!"); // should never happen
		} else if(typeof(getPortLogic) === "number"){
			return getPortLogic;
		} else if(isShellCommand(getPortLogic)) {
			return await this.runShellCommandToInt(getPortLogic.shell)
		} else if(isJsonDataPath(getPortLogic)) {
			return await this.runJsonDataPathForNumber(getPortLogic);
		} else {
			throw new Error(`Could not understand type of ${nameOf<ImploderProjectDefinition>("proxyHttpPort")} (full value is ${JSON.stringify(getPortLogic)})`);
		}
	}

	private _imploder: Promise<Imploder.Context> | Imploder.Context | null = null;
	private async getImploder(): Promise<Imploder.Context> {
		if(this._imploder === null){
			this.logger.logTool("Launching Imploder.");
			this._imploder = Imploder.runFromTsconfig(this.def.imploderProject, {
				profile: this.isSingleTimeBuild? this.def.imploderBuildProfileName: this.def.imploderDevelopmentProfileName,
				writeLogLine: str => this.logger.logTool(str)
			});
		}

		if(this._imploder instanceof Promise){
			this._imploder = await this._imploder;
		}

		if(this._imploder.config.watchMode === this.isSingleTimeBuild){
			throw new Error("Misconfiguration: for this tool mode, expected Imploder watch mode to be " + (this.isSingleTimeBuild? "disabled": "enabled") + ", but it is not.");
		}

		return this._imploder;
	}

	isImploderRunning(): boolean {
		return !!this._imploder;
	}

	protected getActionOnUnexpectedShutdown(): OnShutdownActionName {
		return "nothing";
	}

	onHttpPortAcquired(port: number){
		if(this.proxy){
			this.proxy.httpPort = port;
		} else {
			super.onHttpPortAcquired(port);
		}
	}

	async beforeShutdown(): Promise<void>{
		await super.beforeShutdown();
		if(this._imploder){
			let imploder = await this.getImploder();
			await Promise.resolve(imploder.compiler.stop());
		}
		if(this.proxy){
			await this.proxy.stop();
		}
	}

	protected getProjectSourcesRootDir(): string | undefined {
		return path.dirname(this.def.imploderProject);
	}
	
}