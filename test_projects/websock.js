let Ws = require("ws");
let Http = require("http");

function dataToStr(data) {
	if(typeof(data) === "string"){
		return data;
	}

	if(Array.isArray(data)){
		return Buffer.concat(data).toString("utf-8");
	}

	if(data instanceof Buffer){
		return data.toString("utf-8")
	}

	if(data instanceof ArrayBuffer){
		return Buffer.from(data).toString("utf-8");
	}

	throw new Error("This data is in unexpected format.");
}

let server = Http.createServer((_, res) => {
	console.error("Got ordinary HTTP request!");
	res.statusCode = 500;
	res.end("Nope.");
});

let wsServer = new Ws.Server({server});
wsServer.on("connection", socket => {

	socket.on("error", err => {
		console.error("Websocket app error: " + err);
	});

	socket.on("close", (code, desc) => {
		console.error(`Websocket app connection closed with code ${code} and desc ${desc}`);
	});

	socket.on("message", msg => {
		let data = JSON.parse(dataToStr(msg));
		socket.send(JSON.stringify({ result: data.a + data.b, isOk: true }));
	});

});

server.listen(() => {
	console.error("Started on " + server.address().port);
});