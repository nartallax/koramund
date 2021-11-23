import {Koramund} from "koramund";

export function errorAndExit(msg: string): never {
	console.error(msg);
	process.exit(1);
}
export function arrayOfMaybeArray<T>(x?: Koramund.RoArrayOrSingle<T>): ReadonlyArray<T> {
	return x === undefined? [] as ReadonlyArray<T>: Array.isArray(x)? x as ReadonlyArray<T>: [x as T];
}

export function isSignalShutdownSequenceItem(item: Koramund.ShutdownSequenceItem): item is Koramund.SignalShutdownSequenceItem {
	return !!(item as Koramund.SignalShutdownSequenceItem).signal;
}

export function isWaitShutdownSequenceItem(item: Koramund.ShutdownSequenceItem): item is Koramund.WaitShutdownSequenceItem {
	return typeof((item as Koramund.WaitShutdownSequenceItem).wait) === "number";
}

// just to check that k is keyof T
export function nameOf<T>(k: keyof T & string): keyof T & string {
	return k;
}

export function earlyExital(totalSleepTime: number, isDone: () => boolean, intervalLength = 1000): Promise<void>{
	return new Promise(ok => {
		
		function check(){
			if(isDone() || totalSleepTime <= 0){
				ok();
				return;
			}

			setTimeout(() => {
				totalSleepTime -= intervalLength;
				check();
			}, Math.min(totalSleepTime, intervalLength));
		}

		check();
	});
}

export function errMessage(e: unknown): string {
	return e instanceof Error? e.message || (e + ""): typeof(e) === "symbol"? e.toString(): e + ""
}