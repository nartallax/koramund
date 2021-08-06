import * as http from "http";
import * as Websocket from "websocket";
import {Logger} from "logger";
import {Koramund} from "types";
import {CallBuffer} from "call_buffer";
import {makeAsyncEvent} from "async_event";

export interface WrappingHttpProxyOptions {
	logger: Logger;
	timeout?: number;
	port: number;
}

/** An HTTP proxy that wraps an other HTTP listener and allows to handle some network-related events about it */
export class WrappingHttpProxy {
	private readonly server: http.Server;
	private readonly wsServer: Websocket.server;
	readonly onHttpRequest = makeAsyncEvent<Koramund.HttpRequest>();
	readonly onBeforeHttpRequest = makeAsyncEvent();
	readonly onWebsocketConnectStarted = makeAsyncEvent<Koramund.WebsocketConnectionEvent>();
	readonly onWebsocketConnected = makeAsyncEvent<Koramund.WebsocketConnectionEvent>();
	readonly onWebsocketDisconnect = makeAsyncEvent<Koramund.WebsocketDisconnectEvent>();
	readonly onWebsocketMessage = makeAsyncEvent<Koramund.WebsocketMessageEvent>();
	readonly startPromise = makeAsyncEvent();
	readonly stopPromise = makeAsyncEvent();
	private isStarting = false;
	private isStarted = false;
	private isStopping = false;

	// should be assigned from outside
	targetHttpPort = -1;

	constructor(private readonly opts: WrappingHttpProxyOptions) {
		this.server = http.createServer(this.handle.bind(this));
		this.wsServer = new Websocket.server({
			httpServer: this.server,
			autoAcceptConnections: false
		});
		this.wsServer.on("request", this.processWebsocketRequest.bind(this));
	}

	async start(): Promise<void> {
		if(this.isStarted){
			return;
		}

		if(this.isStopping){
			await this.stopPromise.wait();
		}

		if(this.isStarting){
			await this.startPromise.wait();
			return;
		}
		this.isStarting = true;

		return await new Promise((ok, bad) => {
			this.server.listen(this.opts.port, async () => {
				this.isStarted = true;
				this.isStarting = false;
				try {
					await this.startPromise.fire();
					ok();
				} catch(e){
					this.startPromise.throw(e);
					bad(e);
				}
			});
		});
	}

	async stop(): Promise<void>{
		if(!this.isStarted && !this.isStarting && !this.isStopping){
			return;
		}

		if(this.isStarting){
			await this.startPromise.wait();
		}

		if(this.isStopping){
			await this.stopPromise.wait();
			return;
		}
		this.isStopping = true;

		await new Promise<void>((ok, bad) => {
			this.server.close(async err => {
				// here could appear some discrepancies, if invoked when starting in progress
				// but in reality it won't happen, so let's not make this harder now
				this.isStarted = false;
				this.isStopping = false;

				if(err){
					bad(err);
				} else {
					try {
						await this.stopPromise.fire();
						ok()
					} catch(e){
						this.stopPromise.throw(e);
						bad(e);
					}
				}
			})
		});
	}

	private async processWebsocketRequest(req: Websocket.request): Promise<void> {
		if(req.origin !== "localhost"){
			this.opts.logger.logTool("Rejecting websocket request from origin \"" + req.origin + "\". Only localhost is allowed.");
			req.reject();
			return;
		}

		let client = new Websocket.client();
		await this.onWebsocketConnectStarted.fire({ request: req });

		client.on("connectFailed", err => {
			this.opts.logger.logTool("Websocket proxy failed to connect: " + err);
			req.reject(500, "Proxy-connection to target server failed.");
		});

		client.on("connect", async outConn => {
			await this.onWebsocketConnected.fire({ request: req });
			let inConn = req.accept(undefined, req.origin);

			let lastError: Error | null = null;
			outConn.on("error", err => {
				this.opts.logger.logTool("Websocket proxy outcoming connection gave error: " + err);
				lastError = err;
				inConn.close();
				outConn.close(); // drop..?
			});

			inConn.on("error", err => {
				lastError = err;
				this.opts.logger.logTool("Websocket proxy incoming connection gave error: " + err);
				inConn.close();
				outConn.close();
			});

			outConn.on("close", (code, desc) => {
				inConn.close(code, desc);
				this.onWebsocketDisconnect.fire({ error: lastError, code, description: desc, from: "server" });
			});

			inConn.on("close", (code, desc) => {
				outConn.close(code, desc);
				this.onWebsocketDisconnect.fire({ error: lastError, code, description: desc, from: "client" });
			});

			let sendTo = (conn: Websocket.connection, msg: Websocket.IMessage) => {
				if(msg.utf8Data !== undefined){
					conn.sendUTF(msg.utf8Data, err => {
						this.opts.logger.logTool("Failed to send utf8 data to websocket: " + err)
					});
				} else if(msg.binaryData !== undefined){
					conn.sendBytes(msg.binaryData, err => {
						this.opts.logger.logTool("Failed to send binary data to websocket: " + err)
					});
				} else {
					this.opts.logger.logTool("Got websocket message that is not binary nor textual!");
				}
			}

			inConn.on("message", async msg => {
				await this.onWebsocketMessage.fire({message: msg, from: "client"});
				sendTo(outConn, msg)
			});
			outConn.on("message", async msg => {
				await this.onWebsocketMessage.fire({message: msg, from: "server"});
				sendTo(inConn, msg)
			});
		});

		client.connect(`ws://localhost:${this.targetHttpPort}${req.resourceURL.pathname}${req.resourceURL.search}`, 'echo-protocol');

	}
	
