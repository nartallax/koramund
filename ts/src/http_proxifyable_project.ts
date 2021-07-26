import {BaseProjectInternal} from "base_project";
import {WrappingHttpProxy} from "http_proxy";
import {LaunchableProjectInternal} from "launchable_project";
import {Koramund} from "types";

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

		onHttpRequest: proxy.onHttpRequest,
		onWebsocketConnectStarted: proxy.onWebsocketConnectStarted,
		onWebsocketConnected: proxy.onWebsocketConnected,
		onWebsocketDisconnected: proxy.onWebsocketDisconnect,
		onWebsocketMessage: proxy.onWebsocketMessage,

		notifyProcessHttpPort(port: number): void {
			proxy.targetHttpPort = port;
		}
	}

	proj.process.onBeforeStart(() => proxy.start());
	proj.onShutdown(() => proxy.stop())

	return proj;
}

export function isHttpProxifyableProjectParams(params: Koramund.LaunchableProjectParams): params is Koramund.HttpProxifyableProjectParams {
	return typeof((params as Koramund.HttpProxifyableProjectParams).proxyHttpPort) === "number";
}