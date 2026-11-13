use near_sdk::env;
use near_sdk::near;
use near_sdk::serde_with::hex::Hex;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hash32(#[serde_as(as = "Hex")] pub [u8; 32]);

impl Hash32 {
    pub fn of(bytes: impl AsRef<[u8]>) -> Self {
        Self(env::sha256_array(bytes))
    }
}
