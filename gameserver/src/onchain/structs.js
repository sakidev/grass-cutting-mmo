const { BinaryReader, BinaryWriter, serialize, deserialize } = require('borsh');
const web3 = require('@solana/web3.js');
const BN = require('bn.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');

class OraclePriceState {
    static LEN = 8 + 8 + 8 + 8 + 1; // 33

    constructor(props) {
        this.discriminator                  = props.discriminator;
        this.sol_price_usd_micro_per_lamport = props.sol_price_usd_micro_per_lamport;
        this.skr_price_usd_micro_per_atom    = props.skr_price_usd_micro_per_atom;
        this.flapn_price_usd_micro_per_atom  = props.flapn_price_usd_micro_per_atom;
        this.bump                           = props.bump;
    }
}

const OraclePriceStateSchema = {
    struct: {
        discriminator:                   { array: { type: 'u8', len: 8 } },
        sol_price_usd_micro_per_lamport: 'u64',
        skr_price_usd_micro_per_atom:    'u64',
        flapn_price_usd_micro_per_atom:  'u64',
        bump:                            'u8'
    }
}

class CreateRankedGameStateInstruction {
    constructor(props){
        this.ranked_game_id = props.ranked_game_id;
        this.entry_fee = props.entry_fee;
    }
}

const CreateRankedGameStateInstructionSchema = {
    struct: {
        ranked_game_id: { array: { type: 'u8', len: 32 } },
        entry_fee: 'u64'
    }
}

class RankedGameState {
    static LEN = 8 + 32 + 8 + 4 + 1 + 1;

    constructor(props){
        this.discriminator = props.discriminator;
        this.ranked_game_id = props.ranked_game_id;
        this.entry_fee = props.entry_fee;
        this.participant_count = props.participant_count;
        this.status = props.status;
        this.bump = props.bump;
    }
}

const RankedGameStateSchema = {
    struct: {
        discriminator: { array: { type: 'u8', len: 8 } },
        ranked_game_id: { array: { type: 'u8', len: 32 } },
        entry_fee: 'u64',
        participant_count: 'u32',
        status: 'u8',
        bump: 'u8',
    }
}

class ParticipantState {
    static LEN = 8 + 32 + 32 + 8 + 1 + 1;

    constructor(props){
        this.discriminator = props.discriminator;
        this.user = props.user;
        this.ranked_game_pubkey = props.ranked_game_pubkey;
        this.deposited = props.deposited;
        this.payment_token = props.payment_token;
        this.bump = props.bump;
    }
}

const ParticipantStateSchema = {
    struct: {
        discriminator: { array: { type: 'u8', len: 8 } },
        user: { array: { type: 'u8', len: 32 } },
        ranked_game_pubkey: { array: { type: 'u8', len: 32 } },
        deposited: 'u64',
        payment_token: 'u8',
        bump: 'u8'
    }
}

// Custom string deserialization for Borsh
// This is needed because Borsh in JS requires special handling for strings
function deserializeString(reader) {
    try{
        const textDecoder = new TextDecoder('utf-8');
        const strLen = reader.readU32();
        const bytes = reader.readFixedArray(strLen);
        return textDecoder.decode(Buffer.from(bytes));
    }
    catch(err){
        console.log("[ORACLE] Error deserializing string:", err);
        return "";
    }
}

