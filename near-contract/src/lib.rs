use near_sdk::{env, near, AccountId, PanicOnDefault, Promise, Gas, NearToken, PromiseError};

/// Wormhole chain ID for Arbitrum Sepolia testnet
const WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA: u16 = 10003;

/// Wormhole Core contract on NEAR testnet
const WORMHOLE_CONTRACT: &str = "wormhole.wormhole.testnet";

/// Gas for cross-contract call to verify VAA
const GAS_FOR_VERIFY: Gas = Gas::from_tgas(50);

/// Gas for callback
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(50);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct GoogleCertOracle {
    owner: AccountId,
    last_snapshot: String,
    last_update_ts: u64,
    /// Trusted emitter address (32 bytes hex, left-padded Ethereum address)
    trusted_emitter: String,
    snapshot_count: u64,
    /// Track processed VAA hashes to prevent replay
    processed_vaas: Vec<String>,
}

/// VAA body structure (after signatures)
/// Offset 0:  timestamp (4 bytes)
/// Offset 4:  nonce (4 bytes)  
/// Offset 8:  emitter_chain (2 bytes)
/// Offset 10: emitter_address (32 bytes)
/// Offset 42: sequence (8 bytes)
/// Offset 50: consistency_level (1 byte)
/// Offset 51: payload (variable)
struct ParsedVaaBody {
    emitter_chain: u16,
    emitter_address: String,
    sequence: u64,
    payload: Vec<u8>,
}

fn parse_vaa_body(vaa_hex: &str) -> ParsedVaaBody {
    let vaa_bytes = hex::decode(vaa_hex).expect("Invalid VAA hex");
    
    // VAA header is 6 bytes, then signatures
    // Header: version (1) + guardian_set_index (4) + num_signatures (1)
    let num_signatures = vaa_bytes[5] as usize;
    let body_offset = 6 + (num_signatures * 66);
    
    assert!(vaa_bytes.len() > body_offset + 51, "VAA too short");
    
    let body = &vaa_bytes[body_offset..];
    
    // Parse emitter chain (2 bytes at offset 8)
    let emitter_chain = u16::from_be_bytes([body[8], body[9]]);
    
    // Parse emitter address (32 bytes at offset 10)
    let emitter_address = hex::encode(&body[10..42]);
    
    // Parse sequence (8 bytes at offset 42)
    let sequence = u64::from_be_bytes([
        body[42], body[43], body[44], body[45],
        body[46], body[47], body[48], body[49]
    ]);
    
    // Payload starts at offset 51
    let payload = body[51..].to_vec();
    
    ParsedVaaBody {
        emitter_chain,
        emitter_address,
        sequence,
        payload,
    }
}

