import {Imploder} from "@nartallax/imploder";
import {AsyncEvent} from "async_event";
import {CommonProject, CommonProjectParams} from "common_project";
import {WrappingHttpProxy} from "http_proxy";
import * as Path from "path";
import * as Websocket from "websocket";
import {Koramund} from "types";

export interface ImploderProjectParams extends Koramund.ImploderProjectParams, CommonProjectParams {}

/** A Typescript project that uses Imploder. */
export class ImploderProject extends CommonProject<ImploderProjectParams> implements Koramund.ImploderProject {
	private readonly proxy: WrappingHttpProxy | null;

	private readonly buildFinishEvent = new AsyncEvent<Koramund.BuildResult>();

	constructor(opts: ImploderProjectParams){
		super(opts);

		this.proxy = opts.proxyHttpPort === undefined? null: new WrappingHttpProxy({
			logger: this.logger,
			port: opts.proxyHttpPort,
			timeout: opts.proxyTimeout
		});
	}

	async build(buildType: Koramund.BuildType = "release"): Promise<Koramund.BuildResult>{
		let imploder = await this.startImploder();
		await imploder.compiler.waitBuildEnd();
		if(!imploder.compiler.lastBuildWasSuccessful){
			let result: Koramund.BuildResult = {success: false, type: buildType, project: this};
			await this.buildFinishEvent.fire(result)
			return result;
		}
		await imploder.bundler.produceBundle();
		let result: Koramund.BuildResult = {success: true, type: buildType, project: this};
		await this.buildFinishEvent.fire(result)
		return result;
	}

	private _imploder: Promise<Imploder.Context> | Imploder.Context | null = null;

	get imploder(): Imploder.Context | null {
		if(!this._imploder || this._imploder instanceof Promise){
			return null;
		} else {
			return this._imploder;
		}
	}

	async startImploder(): Promise<Imploder.Context> {
		if(this._imploder === null){
			this.logger.logTool("Launching Imploder.");
			this._imploder = Imploder.runFromTsconfig(this.params.tsconfigPath, {
				profile: this.params.profile,
				writeLogLine: str => this.logger.logTool(str)
			});
		}

		if(this._imploder instanceof Promise){
			this._imploder = await this._imploder;
		}

		return this._imploder;
	}

	notifyProcessHttpPort(port: number): void {
		if(this.proxy){
			this.proxy.targetHttpPort = port;
		}
	}

	async start(): Promise<void>{
		if(this.proxy){
			await this.proxy.start();
		}
		await super.start();
	}

	// events
	onBuildFinished(handler: (buildResult: Koramund.BuildResult) => void): void {
		this.buildFinishEvent.listen(handler);
	}

	onHttpRequest(handler: (request: Koramund.HttpRequest) => Koramund.PromiseOrValue<void>): void {
		if(!this.proxy){
			throw new Error("This project does not have HTTP proxy, therefore won't ever capture HTTP request.");
		}
		this.proxy.onHttpRequest.listen(handler);
	}

	onWebsocketConnectStarted(handler: (request: Websocket.request) => Koramund.PromiseOrValue<void>): void {
		if(!this.proxy){
			throw new Error("This project does not have HTTP proxy, therefore won't ever capture websocket connection.");
		}
		this.proxy.onWebsocketConnectStarted.listen(handler);
	}
	
	onWebsocketConnected(handler: (request: Websocket.request) => void): void {
		if(!this.proxy){
			throw new Error("This project does not have HTTP proxy, therefore won't ever capture websocket connection.");
		}
		this.proxy.onWebsocketConnected.listen(handler);
	}

	onWebsocketDisconnected(handler: (event: Koramund.WebsocketDisconnectEvent) => void): void {
		if(!this.proxy){
			throw new Error("This project does not have HTTP proxy, therefore won't ever capture websocket connection (and disconnection).");
		}
		this.proxy.onWebsocketDisconnect.listen(handler);
	}
	
	onWebsocketMessage(handler: (event: Koramund.WebsocketMessageEvent) => Koramund.PromiseOrValue<void>): void {
		if(!this.proxy){
			throw new Error("This project does not have HTTP proxy, therefore won't ever capture websocket messages.");
		}
		this.proxy.onWebsocketMessage.listen(handler);
	}

	//overrides
	protected getWorkingDirectory(): string {
		return this.params.workingDirectory || Path.dirname(this.params.tsconfigPath);
	}

	protected async beforeStart(): Promise<boolean>{
		let result = await this.build();
		return result.success
	}

	async shutdown(withSignal?: NodeJS.Signals): Promise<void> {
		let imploder = this.imploder;
		if(imploder){
			await Promise.resolve(imploder.compiler.stop());
		}
		if(this.proxy){
			await this.proxy.stop();
		}
		super.shutdown(withSignal);
	}

	// for tests
	isImploderRunning(): boolean {
		return !!this._imploder;
	}
	
}