async function deserializeRankedGameState(pubkey, data)
{
    let deserialized;

    try{
        deserialized = deserialize(
            RankedGameStateSchema,
            data
        );

        // Get the ATA balances for this ranked game to populate the pot sizes for each token
        const skrATA = await getAssociatedTokenAddress(
            new web3.PublicKey(global.main.supportedTokens[1]),
            pubkey,
            true
        );
        const flapnATA = await getAssociatedTokenAddress(
            new web3.PublicKey(global.main.supportedTokens[2]),
            pubkey,
            true
        );
        const usdcATA = await getAssociatedTokenAddress(
            new web3.PublicKey(global.main.supportedTokens[3]),
            pubkey,
            true
        );

        let skrATABalance = 0;
        let flapnATABalance = 0;
        let usdcATABalance = 0;

        try{
            [skrATABalance, flapnATABalance, usdcATABalance] = await Promise.all([
                global.main.oracle.connection.getTokenAccountBalance(skrATA).then(res => res.value.uiAmount || 0).catch(() => 0),
                global.main.oracle.connection.getTokenAccountBalance(flapnATA).then(res => res.value.uiAmount || 0).catch(() => 0),
                global.main.oracle.connection.getTokenAccountBalance(usdcATA).then(res => res.value.uiAmount || 0).catch(() => 0)
            ]);
        }catch(err)
        {
            return await deserializeRankedGameState(pubkey, data); // Retry deserialization if fetching balances fails, as it could be a transient issue with the connection
        }

        // Deserialize everything UI readable from buffer to utf8 strings and numbers
        deserialized = {
            discriminator: Buffer.from(deserialized.discriminator).toString('utf8'),
            ranked_game_id: Buffer.from(deserialized.ranked_game_id).toString('utf8').replace(/\x00/g, ''), // Remove padding null bytes
            entry_fee: new BN(deserialized.entry_fee).toNumber() / 100,
            participant_count: deserialized.participant_count,
            status: deserialized.status,
            bump: deserialized.bump,
            skr_pot: skrATABalance,
            flapn_pot: flapnATABalance,
            usdc_pot: usdcATABalance
        };

        // Get the lamports sitting in the Ranked Game State PDA
        // to konow how big the pot currently is
        const rankedGameId = Buffer.alloc(32);
        Buffer.from(deserialized.ranked_game_id, "utf8").copy(rankedGameId);
        const rankedGamePDA = global.main.oracle.getRankedGamePDA(rankedGameId)[0];
        let accountInfo;
        try{
            accountInfo = await global.main.oracle.connection.getAccountInfo(rankedGamePDA);
            if(accountInfo)
            {
                deserialized.current_pot = lamportsToSOL(accountInfo.lamports);
            }
        }catch(err){
            return await deserializeRankedGameState(pubkey, data); // Retry deserialization if fetching account info fails, as it could be a transient issue with the connection
        }
    }
    catch(err){
        console.log("[ORACLE] Error deserializing RankedGameState", err);
        return null;
    }

    return deserialized;
}

function deserializeParticipantState(data)
{
    let deserialized;

    try{
        deserialized = deserialize(
            ParticipantStateSchema,
            data
        );

        // Deserialize everything UI readable from buffer to utf8 strings and numbers
        deserialized = {
            discriminator: Buffer.from(deserialized.discriminator).toString('utf8'),
            user: new web3.PublicKey(Buffer.from(deserialized.user)).toString(),
            ranked_game_pubkey: new web3.PublicKey(Buffer.from(deserialized.ranked_game_pubkey)).toString(),
            deposited: new BN(deserialized.deposited).toNumber() / web3.LAMPORTS_PER_SOL,
            payment_token: deserialized.payment_token,
            bump: deserialized.bump
        };
    }
    catch{
        console.log("[ORACLE] Error deserializing ParticipantState");
        return null;
    }

    const participantState = new ParticipantState(deserialized);
    return participantState;
}

function deserializeOraclePriceState(data) {
    let deserialized;

    try {
        deserialized = deserialize(OraclePriceStateSchema, data);

        deserialized = {
            discriminator:                   Buffer.from(deserialized.discriminator).toString('utf8'),
            // These are stored as micro-USD per base unit (u64 via BN).
            // Keep as raw numbers — callers can divide as needed for display.
            sol_price_usd_micro_per_lamport: new BN(deserialized.sol_price_usd_micro_per_lamport).toNumber(),
            skr_price_usd_micro_per_atom:    new BN(deserialized.skr_price_usd_micro_per_atom).toNumber(),
            flapn_price_usd_micro_per_atom:  new BN(deserialized.flapn_price_usd_micro_per_atom).toNumber(),

            // Human-readable USD prices
            // sol: micro_usd_per_lamport * 1_000_000_000 (lamports/SOL) / 1_000_000 (micro-USD/USD)
            //    = micro_usd_per_lamport * 1000
            sol_price_usd:   new BN(deserialized.sol_price_usd_micro_per_lamport).toNumber() / 1_000_000,

            // spl tokens with 6 decimals (SKR, FLAPN, USDC):
            // micro_usd_per_atom * 1_000_000 (atoms/token) / 1_000_000 (micro-USD/USD)
            //    = micro_usd_per_atom  (the 1e6s cancel out)
            skr_price_usd:   new BN(deserialized.skr_price_usd_micro_per_atom).toNumber() / 1_000_000,
            flapn_price_usd: new BN(deserialized.flapn_price_usd_micro_per_atom).toNumber() / 1_000_000,
            bump:                            deserialized.bump
        };
    } catch (err) {
        console.log("[ORACLE] Error deserializing OraclePriceState:", err);
        return null;
    }

    return deserialized;
}

function lamportsToSOL(lamports) {
    return lamports / web3.LAMPORTS_PER_SOL;
}

module.exports = {
    CreateRankedGameStateInstruction,
    CreateRankedGameStateInstructionSchema,
    ParticipantStateSchema,
    deserializeString,
    deserializeRankedGameState,
    deserializeOraclePriceState,
    lamportsToSOL,
    RankedGameState,
    RankedGameStateSchema,
    deserializeParticipantState
}