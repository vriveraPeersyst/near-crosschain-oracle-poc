import { watchAndRelay } from "./relay.js";

console.log("Starting Wormhole → NEAR Relayer...");
watchAndRelay().catch(console.error);
