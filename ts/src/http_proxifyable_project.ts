import {BaseProjectInternal} from "base_project";
import {WrappingHttpProxy} from "http_proxy";
import {LaunchableProjectInternal} from "launchable_project";
import {Koramund} from "koramund";

export type HttpProxifyableProjectInternal = LaunchableProjectInternal & Koramund.HttpProxifyableProject

export function createHttpProxifyableProject<P extends Koramund.HttpProxifyableProjectParams>
	(base: BaseProjectInternal<P> & LaunchableProjectInternal):
	BaseProjectInternal<P> & HttpProxifyableProjectInternal {

	let proxy = new WrappingHttpProxy({
		logger: base.logger,
		port: base.params.proxyHttpPort,
		timeout: base.params.proxyTimeout
	})

	let proj: BaseProjectInternal<P> & HttpProxifyableProjectInternal & LaunchableProjectInternal = {
		...base,

		async startHttpProxy(){
			await proxy.start();
		},

		getProxyHttpPort(): number {
			return base.params.proxyHttpPort
		},

		getProjectHttpPort(): number {
			let port = proxy.targetHttpPort;
			if(port < 0){
				throw new Error("Cannot get project http port: no port is known yet.");
			}
			return port;
		},

		onHttpRequest: proxy.onHttpRequest,
		onWebsocketConnectStarted: proxy.onWebsocketConnectStarted,
		onWebsocketConnected: proxy.onWebsocketConnected,
		onWebsocketDisconnected: proxy.onWebsocketDisconnect,
		onWebsocketMessage: proxy.onWebsocketMessage,

		notifyProjectHttpPort(port: number): void {
			proxy.targetHttpPort = port;
		}
	}

	async function makeSureThatProcessIsRunning(){
		while(proj.process.state !== "running"){
			switch(proj.process.state){
				case "starting":
					await proj.process.onLaunchCompleted.wait();
					break;
				case "stopped": {
					let result = await proj.start();
					if(result.type === "invalid_state"){
						throw new Error("Project could not be launched in this state, HTTP request failed.");
					}
					break;
				}
				case "stopping":
					await proj.onStop.wait();
					// expecting to loopback to "stopped" or "started"
					break;
			}
		}
	}

	proxy.onBeforeHttpRequest(makeSureThatProcessIsRunning);
	proxy.onWebsocketConnectStarted(makeSureThatProcessIsRunning);

	proj.process.onBeforeStart(() => proxy.start());
	proj.onShutdown(() => proxy.stop())

	return proj;
}

export function isHttpProxifyableProjectParams(params: Koramund.LaunchableProjectParams): params is Koramund.HttpProxifyableProjectParams {
	return typeof((params as Koramund.HttpProxifyableProjectParams).proxyHttpPort) === "number";
}