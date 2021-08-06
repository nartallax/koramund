// simple app that outputs a looooot of data to stdout when called by http
// for sake of test let's assume it is not under our control (i.e. we did not write its code)

const http = require("http");

let useStderr = process.argv[2] === "stderr";

async function handle(req, res){
	
	let output = useStderr? process.stderr: process.stdout;

	for(let i = 0; i < 1024 * 1024; i++){
		output.write("THIS IS A LINE! THERE ARE A LOT OF LINES HERE!")
	}
	res.writeHead(200);
	res.end("=^v^=");
}

async function main(){
	let server = http.createServer(handle);
	let port = 7836;
	server.listen(port, () => {
		useStderr? console.log("Started on port " + port): console.error("Started on port " + port);
	});
}

main();