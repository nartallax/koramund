import * as Http from "http";
import * as Ws from "ws";
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
	private readonly server: Http.Server;
	private readonly wsServer: Ws.Server;
	readonly onHttpRequest = makeAsyncEvent<Koramund.HttpRequest>();
	readonly onBeforeHttpRequest = makeAsyncEvent();
	readonly onWebsocketConnectStarted = makeAsyncEvent<Koramund.WebsocketConnectionStartEvent>();
	readonly onWebsocketConnected = makeAsyncEvent<Koramund.WebsocketConnectionCompletedEvent>();
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
		this.server = Http.createServer(this.handle.bind(this));
		this.wsServer = new Ws.Server({
			server: this.server
		})
		this.wsServer.on("connection", (socket, request) => this.processWebsocketConnection(socket, request));

		this.server.on("error", err => {
			this.opts.logger.logTool("Proxy HTTP server gave error: " + err.message);
		})

		this.wsServer.on("error", err => {
			this.opts.logger.logTool("Proxy websocket server gave error: " + err.message);
		})
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
			});
		});
	}

	private async processWebsocketConnection(externalConn: Ws, req: Http.IncomingMessage): Promise<void> {
		await this.onWebsocketConnectStarted.fire({ request: req, clientConnection: externalConn });

		let reqUrl = new URL(req.url || "/", "http://localhost:" + this.opts.port);
		let url = `ws://localhost:${this.targetHttpPort}${reqUrl.pathname}${reqUrl.search}`;
		// websocket connection to project, opposed to externally initiated connection
		let projectConn = new Ws(url, {
			timeout: this.timeout,
			protocol: externalConn.protocol
		});

		let lastError: Error | null = null;
		let connected = false;
		projectConn.on("error", err => {
			this.opts.logger.logTool("Websocket proxy connection to project gave error: " + err);
			if(!connected){
				externalConn.close(1001, "Websocket proxy failed to connect to project websocket server.");
			} else {
				lastError = err;
				externalConn.close();
				projectConn.close();
			}
		});

		externalConn.on("error", err => {
			this.opts.logger.logTool("Websocket proxy incoming connection gave error: " + err);
			lastError = err;
			externalConn.close();
			projectConn.close();
		});

		projectConn.on("close", (code, desc) => {
			// ws does not allow some codes to be passed directly (like 1006)
			// that's a shame (we can't perfectly mimic target server), but I see logic behind it
			externalConn.close(code === 1000 || code === 1001? code: 1000, desc);
			this.onWebsocketDisconnect.fire({ error: lastError, code, description: desc, from: "server" });
		});

		externalConn.on("close", (code, desc) => {
			projectConn.close(code === 1000 || code === 1001? code: 1000, desc);
			this.onWebsocketDisconnect.fire({ error: lastError, code, description: desc, from: "client" });
		});

		let sendTo = (conn: Ws, msg: Ws.Data) => {
			let errorHandler = (error?: Error) => {
				if(error){
					this.opts.logger.logTool("Failed to send data to websocket: " + error)
				}
			}

			if(Array.isArray(msg)){
				msg.forEach(chunk => conn.send(chunk, errorHandler))
			} else {
				conn.send(msg, errorHandler);
			}
		}

		externalConn.on("message", async msg => {
			await this.onWebsocketMessage.fire({data: msg, from: "client"});
			sendTo(projectConn, msg)
		});

		projectConn.on("message", async msg => {
			await this.onWebsocketMessage.fire({data: msg, from: "server"});
			sendTo(externalConn, msg)
		});

		projectConn.on("open", async () => {
			connected = true;
			await this.onWebsocketConnected.fire({ request: req, clientConnection: externalConn, serverConnection: projectConn });
		});

	}
	
	private get timeout(): number {
		return this.opts.timeout || 180000;
	}

	private pipeRequests(outResp: Http.IncomingMessage, resp: Http.ServerResponse): Promise<void> {
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

	private makeRequest(inReq: Http.IncomingMessage, preReadBody: Buffer | null): Promise<Http.IncomingMessage> {
		return new Promise((ok, bad) => {
			try {
				let parsedUrl = new URL(inReq.url || "", "http://localhost");

				if(this.targetHttpPort < 0){
					throw new Error("Could not create proxy request: HTTP port of running project is not assigned.");
				}

				let options: Http.RequestOptions = {
					protocol: parsedUrl.protocol,
					hostname: "localhost",
					port: this.targetHttpPort,
					path: parsedUrl.pathname + (parsedUrl.search || ""),
					timeout: this.timeout, // note: it's just connect timeout and not read timeout
					method: (inReq.method || "").toUpperCase(),
					headers: inReq.headers
				};

				let outReq = Http.request(options, resp => {
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

	private async handle(inReq: Http.IncomingMessage, inResp: Http.ServerResponse): Promise<void> {

		try {
			await this.onBeforeHttpRequest.fire();
		} catch(e){
			this.opts.logger.logTool("HTTP request could not be delivered: " + e.message);
			inResp.destroy();
			inReq.destroy();
			return;
		}

		inReq.on("error", err => {
			this.opts.logger.logTool("Incoming HTTP request error: " + err.message);
		});

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