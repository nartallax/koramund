// simple app that generates random hashes over http
// for sake of test let's assume it is not under our control (i.e. we did not write its code)

const crypto = require("crypto");
const http = require("http");

async function handle(req, res){
	crypto.scrypt(Math.random() + "|" + Math.random(), "", 64, (err, key) => {
		if(err){
			res.writeHead(500);
			res.end();
		} else {
			res.writeHead(200);
			res.end(key.toString("hex").toLowerCase());
		}
	});
}

async function main(){
	let server = http.createServer(handle);
	let port = 7835;
	server.listen(port, () => {
		console.error("Started on port " + port);
	});
}

let sigintCount = 0;
process.on("SIGINT", () => {
	sigintCount++;
	console.log(`Received ${sigintCount} SIGINTs!`);
	if(sigintCount === 3){
		process.exit(0);
	}
});

process.on("SIGUSR1", async () => {
	console.log(`Received SIGUSR1!`);
	setTimeout(() => {
		console.log(`Executing stop.`);
		process.exit(0);
	}, 1000);
})

main();