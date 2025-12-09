import express, { Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import { ethers } from "ethers";
import cron from "node-cron";
import "dotenv/config";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const GOOGLE_X509_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// Cron configuration
const CRON_ENABLED = process.env.CRON_ENABLED === "true";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 */6 * * *"; // Default: every 6 hours
const ARBITRUM_RPC_URL = process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EMITTER_ADDRESS = process.env.EMITTER_ADDRESS;

// GoogleCertEmitter ABI (only the function we need)
const EMITTER_ABI = [
  "function publishCertSnapshot(bytes calldata certsJson) external payable returns (uint64 sequence)",
  "function wormhole() external view returns (address)",
];

// Track last published hash to avoid duplicates
let lastPublishedHash = "";

/**
 * Chainlink External Adapter Response Format
 */
interface ChainlinkResponse {
  jobRunID: string;
  statusCode: number;
  data?: {
    result: any;
    [key: string]: any;
  };
  error?: string;
}

/**
 * Fetch Google X.509 certificates
 */
async function fetchGoogleCerts(): Promise<{
  certs: Record<string, string>;
  hash: string;
  timestamp: number;
}> {
  const response = await axios.get(GOOGLE_X509_URL);
  const certs = response.data as Record<string, string>;
  
  // Create a deterministic hash of the certificates
  const certJson = JSON.stringify(certs, Object.keys(certs).sort());
  const hash = crypto.createHash("sha256").update(certJson).digest("hex");
  
  return {
    certs,
    hash,
    timestamp: Date.now(),
  };
}

/**
 * Convert certs to bytes for on-chain storage
 * Returns ABI-encodable format
 */
function certsToBytes(certs: Record<string, string>): string {
  const json = JSON.stringify(certs);
  // Return as hex string (0x prefixed)
  return "0x" + Buffer.from(json).toString("hex");
}

/**
 * Main adapter endpoint
 * 
 * Chainlink nodes will POST to this endpoint with:
 * {
 *   "id": "job-run-id",
 *   "data": {
 *     "format": "json" | "hash" | "bytes"  // optional, default "json"
 *   }
 * }
 */
app.post("/", async (req: Request, res: Response) => {
  const jobRunID = req.body.id || "1";
  const format = req.body.data?.format || "json";

  console.log(`[${new Date().toISOString()}] Request: jobRunID=${jobRunID}, format=${format}`);

  try {
    const { certs, hash, timestamp } = await fetchGoogleCerts();
    const kidCount = Object.keys(certs).length;

    let result: any;

    switch (format) {
      case "hash":
        // Return just the hash (32 bytes) - cheapest on-chain
        result = hash;
        break;

      case "bytes":
        // Return hex-encoded JSON for direct on-chain storage
        result = certsToBytes(certs);
        break;

      case "json":
      default:
        // Return full structured data
        result = {
          certificates: certs,
          hash,
          timestamp,
          kidCount,
        };
        break;
    }

    const response: ChainlinkResponse = {
      jobRunID,
      statusCode: 200,
      data: {
        result,
        hash,
        timestamp,
        kidCount,
      },
    };

    console.log(`[${new Date().toISOString()}] Success: ${kidCount} certs, hash=${hash.slice(0, 16)}...`);
    res.status(200).json(response);

  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Error:`, error.message);

    const response: ChainlinkResponse = {
      jobRunID,
      statusCode: 500,
      error: error.message || "Failed to fetch Google certificates",
    };

    res.status(500).json(response);
  }
});

/**
 * Health check endpoint
 */
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: Date.now() });
});

/**
 * Info endpoint - describes the adapter
 */
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    name: "Google X.509 Certificate Adapter",
    description: "Fetches Google Firebase/Identity Platform X.509 certificates",
    version: "1.0.0",
    endpoints: {
      "POST /": "Main adapter endpoint (Chainlink compatible)",
      "GET /health": "Health check",
    },
    formats: {
      json: "Full certificate data with metadata",
      hash: "SHA256 hash of certificates (32 bytes)",
      bytes: "Hex-encoded JSON for on-chain storage",
    },
    source: GOOGLE_X509_URL,
  });
});

app.listen(PORT, () => {
  console.log(`Chainlink External Adapter running on port ${PORT}`);
  console.log(`Source: ${GOOGLE_X509_URL}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST http://localhost:${PORT}/        - Chainlink adapter`);
  console.log(`  GET  http://localhost:${PORT}/health  - Health check`);
  
  // Start cron scheduler if enabled
  if (CRON_ENABLED) {
    startCronScheduler();
  } else {
    console.log(`\nCron scheduler: DISABLED`);
    console.log(`  Set CRON_ENABLED=true to enable automatic publishing`);
  }
});

/**
 * Publish certificates to Arbitrum/Wormhole
 */
async function publishToWormhole(): Promise<{ txHash: string; sequence: number } | null> {
  if (!ARBITRUM_RPC_URL || !PRIVATE_KEY || !EMITTER_ADDRESS) {
    console.error("Missing config: ARBITRUM_RPC_URL, PRIVATE_KEY, or EMITTER_ADDRESS");
    return null;
  }

  try {
    // Fetch current certs
    const { certs, hash } = await fetchGoogleCerts();
    
    // Skip if certs haven't changed
    if (hash === lastPublishedHash) {
      console.log(`[CRON] Certificates unchanged (hash: ${hash.slice(0, 16)}...), skipping publish`);
      return null;
    }

    console.log(`[CRON] New certificates detected, publishing to Wormhole...`);

    // Connect to Arbitrum
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const emitter = new ethers.Contract(EMITTER_ADDRESS, EMITTER_ABI, wallet);

    // Prepare payload
    const certsJson = JSON.stringify(certs);
    const payload = ethers.toUtf8Bytes(certsJson);

    // Publish
    const tx = await emitter.publishCertSnapshot(payload);
    console.log(`[CRON] Transaction sent: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`[CRON] Confirmed in block ${receipt.blockNumber}`);

    // Extract sequence from logs
    let sequence = 0;
    for (const log of receipt.logs) {
      try {
        // Wormhole LogMessagePublished event
        if (log.topics[0] === "0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2") {
          sequence = parseInt(log.topics[1], 16);
          break;
        }
      } catch (e) {
        // Skip non-matching logs
      }
    }

    // Update last published hash
    lastPublishedHash = hash;

    console.log(`[CRON] Published! Sequence: ${sequence}, Hash: ${hash.slice(0, 16)}...`);
    
    return { txHash: tx.hash, sequence };
  } catch (error: any) {
    console.error(`[CRON] Error publishing:`, error.message);
    return null;
  }
}

/**
 * Start the cron scheduler
 */
function startCronScheduler() {
  console.log(`\nCron scheduler: ENABLED`);
  console.log(`  Schedule: ${CRON_SCHEDULE}`);
  console.log(`  Emitter: ${EMITTER_ADDRESS}`);
  console.log(`  RPC: ${ARBITRUM_RPC_URL?.slice(0, 30)}...`);

  // Validate cron expression
  if (!cron.validate(CRON_SCHEDULE)) {
    console.error(`Invalid cron schedule: ${CRON_SCHEDULE}`);
    return;
  }

  // Schedule the job
  cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`\n[CRON] ${new Date().toISOString()} - Running scheduled job...`);
    await publishToWormhole();
  });

  console.log(`\nCron job scheduled. Next runs based on: ${CRON_SCHEDULE}`);
  console.log(`  Example schedules:`);
  console.log(`    "0 */6 * * *"   = Every 6 hours`);
  console.log(`    "0 0 * * *"     = Daily at midnight`);
  console.log(`    "*/30 * * * *"  = Every 30 minutes`);
  console.log(`    "0 */1 * * *"   = Every hour`);

  // Run immediately on startup if requested
  if (process.env.CRON_RUN_ON_STARTUP === "true") {
    console.log(`\n[CRON] Running initial publish on startup...`);
    publishToWormhole();
  }
}

/**
 * Manual trigger endpoint
 */
app.post("/publish", async (_req: Request, res: Response) => {
  console.log(`[MANUAL] Publish triggered via API`);
  
  const result = await publishToWormhole();
  
  if (result) {
    res.status(200).json({
      success: true,
      txHash: result.txHash,
      sequence: result.sequence,
    });
  } else {
    res.status(200).json({
      success: false,
      message: "No changes to publish or error occurred",
    });
  }
});
