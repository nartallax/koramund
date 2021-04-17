import * as http from "http";
import * as Websocket from "websocket";
import {Logger} from "logger";

export interface HttpProxyOptions {
	onRequest: (opts: {url: string, method: string}) => Promise<void>;
	logger: Logger;
	timeout?: number;
}

export class HttpProxy {
	private readonly server: http.Server;
	private readonly wsServer: Websocket.server;
	// will be assigned from outside
	httpPort: number = -1;

	constructor(private readonly opts: HttpProxyOptions) {
		this.server = http.createServer(this.handle.bind(this));
		this.wsServer = new Websocket.server({
			httpServer: this.server,
			autoAcceptConnections: false
		});
		this.wsServer.on("request", this.processWebsocketRequest.bind(this));
	}

	start(port: number): Promise<void> {
		return new Promise(ok => {
			this.server.listen(port, ok);
		});
	}

	stop(): Promise<void>{
		return new Promise((ok, bad) => {
			this.server.close(err => err? bad(err): ok())
		});
	}

	private processWebsocketRequest(req: Websocket.request): void{
		if(req.origin !== "localhost"){
			this.opts.logger.logTool("Rejecting websocket request from origin \"" + req.origin + "\". Only localhost is allowed.");
			req.reject();
			return;
		}

		let client = new Websocket.client();

		client.on("connectFailed", err => {
			this.opts.logger.logTool("Websocket proxy failed to connect: " + err);
			req.reject(500, "Proxy-connection to target server failed.");
		});

		client.on("connect", outConn => {
			let inConn = req.accept(undefined, req.origin);

			outConn.on("error", err => {
				this.opts.logger.logTool("Websocket proxy outcoming connection gave error: " + err);
				inConn.close();
				outConn.close(); // drop..?
			});

			inConn.on("error", err => {
				this.opts.logger.logTool("Websocket proxy incoming connection gave error: " + err);
				inConn.close();
				outConn.close();
			});

			outConn.on("close", (code, desc) => {
				inConn.close(code, desc);
			});

			inConn.on("close", (code, desc) => {
				outConn.close(code, desc);
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

			inConn.on("message", msg => sendTo(outConn, msg));
			outConn.on("message", msg => sendTo(inConn, msg));
		});

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

	private makeRequest(inReq: http.IncomingMessage): Promise<http.IncomingMessage> {
		return new Promise((ok, bad) => {
			try {
				let parsedUrl = new URL(inReq.url || "", "http://localhost");

				if(this.httpPort < 0){
					throw new Error("Could not create proxy request: HTTP port of running project is not assigned.");
				}

				let options: http.RequestOptions = {
					protocol: parsedUrl.protocol,
					hostname: "localhost",
					port: this.httpPort,
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

				inReq.on("data", chunk => outReq.write(chunk));
				inReq.on("end", () => {
					outReq.end();
				});
			} catch(e) {
				inReq.destroy(e);
				bad(e)
			}
		})
	}

	private async handle(inReq: http.IncomingMessage, inResp: http.ServerResponse): Promise<void> {
		let url = inReq.url;
		let method = inReq.method
		try {
			if(!url || !method) {
				throw new Error("Request without url/method!");
			}

			await this.opts.onRequest({url, method});

			let outResp = await this.makeRequest(inReq);
			await this.pipeRequests(outResp, inResp);
		} catch(e){
			this.opts.logger.logTool(`Error handling HTTP ${method} to ${url}: ` + e.message);
			if(!inReq.destroyed){
				inReq.destroy(e);
			}
		}
	}
}