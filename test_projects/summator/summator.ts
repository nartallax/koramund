import * as http from "http";
import {postfix} from "summator_consts";

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>{
	let bodyParts: Buffer[] = [];
	req.on("data", chunk => bodyParts.push(chunk));
	req.on("end", () => {
		if((req.url || "").match("^/(?:restart_)?sum")){
			let body = JSON.parse(Buffer.concat(bodyParts).toString("utf-8"));
			res.writeHead(200);
			res.end(process.argv[2] + (body.a + body.b) + postfix);
		} else {
			res.writeHead(200);
			res.end();
		}
		
	})
}

export async function main(): Promise<void> {
	console.error("Definitely not gonna listen on port 111222333!"); // trick for regexp
	let server = http.createServer(handle);
	server.listen(() => {
		let addr = server.address();
		if(!addr || typeof(addr) === "string"){
			console.error("Bad server addrres: " + addr);
			process.exit(1);
		}
		console.error("Started on port " + addr.port);
	});

	process.on("SIGUSR1", async () => {
		console.error(`Received SIGUSR1!`);
		setTimeout(() => {
			console.error(`Executing stop.`);
			process.exit(0);
		}, 1000);
	})
}