#[near]
impl GoogleCertOracle {
    #[init]
    pub fn new(owner: AccountId, trusted_emitter: String) -> Self {
        // Normalize trusted emitter to lowercase
        let normalized_emitter = trusted_emitter.to_lowercase().replace("0x", "");
        // Pad to 32 bytes (64 hex chars) with leading zeros
        let padded_emitter = format!("{:0>64}", normalized_emitter);
        
        Self {
            owner,
            last_snapshot: "{}".to_string(),
            last_update_ts: 0,
            trusted_emitter: padded_emitter,
            snapshot_count: 0,
            processed_vaas: Vec::new(),
        }
    }

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "Only owner can call this method"
        );
    }

    /// Submit a Wormhole VAA containing Google certificate snapshot.
    /// This will verify the VAA with wormhole.wormhole.testnet before accepting.
    /// 
    /// # Arguments
    /// * `vaa` - Hex-encoded VAA (without 0x prefix)
    pub fn submit_vaa(&mut self, vaa: String) -> Promise {
        // Parse VAA to extract emitter info before verification
        let parsed = parse_vaa_body(&vaa);
        
        // Verify emitter chain is Arbitrum Sepolia
        assert_eq!(
            parsed.emitter_chain,
            WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
            "Invalid emitter chain: expected {}, got {}",
            WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
            parsed.emitter_chain
        );
        
        // Verify emitter address matches trusted emitter
        assert_eq!(
            parsed.emitter_address.to_lowercase(),
            self.trusted_emitter.to_lowercase(),
            "Invalid emitter address"
        );
        
        // Check for replay (simple check - in production use a more efficient structure)
        let vaa_hash = hex::encode(env::keccak256(vaa.as_bytes()));
        assert!(
            !self.processed_vaas.contains(&vaa_hash),
            "VAA already processed"
        );
        
        env::log_str(&format!(
            "Verifying VAA: chain={}, emitter={}, sequence={}",
            parsed.emitter_chain,
            parsed.emitter_address,
            parsed.sequence
        ));
        
        // Call Wormhole contract to verify VAA signatures
        let wormhole_account: AccountId = WORMHOLE_CONTRACT.parse().unwrap();
        
        Promise::new(wormhole_account)
            .function_call(
                "verify_vaa".to_string(),
                format!("{{\"vaa\":\"{}\"}}", vaa).into_bytes(),
                NearToken::from_near(0),
                GAS_FOR_VERIFY,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_vaa_verified(vaa)
            )
    }

    /// Callback after Wormhole VAA verification
    #[private]
    pub fn on_vaa_verified(
        &mut self,
        vaa: String,
        #[callback_result] verification_result: Result<u32, PromiseError>,
    ) -> bool {
        match verification_result {
            Ok(guardian_set_index) => {
                env::log_str(&format!(
                    "VAA verified by guardian set {}",
                    guardian_set_index
                ));
                
                // Parse VAA and extract payload
                let parsed = parse_vaa_body(&vaa);
                
                // Convert payload to string (it's JSON)
                let snapshot_json = String::from_utf8(parsed.payload)
                    .expect("Invalid UTF-8 payload");
                
                // Validate JSON format
                let trimmed = snapshot_json.trim();
                assert!(
                    trimmed.starts_with('{') && trimmed.ends_with('}'),
                    "Invalid JSON format in payload"
                );
                
                // Mark VAA as processed
                let vaa_hash = hex::encode(env::keccak256(vaa.as_bytes()));
                self.processed_vaas.push(vaa_hash);
                
                // Update snapshot
                self.last_snapshot = snapshot_json;
                self.last_update_ts = env::block_timestamp_ms();
                self.snapshot_count += 1;
                
                env::log_str(&format!(
                    "Snapshot #{} submitted via Wormhole VAA at timestamp {}",
                    self.snapshot_count,
                    self.last_update_ts
                ));
                
                true
            }
            Err(_) => {
                env::log_str("VAA verification failed!");
                env::panic_str("Wormhole VAA verification failed");
            }
        }
    }

    /// Legacy method for owner-only submission (no Wormhole verification)
    /// Kept for testing purposes
    pub fn submit_snapshot(&mut self, snapshot_json: String) {
        self.assert_owner();
        
        let trimmed = snapshot_json.trim();
        assert!(
            trimmed.starts_with('{') && trimmed.ends_with('}'),
            "Invalid JSON format"
        );
        
        self.last_snapshot = snapshot_json;
        self.last_update_ts = env::block_timestamp_ms();
        self.snapshot_count += 1;
        
        env::log_str(&format!(
            "Snapshot #{} submitted (owner bypass) at timestamp {}",
            self.snapshot_count,
            self.last_update_ts
        ));
    }

    pub fn transfer_ownership(&mut self, new_owner: AccountId) {
        self.assert_owner();
        self.owner = new_owner;
    }

    pub fn set_trusted_emitter(&mut self, emitter: String) {
        self.assert_owner();
        // Normalize and pad emitter address
        let normalized = emitter.to_lowercase().replace("0x", "");
        self.trusted_emitter = format!("{:0>64}", normalized);
    }

    pub fn get_snapshot(&self) -> String {
        self.last_snapshot.clone()
    }

    pub fn get_last_update_ts(&self) -> u64 {
        self.last_update_ts
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_trusted_emitter(&self) -> String {
        self.trusted_emitter.clone()
    }

    pub fn get_snapshot_count(&self) -> u64 {
        self.snapshot_count
    }
    
    pub fn get_processed_vaa_count(&self) -> usize {
        self.processed_vaas.len()
    }
}
