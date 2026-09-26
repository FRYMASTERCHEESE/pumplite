//! Immutable fungible metadata CPI. Wire layout follows Metaplex CreateMetadataAccountV3.
//! Reference: mpl-token-metadata clients/rust/src/generated/instructions/create_metadata_account_v3.rs.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
pub const ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

pub fn create<'info>(
    metadata: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    system: AccountInfo<'info>,
    program: AccountInfo<'info>,
    name: &str,
    symbol: &str,
    uri: &str,
    seeds: &[&[u8]],
) -> Result<()> {
    let mut data = vec![33u8];
    name.to_string().serialize(&mut data)?;
    symbol.to_string().serialize(&mut data)?;
    uri.to_string().serialize(&mut data)?;
    // DataV2: no royalties, creators, collection or uses. Immutable; no collection details.
    data.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0]);
    let ix = Instruction {
        program_id: ID,
        accounts: vec![
            AccountMeta::new(*metadata.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new_readonly(*authority.key, true),
            AccountMeta::new(*payer.key, true),
            AccountMeta::new_readonly(*authority.key, true),
            AccountMeta::new_readonly(*system.key, false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            metadata,
            mint,
            authority.clone(),
            payer,
            authority,
            system,
            program,
        ],
        &[seeds],
    )?;
    Ok(())
}
