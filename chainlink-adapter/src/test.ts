/**
 * Test script for the Chainlink External Adapter
 * Run with: npm test
 */
import axios from "axios";

const ADAPTER_URL = process.env.ADAPTER_URL || "http://localhost:8080";

async function testAdapter() {
  console.log("Testing Chainlink External Adapter...\n");
  console.log(`Adapter URL: ${ADAPTER_URL}\n`);

  // Test 1: Health check
  console.log("1. Health Check");
  try {
    const health = await axios.get(`${ADAPTER_URL}/health`);
    console.log("   ✓ Status:", health.data.status);
  } catch (e: any) {
    console.log("   ✗ Failed:", e.message);
  }

  // Test 2: Info endpoint
  console.log("\n2. Info Endpoint");
  try {
    const info = await axios.get(ADAPTER_URL);
    console.log("   ✓ Name:", info.data.name);
    console.log("   ✓ Version:", info.data.version);
  } catch (e: any) {
    console.log("   ✗ Failed:", e.message);
  }

  // Test 3: JSON format (default)
  console.log("\n3. Adapter Request (format: json)");
  try {
    const response = await axios.post(ADAPTER_URL, {
      id: "test-job-1",
      data: { format: "json" },
    });
    console.log("   ✓ JobRunID:", response.data.jobRunID);
    console.log("   ✓ Status:", response.data.statusCode);
    console.log("   ✓ Hash:", response.data.data.hash);
    console.log("   ✓ Certificate count:", response.data.data.kidCount);
    console.log("   ✓ KIDs:", Object.keys(response.data.data.result.certificates));
  } catch (e: any) {
    console.log("   ✗ Failed:", e.message);
  }

  // Test 4: Hash format
  console.log("\n4. Adapter Request (format: hash)");
  try {
    const response = await axios.post(ADAPTER_URL, {
      id: "test-job-2",
      data: { format: "hash" },
    });
    console.log("   ✓ Result (hash):", response.data.data.result);
  } catch (e: any) {
    console.log("   ✗ Failed:", e.message);
  }

  // Test 5: Bytes format
  console.log("\n5. Adapter Request (format: bytes)");
  try {
    const response = await axios.post(ADAPTER_URL, {
      id: "test-job-3",
      data: { format: "bytes" },
    });
    const bytesResult = response.data.data.result;
    console.log("   ✓ Result (bytes):", bytesResult.slice(0, 50) + "...");
    console.log("   ✓ Byte length:", (bytesResult.length - 2) / 2, "bytes");
  } catch (e: any) {
    console.log("   ✗ Failed:", e.message);
  }

  console.log("\n✅ All tests completed!");
}

testAdapter().catch(console.error);
