# Koramund

Koramund is the library that will help you to write your metaproject.  
What is metaproject? Well, when you develop a system that consists of more than one project - say you have backend project, two frontend app-projects, some external server that supplies you with data - at some point you will start to juggle them. That is, you will need to start the compiler(s) for the projects, bundle them when you need to, start and restart backend and other programs, and so on.  
And it's the time when you need metaproject. Metaproject is the project that herds other projects, doing all of the above and more.  
It meant to be used along with Typescript, [Imploder](https://github.com/nartallax/imploder "Imploder"), and was written with HTTP apps in mind, but have more uses than just that.  

Compatibility notice: this project is Linux-centric and NOT 100% compatible with Windows. Some things won't work as expected. That things are graceful shutdown and shutdown sequences, as they are difficult to get right in Windows.  
Other than that it should work.  

## Installation

	npm install --save-dev typescript
	npm install --save-dev tslib
	npm install --save-dev @nartallax/koramund

Note that typescript and tslib are peer dependencies. That is, whatever version is installed will be used.  
Imploder is not peer dependency and is included in tool.  
Multiple versions of typescript/tslib/Imploder for different controlled projects are not supported.  

## Usage

Before we start - you may want to explore [type definitions](ts/src/types.ts) on your own. They are thoroughly commented and therefore can be used as documentation.

### Project controller

Central point of the lib is the Project Controller. It allows you to define the projects.  
So first thing you need to do is create one:  

	import {Koramund} from "@nartallax/koramund";

	let controller = Koramund.create({
		log: opts => {
			console.error(`${opts.paddedProjectName} | ${opts.message}`)
		}
	});

All the messages from projects and the tool itself will go into log function you provide.  

### Defining the projects

Next step is to define the projects you want to control. This is done with ProjectController.addProject(...).  
Depending on what options you will pass, created project will have different capacities. Most of the options are compatible; that means you can mix different types of project and get capacities of both.
Some projects also expose async events. Those are events that will wait for all the handlers to asynchronously complete before continuing. It's not always applicable, as in some events there is no following action expected, like onStderr. But sometimes this gives opportunity to easily control the processes, see examples below.  
Let's look over available project types:

#### Base project

This is the very base of any project. It could not actually do much, it's just there.  
But it is a base for other types of project.

	let justProject = controller.addProject({
		// mandatory args:
		// a name of project. will be used in logs.
		name: "Just Project",
		// optional args:
		// a working directory of project. sometimes is inferred, but not always.
		workingDirectory: "./project/just_project/"
	});

Base project has `justProject.shell`, that allows you to easily launch external processes in project workingDirectory, and some other less-useful properties, look it up in [type definitions](ts/src/types.ts).  

#### Launchable project

This is the project that could be launched. Note that it does not imply that you have source code of the project.  

	let myLaunchableProject = controller.addProject({
		name: "OSRM",
		workingDirectory: "../osrm/"

		// mandatory args:
		// a function that forms launch command arguments
		// first value in array must point to executable, the rest are command-line arguments
		getLaunchCommand: () => ["./osrm-backend/build/osrm-routed", "data.osrm", "-i", "127.0.0.1", "-p", "57445"])],
		// optional args:
		dropStderr: false, // ignore stderr entirely
		dropStdout: false, // ignore stdout entirely
		// how should the project be shut down when stop is requested.
		// available actions are "send signal" and "wait before sending next signal".
		// if project will exit before shutdown sequence completes, the rest of it will be dropped.
		shutdownSequence: [
			{signal: "SIGINT"},
			{wait: 500},
			{signal: "SIGINT"},
			{wait: 500},
			{signal: "SIGINT"}
		]
		
	});

Launchable projects has `start()`, `stop()` and `restart()` methods, self-explanatory.  
Also it has `notifyLaunched()` method. Thing is, project is not really launched at the moment of process start; most of the time project need to do some startup actions, like launch an HTTP server, connect to DB, whatever else; and by calling this method we can notify the project that it is fully started.  
They also have events! Remember to look them up in [type definitions](ts/src/types.ts). Or look below for examples.  

#### HTTP proxifyable project

This is launchable project that has HTTP API.  
The lib can setup an HTTP proxy for that project that will allow you to handle HTTP-related events.  
The common use-case is: you pass the port that project is usually launched on as proxy port, make project acquire another port (presumably random) and later tell the project (through `notifyProjectHttpPort()`) about the port it acquired. After that all requests to proxy will be passed to the project.  
Proxy is always started before the project start, so you don't always need to start it manually.  
Also proxy will always wait for project to start before passing the request, or even initiate the start of it. See lazy start example below.  

	let summator = controller.addProject({
		name: "Summator",
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, "./summator/summator.js"]
		},
		
		// mandatory parameters:
		// port on which proxy will start on
		proxyHttpPort: JSON.parse((await Fs.readFile(testPath("summator/summator_config.json"), "utf-8"))).http.api_endpoint.port,

		// optional parameters:
		// connect+read timeout for proxy requests to the project process (msec)
		proxyTimeout: 60000
	});

