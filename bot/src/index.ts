import { fetchGoogleCerts, publishSnapshot } from "./publish-snapshot.js";
import "dotenv/config";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "3600000"); // Default: 1 hour

async function main() {
  console.log("Google Cert Oracle Bot starting...");
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000 / 60} minutes`);

  let lastCerts = "";

  while (true) {
    try {
      console.log("\n--- Checking for cert updates ---");
      const currentCerts = await fetchGoogleCerts();

      if (currentCerts !== lastCerts) {
        console.log("Certificates changed, publishing new snapshot...");
        const { txHash, sequence } = await publishSnapshot();
        console.log(`Published! Tx: ${txHash}, Sequence: ${sequence}`);
        lastCerts = currentCerts;
      } else {
        console.log("No changes detected, skipping publish.");
      }
    } catch (error) {
      console.error("Error during poll:", error);
    }

    console.log(`Sleeping for ${POLL_INTERVAL_MS / 1000 / 60} minutes...`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch(console.error);
