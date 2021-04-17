import * as http from "http";

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>{
	let bodyParts: Buffer[] = [];
	req.on("data", chunk => bodyParts.push(chunk));
	req.on("end", () => {
		if((req.url || "").match("^/mult")){
			let body = JSON.parse(Buffer.concat(bodyParts).toString("utf-8"));
			res.writeHead(200);
			res.end((body.a * body.b) + "");
		} else {
			res.writeHead(200);
			res.end();
		}
		
	})
}

export async function main(){
	let server = http.createServer(handle);
	server.listen(() => {
		let addr = server.address();
		if(!addr || typeof(addr) === "string"){
			console.error("Bad server addrres: " + addr);
			process.exit(1);
		}
		console.error("Started on port " + addr.port);
	});
}