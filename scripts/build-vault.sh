#!/bin/sh
set -e
cd "$(dirname "$0")/../contracts/outcome-vault"
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
rustup_home="${RUSTUP_HOME:-$HOME/.rustup}"
RUSTFLAGS="--cfg near --remap-path-prefix=$cargo_home=/cargo --remap-path-prefix=$rustup_home=/rustup --remap-path-prefix=$(pwd)=/vault" \
  cargo build --target wasm32-unknown-unknown --release --locked
wasm=target/wasm32-unknown-unknown/release/outcome_vault.wasm
hash=$(shasum -a 256 "$wasm" 2>/dev/null | cut -d' ' -f1 || sha256sum "$wasm" | cut -d' ' -f1)
printf '%s  outcome_vault.wasm\n' "$hash"
