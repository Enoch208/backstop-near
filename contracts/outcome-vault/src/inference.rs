use near_sdk::serde_with::DisplayFromStr;
use near_sdk::{env, near, require};

use crate::errors::{
    ERR_INFERENCE_FORMAT, ERR_INFERENCE_MODEL, ERR_INFERENCE_SIGNATURE, ERR_UNKNOWN_TEE_SIGNER,
};
use crate::events;
use crate::hash::Hash32;
use crate::{OutcomeVault, OutcomeVaultExt};

const MAX_SIGNED_TEXT: usize = 512;
const MAX_MODEL: usize = 128;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TeeSigner {
    pub model: String,
    pub attestation_hash: Hash32,
    #[serde_as(as = "DisplayFromStr")]
    pub registered_at_ns: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InferenceReceipt {
    pub signed_text: String,
    pub signature: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Inference {
    pub task_id: String,
    pub attempt: u32,
    pub model: String,
    pub request_hash: Hash32,
    pub response_hash: Hash32,
    pub signer: String,
    pub artifact_hash: Hash32,
}

struct SignedText {
    model: Option<String>,
    request_hash: Hash32,
    response_hash: Hash32,
}

fn nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => env::panic_str(ERR_INFERENCE_FORMAT),
    }
}

fn hex_bytes(text: &str) -> Vec<u8> {
    require!(text.len().is_multiple_of(2), ERR_INFERENCE_FORMAT);
    text.as_bytes()
        .chunks(2)
        .map(|pair| (nibble(pair[0]) << 4) | nibble(pair[1]))
        .collect()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hash32(text: &str) -> Hash32 {
    let bytes: [u8; 32] = hex_bytes(text)
        .try_into()
        .unwrap_or_else(|_| env::panic_str(ERR_INFERENCE_FORMAT));
    Hash32(bytes)
}

fn parse_text(text: &str) -> SignedText {
    require!(text.len() <= MAX_SIGNED_TEXT, ERR_INFERENCE_FORMAT);
    let parts: Vec<&str> = text.split(':').collect();
    match parts.as_slice() {
        [model, request, response] => SignedText {
            model: Some((*model).to_string()),
            request_hash: hash32(request),
            response_hash: hash32(response),
        },
        [request, response] => SignedText {
            model: None,
            request_hash: hash32(request),
            response_hash: hash32(response),
        },
        _ => env::panic_str(ERR_INFERENCE_FORMAT),
    }
}

pub fn normalize_address(address: &str) -> String {
    let lower = address.to_ascii_lowercase();
    let body = lower
        .strip_prefix("0x")
        .unwrap_or_else(|| env::panic_str(ERR_INFERENCE_FORMAT));
    require!(
        body.len() == 40 && body.bytes().all(|byte| byte.is_ascii_hexdigit()),
        ERR_INFERENCE_FORMAT
    );
    lower
}

pub fn recover_signer(text: &str, signature: &str) -> String {
    let bytes = hex_bytes(signature.strip_prefix("0x").unwrap_or(signature));
    require!(bytes.len() == 65, ERR_INFERENCE_SIGNATURE);
    let v = match bytes[64] {
        0 | 27 => 0,
        1 | 28 => 1,
        _ => env::panic_str(ERR_INFERENCE_SIGNATURE),
    };
    let message = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let digest = env::keccak256_array(message.as_bytes());
    let key = env::ecrecover(&digest, &bytes[..64], v, true)
        .unwrap_or_else(|| env::panic_str(ERR_INFERENCE_SIGNATURE));
    format!("0x{}", to_hex(&env::keccak256_array(key)[12..]))
}

pub fn inference_key(task_id: &str, attempt: u32) -> String {
    format!("{task_id}:{attempt}")
}

#[near]
impl OutcomeVault {
    pub fn register_tee_signer(
        &mut self,
        address: String,
        model: String,
        attestation_hash: Hash32,
    ) {
        self.require_owner();
        require!(
            !model.is_empty() && model.len() <= MAX_MODEL && !model.contains(':'),
            ERR_INFERENCE_FORMAT
        );
        let address = normalize_address(&address);
        let signer = TeeSigner {
            model,
            attestation_hash,
            registered_at_ns: env::block_timestamp(),
        };
        self.tee_signers.insert(address.clone(), signer.clone());
        events::tee_signer_registered(&address, &signer);
    }

    pub fn revoke_tee_signer(&mut self, address: String) {
        self.require_owner();
        let address = normalize_address(&address);
        require!(
            self.tee_signers.remove(&address).is_some(),
            ERR_UNKNOWN_TEE_SIGNER
        );
        events::tee_signer_revoked(&address);
    }

    pub fn get_tee_signer(&self, address: String) -> Option<TeeSigner> {
        self.tee_signers.get(&address.to_ascii_lowercase()).cloned()
    }

    pub fn get_inference(&self, task_id: String, attempt: u32) -> Option<Inference> {
        self.inferences
            .get(&inference_key(&task_id, attempt))
            .cloned()
    }
}

impl OutcomeVault {
    pub(crate) fn attest_inference(
        &mut self,
        task_id: &str,
        attempt: u32,
        artifact_hash: Hash32,
        receipt: &InferenceReceipt,
    ) -> Inference {
        let text = parse_text(&receipt.signed_text);
        let signer = recover_signer(&receipt.signed_text, &receipt.signature);
        let registered = self
            .tee_signers
            .get(&signer)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_TEE_SIGNER));
        if let Some(model) = &text.model {
            require!(model == &registered.model, ERR_INFERENCE_MODEL);
        }
        let inference = Inference {
            task_id: task_id.to_string(),
            attempt,
            model: registered.model,
            request_hash: text.request_hash,
            response_hash: text.response_hash,
            signer,
            artifact_hash,
        };
        self.inferences
            .insert(inference_key(task_id, attempt), inference.clone());
        inference
    }
}