	private get timeout(): number {
		return this.opts.timeout || 180000;
	}

	private pipeRequests(outResp: http.IncomingMessage, resp: http.ServerResponse): Promise<void> {
		return new Promise((ok, bad) => {
			let code = outResp.statusCode;
			if(code === undefined) {
				bad(new Error("There is no status code!"));
				return
			}
			resp.writeHead(code, outResp.headers);

			let readTimeoutHandler: NodeJS.Timeout;
			let completed = false;

			let complete = (): boolean => {
				if(completed) {
					return true;
				}
				if(readTimeoutHandler) {
					clearTimeout(readTimeoutHandler);
				}
				completed = true;
				return false;
			}

			let setReadTimeout = () => {
				if(readTimeoutHandler) {
					clearTimeout(readTimeoutHandler);
				}
				readTimeoutHandler = setTimeout(() => {
					if(complete()) {
						return;
					}
					let err = new Error("Read timed out")
					outResp.destroy(err);
					resp.destroy(err);
					bad(err);
				}, this.timeout);
			}

			setReadTimeout();

			resp.on("error", err => {
				if(complete()){
					return;
				}
				outResp.destroy(err);
				bad(err);
			});

			outResp.on("error", err => {
				if(complete()) {
					return;
				}
				resp.destroy(err);
				bad(err);
			});

			outResp.on("data", buffer => {
				if(completed) { // no error here, variable check intended
					return;
				}
				setReadTimeout();
				resp.write(buffer);
			});

			outResp.on("end", () => {
				if(complete()) {
					return;
				}
				resp.end();
				ok();
			});
		});
	}

	private makeRequest(inReq: http.IncomingMessage, preReadBody: Buffer | null): Promise<http.IncomingMessage> {
		return new Promise((ok, bad) => {
			try {
				let parsedUrl = new URL(inReq.url || "", "http://localhost");

				if(this.targetHttpPort < 0){
					throw new Error("Could not create proxy request: HTTP port of running project is not assigned.");
				}

				let options: http.RequestOptions = {
					protocol: parsedUrl.protocol,
					hostname: "localhost",
					port: this.targetHttpPort,
					path: parsedUrl.pathname + (parsedUrl.search || ""),
					timeout: this.timeout, // note: it's just connect timeout and not read timeout
					method: (inReq.method || "").toUpperCase(),
					headers: inReq.headers
				};

				let outReq = http.request(options, resp => {
					ok(resp);
				});

				outReq.on("error", err => {
					inReq.destroy(err);
					bad(err);
				});

				inReq.on("error", err => {
					outReq.destroy(err);
					bad(err);
				});

				if(preReadBody){
					outReq.end(preReadBody);
				} else {
					inReq.on("data", chunk => outReq.write(chunk));
					inReq.on("end", () => {
						outReq.end();
					});
				}
			} catch(e) {
				inReq.destroy(e);
				bad(e)
			}
		})
	}

	private async handle(inReq: http.IncomingMessage, inResp: http.ServerResponse): Promise<void> {

		try {
			await this.onBeforeHttpRequest.fire();
		} catch(e){
			this.opts.logger.logTool("HTTP request could not be delivered: " + e.message);
			inResp.destroy();
			inReq.destroy();
			return;
		}

		let bodyCallBuffer = new CallBuffer<Buffer>(() => new Promise((ok, bad) => {
			let arr: Buffer[] = [];
			inReq.on("data", chunk => arr.push(chunk));
			inReq.on("end", () => ok(Buffer.concat(arr)));
			inReq.on("error", err => bad(err));
		}))
		let handlerInvocationCompleted = false;
		function getBody(): Promise<Buffer>{
			if(handlerInvocationCompleted){
				throw new Error("Request body is only accessible in http request event handler.");
			}
			
			return bodyCallBuffer.get();
		}

		let url = inReq.url;
		let method = inReq.method
		try {
			if(!url || !method) {
				throw new Error("Request without url/method!");
			}

			await this.onHttpRequest.fire({ url, method, headers: inReq.headers, getBody });
			handlerInvocationCompleted = true;

			let preReadBody: Buffer | null = bodyCallBuffer.hasValue()? bodyCallBuffer.getValue()
				: bodyCallBuffer.isWorking()? await bodyCallBuffer.get()
				: null;
			let outResp = await this.makeRequest(inReq, preReadBody);
			await this.pipeRequests(outResp, inResp);
		} catch(e){
			this.opts.logger.logTool(`Error handling HTTP ${method} to ${url}: ` + e.message);
			if(!inReq.destroyed){
				inReq.destroy(e);
			}
		}
	}
}