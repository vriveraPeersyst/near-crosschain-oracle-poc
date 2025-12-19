/**
 * Local simulation of the Chainlink Functions source code
 * This helps test the JavaScript before deploying to the network
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock the Functions global object that Chainlink provides
const Functions = {
  makeHttpRequest: async (config: { url: string }) => {
    const response = await fetch(config.url);
    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }
    return { data: await response.json() };
  },
  encodeString: (str: string) => {
    return new TextEncoder().encode(str);
  },
};

// Make Functions available globally for the eval
(globalThis as any).Functions = Functions;

async function simulate() {
  console.log("🔧 Simulating Chainlink Functions source...\n");

  // Read the source file
  const sourcePath = path.join(__dirname, "../source.js");
  let source = fs.readFileSync(sourcePath, "utf8");

  // Wrap in async IIFE for evaluation
  const wrappedSource = `(async () => {
${source}
})()`;

  try {
    const result = await eval(wrappedSource);
    
    console.log("✅ Simulation successful!\n");
    console.log("📦 Result type:", typeof result);
    console.log("📦 Result length:", result.length, "bytes");
    
    // Decode result
    const decoded = new TextDecoder().decode(result);
    const parsed = JSON.parse(decoded);
    
    console.log("\n📄 Decoded result:");
    console.log(JSON.stringify(parsed, null, 2));
    
    console.log("\n📊 Summary:");
    console.log("   Timestamp:", new Date(parsed.timestamp * 1000).toISOString());
    console.log("   Key count:", parsed.count);
    for (const key of parsed.keys) {
      console.log(`\n   Key ID: ${key.kid}`);
      console.log(`   Modulus (n): ${key.n.substring(0, 64)}...`);
      console.log(`   Modulus length: ${key.n.length / 2} bytes (${key.n.length / 2 * 8} bits)`);
      console.log(`   Exponent (e): ${key.e} (= ${parseInt(key.e, 16)})`);
    }
    
    return result;
  } catch (error) {
    console.error("❌ Simulation failed:", error);
    process.exit(1);
  }
}

simulate().catch(console.error);