Note that through the proxy will work fine when everything is going smoothly, it cannot mimic all the strange ways your project can fail. That is, you should not rely that proxy behaves in cases of disconnects or some other bad events exactly as your app (especially when talking about websockets). So when testing for such events you should call the project directly without proxy; for that reason, `getProjectHttpPort()` method exists.  

#### Imploder project

This is Typescript project that is built with [Imploder](https://github.com/nartallax/imploder "Imploder").  

	let summator = controller.addProject({
		name: "Summator",

		// this project could be non-launchable; so following two parameters are not really required
		getLaunchCommand: (): string[] => {
			return [controller.nodePath, summator.getImploder().config.outFile]
		},
		proxyHttpPort: JSON.parse((await Fs.readFile(testPath("summator/summator_config.json"), "utf-8"))).http.api_endpoint.port,

		// mandatory params:
		// a path to tsconfig.json that has Imploder configuration part
		imploderTsconfigPath: testPath("./summator/tsconfig.json"),
		
		// optional params:
		// name of Imploder profile that will be used in the builds
		imploderProfile: "dev"
	});

Note that through Imploder projects exposes `build()` method, it is always invoked before project is started (if it is launchable). So you almost never need to call this method explicitly.  
`build()` also can be used to launch Imploder in watch-mode, if Imploder is configured to do so in selected profile.  

### Wireup

The next thing you should do after you defined all the projects is to wire them up. That means installing various handlers for exposed events of the projects. This is the stage when you actually tell projects how they should be compiled, started, restarted, and so on.  

	// let's listen to stderr output of our project.
	summator.onStderr(line => {
		let portMatch = line.match(/Started on port (\d+)/);
		if(portMatch){
			// in this line our project tells us that it is fully launched.
			// lets tell the proxy what port the project is launched on. note that the port can be different every time:
			summator.notifyProjectHttpPort(parseInt(portMatch[1]));

			// then let's tell the project that it's startup is completed
			// otherwise summator.start() will never return, as it is waiting for this method call
			summator.notifyLaunched();
		}
	});

	// let's listen for http requests to our projects
	// note that this event is provided by HTTP proxy. without proxy it's not possible to intercept the requests
	summator.onHttpRequest(async req => {
		// let's restart the project if this request is made to specific URL path
		if(req.method === "DELETE" && req.url.match(/^\/restart_on_delete(?:$|\/|\?)/)){
			await summator.restart();
			// note the await in the line above
			// at the time of restart() call, request to the project process is yet to be made
			// proxy will wait for handler to complete before passing the request to the project process
			// so the process will handle the request after it's restart
			return;
		}

		// another option is to read the body completely
		// it's not recommended as it could hurt performance
		let body = await req.getBody();
		if(JSON.parse(body.toString("utf-8")).doRestart === true){
			await summator.restart();
		}
	});

	summator.onBuildFinished(async result => {
		if(result.success){
			// on each successful build, let's copy result bundle to some other place
			await Fs.copyFile(testPath("summator/js/bundle.js"), testPath("summator/result.js"))
		}
	})

	osrm.onStop(stop => {
		if(!stop.expected){
			// if the project stop was not initiated by stop() or restart() - start the project
			// (that implies process crash)
			await osrm.start();
		}
	});

	osrm.onProcessCreated(() => {
		// if we have absolutely no other way of telling if the project is launched - 
		// we could just wait for some time after process is created and consider it launched
		setTimeout(() => osrm.notifyLaunched(), 1000)
	});

### Launch

After all definition is completed, we can do something with the projects.  

	// launchable projects could be just started
	await osrm.start();

	// HTTP proxifyable projects could be just started
	// alternatively you can start HTTP proxy that will start actual process on first request
	// this is the way lazy start could be implemented
	// and you are encouraged to do it this way, because 
	// it will help avoid port number collision between hand-chosen port numbers and random port numbers
	await summator.startHttpProxy();

	// here we have frontend project
	// it is Imploder project, but it could not be launched, as it is expected to work in browser
	// so we just launching the Imploder here. it will start in watch mode 
	// (because we configured it in tsconfig.json that way)
	await frontend.build();

	// alternatively you can just build all the projects
	// it should be useful when you building everything for release
	await controller.buildAll();

### Naming

Koramund is originally a name of Carrier class battleship that manages multiple lesser interceptor ships, resembling the tool in some way.  
