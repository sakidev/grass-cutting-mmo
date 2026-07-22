const { Connection, PublicKey, clusterApiUrl, Keypair, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { BinaryReader, BinaryWriter, serialize, deserialize } = require('borsh');
const bs58 = require('bs58');
const { Buffer } = require('buffer');
const fs = require('fs');
const BN = require('bn.js');
const { makeDelay } = require("../utils.js");
const { 
    CreateRankedGameStateInstruction,
    CreateRankedGameStateInstructionSchema,
    ParticipantStateSchema,
    deserializeString,
    lamportsToSOL,
    RankedGameState,
    RankedGameStateSchema,
    deserializeRankedGameState,
    deserializeParticipantState,
    deserializeOraclePriceState
} = require("./structs.js");
const fetch = require('node-fetch');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getTokenMetadata, TOKEN_2022_PROGRAM_ID, getExtensionData, ExtensionType, unpackMint, getAccount, getMint, createTransferInstruction, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');


const programId = "FLAPaBdrFuNMEvYkGG4AypnfFj9neA5cdekvJtW3nZxH";

const flapnAdminKeys = JSON.parse(fs.readFileSync('./flapn_admin_keys.json', 'utf8'));
const FLAPN_ADMIN_KEYPAIR = Keypair.fromSecretKey(new Uint8Array(flapnAdminKeys));
const FLAPN_FEES_WALLET = new PublicKey("FLAPfupF9uda6Bsd4dyHexe4YoRKPc6RyGa69Yr76C7H");

let latestSlot = -1;

/*console.log(`
    [ORACLE] =========== INITIALIZING WITH
    FLAPN_ADMIN_KEYPAIR: ${FLAPN_ADMIN_KEYPAIR.publicKey.toBase58()} ===========
    FLAPN_FEES_WALLET: ${FLAPN_FEES_WALLET.toBase58()} ===========
`);*/

const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SEEKER_AUTHORITY = new PublicKey("GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4");

let connection;
if(isMainThread)
{
    connection = new Connection(
        global.main.PRODUCTION ? 
        "https://mainnet.helius-rpc.com/?api-key=4dc6729b-1e1d-4320-a72b-c94ce2ae0421"
        : "https://devnet.helius-rpc.com/?api-key=4dc6729b-1e1d-4320-a72b-c94ce2ae0421",
      "confirmed"
    );
}
else
{
    connection = new Connection(
        workerData.PRODUCTION ? 
        "https://mainnet.helius-rpc.com/?api-key=4dc6729b-1e1d-4320-a72b-c94ce2ae0421"
        : "https://devnet.helius-rpc.com/?api-key=4dc6729b-1e1d-4320-a72b-c94ce2ae0421",
      "confirmed"
    );
}

setInterval(async () => {
    // Get the latest slot
    try{
        const slot = await connection.getSlot("processed");
        if(slot > latestSlot)
        {
            latestSlot = slot;
        }
    }catch(err)
    {
        console.log("Error getting latest slot:", err);
    }
}, 1000);

const RANKED_GAMES_PUBKEYS_TO_CHECK = [];
function addRankedGameToCheck(rankedGameId)
{
    const rankedGamePDA = getRankedGamePDA(rankedGameId)[0];
    RANKED_GAMES_PUBKEYS_TO_CHECK.push(rankedGamePDA.toBase58());
}

function removeRankedGameToCheck(rankedGameId)
{
    const rankedGamePDA = getRankedGamePDA(rankedGameId)[0];
    const index = RANKED_GAMES_PUBKEYS_TO_CHECK.indexOf(rankedGamePDA.toString());
    if(index !== -1)
    {
        RANKED_GAMES_PUBKEYS_TO_CHECK.splice(index, 1);
    }
}

async function efficientlyIterateRankedGames()
{
    if(RANKED_GAMES_PUBKEYS_TO_CHECK.length === 0) return;

    console.log("========== Efficiently iterating ranked games on-chain, total to check:", RANKED_GAMES_PUBKEYS_TO_CHECK.length, "==========");
    // Get multiple ranked game accounts in a single RPC call,
    // the max is 100, so batch them in groups of 100 if needed
    const batchSize = 100;
    for(let i = 0; i < RANKED_GAMES_PUBKEYS_TO_CHECK.length; i += batchSize)
    {
        const batchPubkeys = RANKED_GAMES_PUBKEYS_TO_CHECK.slice(i, i + batchSize);
        let rankedGameAccounts;
        try
        {
            rankedGameAccounts = await connection.getMultipleAccountsInfo(batchPubkeys.map(pk => new PublicKey(pk)));
        }catch(err){
            return await efficientlyIterateRankedGames(); // Retry if fetching account info fails, as it could be a transient issue with the connection
            break;
        }

        for(let j = 0; j < rankedGameAccounts.length; j++)
        {
            const accountInfo = rankedGameAccounts[j];
            if(accountInfo)
            {
                const rankedGameState = await deserializeRankedGameState(new PublicKey(batchPubkeys[j]), accountInfo.data);

                if(rankedGameState.status !== 0)
                {
                    // If the ranked game state is not waiting for players
                    // just remove it from the list of ranked games to check, we don't care about it anymore
                    // as we only use this iteration to know the current pot size and participant count
                    console.log(`Ranked game with id ${rankedGameState.ranked_game_id} is no longer waiting for players, removing it from the check list`);
                    removeRankedGameToCheck(rankedGameState.ranked_game_id);
                }
                else
                {
                    // Find the ranked game object and update its pot size and participant count
                    const rankedGame = global.main.network.RankedGame.getById(rankedGameState.ranked_game_id);
                    if(rankedGame){
                        // Get the solana pot from native lamports
                        rankedGameState.sol_pot = rankedGameAccounts[j].lamports / LAMPORTS_PER_SOL;
                        // Calculate the current pot in USDC using the oracle prices and the amounts in the pot for each token
                        const solToUsdc = rankedGameState.sol_pot * global.main.USD_PER_SOL;
                        const skrToUsdc = rankedGameState.skr_pot * global.main.USD_PER_SKR;
                        const flapnToUsdc = rankedGameState.flapn_pot * global.main.USD_PER_FLAPN;
                        const usdcToUsdc = rankedGameState.usdc_pot;
                        const totalPot = solToUsdc + skrToUsdc + flapnToUsdc + usdcToUsdc;

                        console.log(">>>>>>>>>> ENTRY FEE:", rankedGameState.entry_fee, "USDC <<<<<<<<<<");

                        rankedGame.tokensPot[0].amount = rankedGameState.sol_pot;
                        rankedGame.tokensPot[1].amount = rankedGameState.skr_pot;
                        rankedGame.tokensPot[2].amount = rankedGameState.flapn_pot;
                        rankedGame.tokensPot[3].amount = rankedGameState.usdc_pot;
                        rankedGame.totalPot = totalPot; // Sum of them all in dollars
                        console.log(rankedGame.tokensPot, totalPot);
                        rankedGame.participantCount = rankedGameState.participant_count;
                        console.log("New ranked game state for ranked game", rankedGameState.ranked_game_id, "pot size:", totalPot, "participant count:", rankedGameState.participant_count);
                        // This will later be broadcasted to clients in realtime

                        // Update the database
                        fetch(global.main.GATEWAY_URL + "/update-ranked-game", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                password: global.main.GATEWAY_PASSWORD,
                                ranked_game_id: rankedGameState.ranked_game_id,
                                pot: totalPot,
                                collected_fees: totalPot * 0.1, // 10% fee
                                participant_count: rankedGameState.participant_count
                            })
                        }).then(resp => resp.json()).then(data => {
                            if(data.success)
                            {
                                console.log("Ranked game", rankedGameState.ranked_game_id, "updated successfully on the database");
                            }
                            else
                            {
                                console.log("Error updating ranked game", rankedGameState.ranked_game_id, "on the database:", data.error);
                            }
                        }).catch(err => {
                            console.log("Error updating ranked game", rankedGameState.ranked_game_id, "on the database:", err);
                        });
                    }
                }
            }
        }
    }
    console.log("========== Finished iterating ranked games on-chain ==========");
}
setInterval(efficientlyIterateRankedGames, 1000);

function getRankedGamePDA(rankedGameId)
{
    const idBytes = Buffer.alloc(32); // 32 zero bytes
    Buffer.from(rankedGameId, "utf8").copy(idBytes); // copy string bytes in, rest stays 0
    
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("flapn_ranked_game"),
            idBytes
        ],
        new PublicKey(programId)
    );
}

function getPlayerPDA(walletPublicKey)
{
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("flapn_participant"),
            walletPublicKey.toBytes()
        ],
        new PublicKey(programId)
    );
}

function toMicroUsdPerAtom(priceUSD) {
    // Convert via string to avoid float precision loss entirely
    // e.g. "0.0000051" → shift decimal 6 places right → "5.1" → floor to 5
    const str = priceUSD.toFixed(12); // enough decimal places
    const [integer, decimals = ''] = str.split('.');
    const paddedDecimals = (decimals + '000000').slice(0, 6); // exactly 6 decimal places
    const result = parseInt(integer) * 1_000_000 + parseInt(paddedDecimals);
    return result;
}

async function initOracle(solPriceUSD, skrPriceUSD, flapnPriceUSD)
{
    // Convert human-readable USD prices to micro-USD per base unit

    // SOL: price_usd * 1_000_000 / 1_000_000_000 (lamports per SOL)
    //    = price_usd / 1000
    const solMicroPerLamport  = toMicroUsdPerAtom(solPriceUSD);

    // SPL tokens with 6 decimals: price_usd * 1_000_000 / 1_000_000 (atoms per token)
    //    = price_usd (the 1e6s cancel)
    const skrMicroPerAtom     = toMicroUsdPerAtom(skrPriceUSD);
    const flapnMicroPerAtom   = toMicroUsdPerAtom(flapnPriceUSD);

    console.log("[ORACLE] Initialising oracle with prices:");
    console.log("  SOL:   $" + solPriceUSD   + " → " + solMicroPerLamport  + " micro-USD/lamport");
    console.log("  SKR:   $" + skrPriceUSD   + " → " + skrMicroPerAtom     + " micro-USD/atom");
    console.log("  FLAPN: $" + flapnPriceUSD + " → " + flapnMicroPerAtom   + " micro-USD/atom");

    const [oraclePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("flapn_oracle")],
        new PublicKey(programId)
    );

    // InitOracle is variant 0 in RankedGameInstruction.
    // Payload: [discriminant(1), sol_micro(8 LE), skr_micro(8 LE), flapn_micro(8 LE)]
    const instructionData = Buffer.concat([
        Buffer.from([0]),
        Buffer.from(new BN(solMicroPerLamport).toArray("le", 8)),
        Buffer.from(new BN(skrMicroPerAtom).toArray("le", 8)),
        Buffer.from(new BN(flapnMicroPerAtom).toArray("le", 8)),
    ]);

    const transaction = new Transaction();

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: FLAPN_ADMIN_KEYPAIR.publicKey, isSigner: true,  isWritable: true  }, // 0 authority
            { pubkey: oraclePDA,                     isSigner: false, isWritable: true  }, // 1 oracle PDA
            { pubkey: SystemProgram.programId,        isSigner: false, isWritable: false }, // 2 system program
        ],
        programId: new PublicKey(programId),
        data: instructionData,
    });

    transaction.add(instruction);

    try {
        transaction.feePayer = FLAPN_ADMIN_KEYPAIR.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.sign(FLAPN_ADMIN_KEYPAIR);

        const txId = await connection.sendRawTransaction(transaction.serialize());
        console.log("[ORACLE] InitOracle TX sent:", txId);

        const confirmation = await connection.confirmTransaction(txId, "confirmed");
        console.log("[ORACLE] InitOracle TX confirmation:", confirmation);

        if (!confirmation.value.err) {
            console.log("[ORACLE] Oracle initialised successfully at PDA:", oraclePDA.toString());
        }
    } catch (err) {
        console.log("[ORACLE] Error initialising oracle:", err);
    }
}

async function updateOraclePrices(solPriceUSD, skrPriceUSD, flapnPriceUSD) {
    const solMicroPerLamport = toMicroUsdPerAtom(solPriceUSD);
    const skrMicroPerAtom    = toMicroUsdPerAtom(skrPriceUSD);
    const flapnMicroPerAtom  = toMicroUsdPerAtom(flapnPriceUSD);

    console.log("[ORACLE] Updating oracle prices:");
    console.log("  SOL:   $" + solPriceUSD   + " → " + solMicroPerLamport + " micro-USD/lamport");
    console.log("  SKR:   $" + skrPriceUSD   + " → " + skrMicroPerAtom    + " micro-USD/atom");
    console.log("  FLAPN: $" + flapnPriceUSD + " → " + flapnMicroPerAtom  + " micro-USD/atom");

    const [oraclePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("flapn_oracle")],
        new PublicKey(programId)
    );

    // UpdateOraclePrices is variant 1 in RankedGameInstruction.
    const instructionData = Buffer.concat([
        Buffer.from([1]),
        Buffer.from(new BN(solMicroPerLamport).toArray("le", 8)),
        Buffer.from(new BN(skrMicroPerAtom).toArray("le", 8)),
        Buffer.from(new BN(flapnMicroPerAtom).toArray("le", 8)),
    ]);

    const transaction = new Transaction();

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: FLAPN_ADMIN_KEYPAIR.publicKey, isSigner: true,  isWritable: false }, // 0 authority (no lamport change needed)
            { pubkey: oraclePDA,                     isSigner: false, isWritable: true  }, // 1 oracle PDA
        ],
        programId: new PublicKey(programId),
        data: instructionData,
    });

    transaction.add(instruction);

    try {
        transaction.feePayer = FLAPN_ADMIN_KEYPAIR.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.sign(FLAPN_ADMIN_KEYPAIR);

        const txId = await connection.sendRawTransaction(transaction.serialize());
        console.log("[ORACLE] UpdateOraclePrices TX sent:", txId);

        const latestBlockHeight = await connection.getBlockHeight();

        const confirmation = await connection.confirmTransaction({
            signature: txId,
            blockhash: transaction.recentBlockhash,
            lastValidBlockHeight: latestBlockHeight
        }, "confirmed");
        console.log("[ORACLE] UpdateOraclePrices TX confirmation:", confirmation);

        if (!confirmation.value.err) {
            console.log("[ORACLE] Oracle prices updated successfully");
        }
    } catch (err) {
        console.log("[ORACLE] Error updating oracle prices:", err);
    }
}
// To be used after DEPLOYMENT of the FLAPN program
/*console.log(`
    [ORACLE] Initialising oracle with initial prices from Jupiter API...
    USD_PER_SOL: $${global.main.USD_PER_SOL}
    USD_PER_SKR: $${global.main.USD_PER_SKR}
    USD_PER_FLAPN: $${global.main.USD_PER_FLAPN}    
`);
initOracle(global.main.USD_PER_SOL, global.main.USD_PER_SKR, global.main.USD_PER_FLAPN);*/

async function createRankedGame(entryFee, creatorName)
{
    entryFee = Math.round(entryFee); // Convert entry fee from SOL to lamports

    const rankedGameIdStr = new BN(Date.now()).toString(); // Use current timestamp as ranked game ID
    const rankedGameId = Buffer.alloc(32);
    Buffer.from(rankedGameIdStr, "utf8").copy(rankedGameId);

    const [rankedGamePDA, rankedGameBump] = getRankedGamePDA(rankedGameId);

    console.log("entry fee:", entryFee);

    const serializedData = serialize(
        CreateRankedGameStateInstructionSchema,
        new CreateRankedGameStateInstruction({
            ranked_game_id: rankedGameId,
            entry_fee: entryFee,
        })
    );

    const instructionData = Buffer.concat([
        Buffer.from([2]), // Instruction discriminator for "CreateRankedGame"
        Buffer.from(serializedData)
    ]);

    const transaction = new Transaction();

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: FLAPN_ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
            { pubkey: rankedGamePDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: new PublicKey(programId),
        data: instructionData,
    });

    transaction.add(instruction);

    // Try to sign this transaction and send it
    try
    {
        transaction.feePayer = FLAPN_ADMIN_KEYPAIR.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.sign(FLAPN_ADMIN_KEYPAIR);

        const txId = await connection.sendRawTransaction(transaction.serialize());
        console.log("TX sent with id:", txId);

        const confirmation = await connection.confirmTransaction(txId, "confirmed");
        console.log("TX confirmation:", confirmation);

        if(!confirmation.value.err)
        {
            console.log("Ranked game created successfully on-chain");
            console.log("Initializing it as a RankedGame instance in memory...");
            // ToDo: Also register it on database
            const rankedGame = new global.main.network.RankedGame(rankedGameIdStr, entryFee, rankedGamePDA.toString(), false, null, creatorName);
        }
    }
    catch(err)
    {
        console.log("Error creating ranked game:", err);
    }

}
//createRankedGame(1.00); // Create a ranked game with $1 entry fee for testing

async function startRankedGame(rankedGameId)
{
    console.log("[ORACLE] Starting ranked game with id:", rankedGameId);
    const rankedGamePublicKey = getRankedGamePDA(rankedGameId)[0];
    console.log("[ORACLE] Ranked game PDA:", rankedGamePublicKey.toBase58());

    const instructionData = Buffer.from([4]);

    const transaction = new Transaction();

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: FLAPN_ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
            { pubkey: rankedGamePublicKey, isSigner: false, isWritable: true },
        ],
        programId: new PublicKey(programId),
        data: instructionData,
    });

    transaction.add(instruction);

    // Try to sign this transaction and send it
    try
    {
        transaction.feePayer = FLAPN_ADMIN_KEYPAIR.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.sign(FLAPN_ADMIN_KEYPAIR);

        const txId = await connection.sendRawTransaction(transaction.serialize());
        console.log("TX sent with id:", txId);

        const confirmation = await connection.confirmTransaction(txId, "confirmed");
        console.log("TX confirmation:", confirmation);
        if(!confirmation.value.err)
        {
            console.log("Ranked game", rankedGameId, "started successfully on-chain");
        }
    }catch(err)
    {
        console.log("Error signing transaction to start ranked game:", err);
        return;
    }
}

async function finalizeRankedGame(rankedGameId)
{
    console.log("[ORACLE] Finalizing ranked game with id:", rankedGameId);
    const rankedGamePublicKey = getRankedGamePDA(rankedGameId)[0];
    console.log("[ORACLE] Ranked game PDA:", rankedGamePublicKey.toBase58());

    const instructionData = Buffer.from([5]);

    const transaction = new Transaction();
    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: FLAPN_ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
            { pubkey: rankedGamePublicKey, isSigner: false, isWritable: true },
        ],
        programId: new PublicKey(programId),
        data: instructionData,
    });

    transaction.add(instruction);

    // Try to sign this transaction and send it
    try
    {
        transaction.feePayer = FLAPN_ADMIN_KEYPAIR.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.sign(FLAPN_ADMIN_KEYPAIR);

        const txId = await connection.sendRawTransaction(transaction.serialize());
        console.log("TX sent with id:", txId);
        const confirmation = await connection.confirmTransaction(txId, "confirmed");
        console.log("TX confirmation:", confirmation);
        if(!confirmation.value.err)
        {
            console.log("Ranked game", rankedGameId, "finalized successfully on-chain");
        }
    }catch(err)
    {
        console.log("Error signing transaction to finalize ranked game:", err);
        return;
    }
}

/* This is for Ranked Games payouts */
async function submitPayoutTransaction(rankedGameId, winnerWallet, shareBps)
{
    const rankedGamePublicKey = getRankedGamePDA(rankedGameId)[0];

    console.log("[ORACLE] Submitting payout transaction for ranked game", rankedGameId, "winner:", winnerWallet, "share (bps):", shareBps);
    const winnerPublicKey = new PublicKey(winnerWallet);
    const participantPublicKey = getPlayerPDA(winnerPublicKey)[0];

    // Derive all vault and recipient ATAs
    const skrMint = new PublicKey(global.main.supportedTokens[1]);
    const flapnMint = new PublicKey(global.main.supportedTokens[2]);
    const usdcMint = new PublicKey(global.main.supportedTokens[3]);

    const [
        recipientSKRAta, vaultSkrAta,
        recipientFLAPNAta, vaultFlapnAta,
        recipientUSDCAta, vaultUSDCAta
     ] = await Promise.all([
        getAssociatedTokenAddress(skrMint, winnerPublicKey, false),
        getAssociatedTokenAddress(skrMint, rankedGamePublicKey, true),
        getAssociatedTokenAddress(flapnMint, winnerPublicKey, false),
        getAssociatedTokenAddress(flapnMint, rankedGamePublicKey, true),
        getAssociatedTokenAddress(usdcMint, winnerPublicKey, false),
        getAssociatedTokenAddress(usdcMint, rankedGamePublicKey, true)
    ]);

    const transaction = new Transaction();

    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: FLAPN_ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
            { pubkey: rankedGamePublicKey, isSigner: false, isWritable: true },
            { pubkey: participantPublicKey, isSigner: false, isWritable: true },
            { pubkey: winnerPublicKey, isSigner: false, isWritable: true },
            { pubkey: recipientSKRAta, isSigner: false, isWritable: true },
            { pubkey: vaultSkrAta, isSigner: false, isWritable: true },
            { pubkey: recipientFLAPNAta, isSigner: false, isWritable: true },
            { pubkey: vaultFlapnAta, isSigner: false, isWritable: true },
            { pubkey: recipientUSDCAta, isSigner: false, isWritable: true },
            { pubkey: vaultUSDCAta, isSigner: false, isWritable: true },
            { pubkey: skrMint, isSigner: false, isWritable: false },
            { pubkey: flapnMint, isSigner: false, isWritable: false },
            { pubkey: usdcMint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: new PublicKey(programId),
        data: Buffer.concat([
            Buffer.from([6]),
            Buffer.from(new BN(shareBps).toArray("le", 2)),
        ])
    });

    transaction.add(instruction);

    // Try to sign this transaction and send it
    try
    {
        transaction.feePayer = FLAPN_ADMIN_KEYPAIR.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.sign(FLAPN_ADMIN_KEYPAIR);

        const txId = await connection.sendRawTransaction(transaction.serialize());
        console.log("TX sent with id:", txId);
        const confirmation = await connection.confirmTransaction(txId, "confirmed");
        console.log("TX confirmation:", confirmation);
        if(!confirmation.value.err)
        {
            console.log("Payout transaction for ranked game", rankedGameId, "winner:", winnerWallet, "shareBps", shareBps, "submitted successfully on-chain");
        }
    }catch(err)
    {
        console.log("Error signing transaction to submit payout:", err);
        return;
    }
}
//submitPayoutTransaction("1774210616869", "FvJA3y6XoN9qzU5oLt1peRrtKTtyjQKf6WUxAF3z86oc", 10_000);

async function iterateRankedGames()
{
    // Get PDAs owned by our program
    let rankedGameAccounts;
    try{
        rankedGameAccounts = await connection.getProgramAccounts(
            new PublicKey(programId),
            {
                filters: [
                    {
                        memcmp: {
                            offset: 0, // Discriminator is at the start of the account data
                            bytes: bs58.encode(Buffer.from("RNKDGAME"))
                        }
                    }
                ]
            }
        );
    }catch(err){
        return await iterateRankedGames(); // Retry if fetching account info fails, as it could be a transient issue with the connection
    }

    console.log("Found ranked game accounts:", rankedGameAccounts.length);
    // Deserialize the ranked game account states
    for(let i = 0; i < rankedGameAccounts.length; i++)
    {
        const rankedGameState = await deserializeRankedGameState(rankedGameAccounts[i].pubkey, rankedGameAccounts[i].account.data);
        console.log(rankedGameState);
    }
}
//iterateRankedGames();

async function iterateParticipants()
{
    // Get PDAs owned by our program
    const participantAccounts = await connection.getProgramAccounts(
        new PublicKey(programId),
        {
            filters: [
                {
                    memcmp: {
                        offset: 0, // Discriminator is at the start of the account data
                        bytes: bs58.encode(Buffer.from("PARTCPNT"))
                    }
                }
            ]
        }
    );

    console.log("Found participant accounts:", participantAccounts.length);
    // Deserialize the participant account states
    for(let i = 0; i < participantAccounts.length; i++)
    {
        const participantState = deserializeParticipantState(participantAccounts[i].account.data);
        console.log(participantState);
    }
}
//iterateParticipants();

const alreadyVerifiedTxs = new Set();

async function verifyRankedGameJoinTransaction(txId, rankedGameId, ws)
{
    const rankedGamePDA = getRankedGamePDA(rankedGameId)[0];

    if(ws && ws.account && ws.player)
    {
        // Fetch the transaction details
        let txDetails;
        try{
            txDetails = await connection.getParsedTransaction(txId, "confirmed");
        }catch(err){
            return await verifyRankedGameJoinTransaction(txId, rankedGameId, ws); // Retry if fetching transaction details fails, as it could be a transient issue with the connection
        }
        if(txDetails && txDetails.transaction)
        {
            // Check that the FLAPN program is in the account keys and that the player's wallet is a signer
            const programIdIndex = txDetails.transaction.message.accountKeys.findIndex(ak => ak.pubkey.toString() === programId);
            const playerWalletIndex = txDetails.transaction.message.accountKeys.findIndex(ak => ak.pubkey.toString() === ws.account.last_wallet_connected);

            if(programIdIndex !== -1 && playerWalletIndex !== -1 && txDetails.transaction.message.accountKeys[playerWalletIndex].signer)
            {
                // In the program log, check for
                // "Joined"
                const joinedLog = txDetails.meta.logMessages.find(log => log.includes("Joined"));
                const userWalletLog = txDetails.meta.logMessages.find(log => log.includes(ws.account.last_wallet_connected));
                const rankedGamePDALog = txDetails.meta.logMessages.find(log => log.includes(rankedGamePDA.toString()));

                if(joinedLog && userWalletLog && rankedGamePDALog)
                {
                    // Compare the tx slot with the latest with a margin of 10 slots
                    // to be sure that the transaction is recent and not repeated
                    if(txDetails.slot > latestSlot - 100)
                    {
                        // Also check that the transaction is not already verified in memory
                        if(alreadyVerifiedTxs.has(txId))
                        {
                            console.log("Transaction", txId, "is already verified, ignoring");
                            return {
                                isValid: false
                            };
                        }

                        alreadyVerifiedTxs.add(txId);
                        return {
                            isValid: true,
                            rankedGamePDA: rankedGamePDA.toString()
                        }
                    }
                }
                else
                {
                    console.log("Transaction", txId, "is missing required logs, invalid for joining ranked game", rankedGameId);
                    return {
                        isValid: false
                    };
                }
            }
            else
            {
                console.log("Transaction", txId, "is missing required account keys or signer, invalid for joining ranked game", rankedGameId);
                return {
                    isValid: false
                };
            }
        }
        else
        {
            console.log("Transaction details not found for", txId);
            return {
                isValid: false
            };
        }
    }
    else
    {
        console.log("WebSocket or account or player information is missing, cannot verify transaction", txId);
        return {
            isValid: false
        };
    }
}

async function verifyFailedRankedGameJoinTransaction(rankedGameId, ws)
{
    const rankedGamePDA = getRankedGamePDA(rankedGameId)[0];

    if(ws && ws.account && ws.player)
    {
        if(!ws.account.last_wallet_connected)
        {
            console.log("No wallet connected for player, cannot verify transaction");
            return {
                isValid: false,
                noWalletConnected: true
            };
        }

        const participantPDA = getPlayerPDA(new PublicKey(ws.account.last_wallet_connected))[0];
        const resp = await fetch(global.main.GATEWAY_URL + "/get-participant-account-involving-ranked-game-pda", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                participant_pda: participantPDA.toString(),
                ranked_game_pda: rankedGamePDA.toString()
            })
        });
        const data = await resp.json();
        if(data.success)
        {
            console.log("Participant with PDA", participantPDA.toString(), "already has a verified transaction involving ranked game PDA", rankedGamePDA.toString(), "assuming the join was successful");
            return {
                isValid: false
            };
        }

        console.log("Verifying failed ranked game join transaction for ranked game", rankedGameId, "participant PDA:", participantPDA.toString());

        // Fetch the latest transaction of the participant PDA involving the FLAPN program and the ranked game PDA in the account keys
        let transactions;
        try{
            transactions = await connection.getSignaturesForAddress(participantPDA, { limit: 10 }, "confirmed");
        }catch(err){
            return await verifyFailedRankedGameJoinTransaction(rankedGameId, ws); // Retry if fetching transaction signatures fails, as it could be a transient issue with the connection
        } 

        // Filter transactions with errors out
        transactions = transactions.filter(tx => tx.err === null);

        // Sort transactions by most recent
        transactions.sort((a, b) => b.slot - a.slot);
        // Batch request getParsedTransaction for these transactions
        let transactionDetails;
        try{
            transactionDetails = await connection.getTransactions(transactions.map(t => t.signature), "confirmed");
        }catch(err){
            return await verifyFailedRankedGameJoinTransaction(rankedGameId, ws); // Retry if fetching transaction details fails, as it could be a transient issue with the connection
        }
        transactionDetails = transactionDetails.filter(tx => tx.meta && tx.meta.err === null && tx.transaction);
        transactionDetails = transactionDetails.filter(tx => {
            const hasProgramId = tx.transaction.message.accountKeys.some(ak => ak.toString() === programId);
            const hasRankedGamePDA = tx.transaction.message.accountKeys.some(ak => ak.toString() === rankedGamePDA.toString());
            return hasProgramId && hasRankedGamePDA;
        });

        if(transactionDetails.length === 0)
            return {
                isValid: false
            };

        console.log("All good up till checking slot");
        const latestTx = transactionDetails[0];

        // Also check that the transaction is not already verified in memory
        if(alreadyVerifiedTxs.has(latestTx.transaction.signatures[0].toString()))
        {
            console.log("Transaction", latestTx.transaction.signatures[0].toString(), "is already verified, ignoring");
            return {
                isValid: false
            };
        }

        alreadyVerifiedTxs.add(latestTx.transaction.signatures[0].toString());

        /*return {
            isValid: true,
            rankedGamePDA: rankedGamePDA.toString()
        };*/

        // Check if the slot of this transaction is recent, with a margin of 10 slots with the latest slot
        if(latestTx.slot > latestSlot - 10)
        {
            return {
                isValid: true,
                rankedGamePDA: rankedGamePDA.toString()
            }
        }
        else
        {
            console.log("Slot is too late", latestTx.slot, "latest slot:", latestSlot);
            console.log("Delta:", latestSlot - latestTx.slot);
            return {
                isValid: false
            };
        }
    }
}

async function getLatestOraclePrices()
{
    const oraclePDA = PublicKey.findProgramAddressSync(
        [Buffer.from("flapn_oracle")],
        new PublicKey(programId)
    )[0];

    let accountInfo;
    try{
        accountInfo = await connection.getAccountInfo(oraclePDA);
        if(accountInfo)
        {
            const oraclePriceState = deserializeOraclePriceState(accountInfo.data);
            return {
                solPriceUSD: oraclePriceState.sol_price_usd,
                skrPriceUSD: oraclePriceState.skr_price_usd,
                flapnPriceUSD: oraclePriceState.flapn_price_usd
            };
        } 
        else
        {
            console.log("Oracle account not found");
            return null;
        }
    }catch(err){
        return await getLatestOraclePrices(); // Retry if fetching account info fails, as it could be a transient issue with the connection
    }
}

async function doesWalletHaveSeekerGenesisNFT(walletPubkey)
{
    const owner = new PublicKey(walletPubkey);

    const tokenAccounts = await connection.getTokenAccountsByOwner(owner, {
        programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    });

    let nftMints = tokenAccounts.value
        .filter((account) =>
        {
            if(account.account.owner.toString() === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
                return account;
        })
        .map((account) => new PublicKey(account.account.data.slice(0, 32)));

    if(nftMints.length === 0)
    {
        console.log("Doesn't have any NFTs from the Token 2022 program");
        return false;
    }
    
    for(const mint of nftMints)
    {
        const rawAccount = await connection.getAccountInfo(mint);
        const mintData = unpackMint(mint, rawAccount, TOKEN_2022_PROGRAM_ID);
        if(mintData.mintAuthority.toBase58() === "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4")
        {
            console.log("Has Seeker Genesis NFT!");
            return true;
        }
        else
        {
            console.log("Not a Seeker Genesis NFT", mint.toBase58());
        }
    }
}

/* This is for other rewards! */
async function sendReward(rewardMint, recipientWallet, uiAmount, callback)
{
    let transaction = new Transaction();
    if(rewardMint === global.main.supportedTokens[0])
    {
        // SOL reward, send via SystemProgram transfer
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: FLAPN_ADMIN_KEYPAIR.publicKey,
                toPubkey: new PublicKey(recipientWallet),
                lamports: Math.round(uiAmount * LAMPORTS_PER_SOL)
            })
        );
    }
    else
    {
        // SPL token reward, send via associated token accounts
        const mintPublicKey = new PublicKey(rewardMint);
        const recipientPublicKey = new PublicKey(recipientWallet);
        const senderAta = await getAssociatedTokenAddress(mintPublicKey, FLAPN_ADMIN_KEYPAIR.publicKey, false);
        const recipientAta = await getAssociatedTokenAddress(mintPublicKey, recipientPublicKey, false);

        // If recipient ATA doesn't exist, create it (sender pays rent)
        try {
            await getAccount(connection, recipientAta);
        } catch {
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    FLAPN_ADMIN_KEYPAIR.publicKey,  // payer
                    recipientAta,                    // ATA to create
                    recipientPublicKey,              // owner
                    mintPublicKey                    // mint
                )
            );
        }

        // Convert UI amount to raw amount using mint decimals
        const mintInfo = await getMint(connection, mintPublicKey);
        const rawAmount = BigInt(Math.round(uiAmount * 10 ** mintInfo.decimals));

        transaction.add(
            createTransferInstruction(
                senderAta,
                recipientAta,
                FLAPN_ADMIN_KEYPAIR.publicKey,
                rawAmount
            )
        );
    }

    try{
        const tx = await connection.sendTransaction(transaction, [FLAPN_ADMIN_KEYPAIR]);
        const confirmation = await connection.confirmTransaction(tx, "confirmed");
         if (!confirmation.value.err) {
            console.log("Reward sent successfully in transaction", tx);
            if(callback) callback(null, tx);
        } else {
            console.log("Error sending reward:", confirmation.value.err);
            if(callback) callback(confirmation.value.err, null);
        }
    }catch(err)
    {
        console.log("Error creating reward transaction:", err);
    }
}

/*sendReward(global.main.supportedTokens[0], "7mao9uxQtDkL1RmJyDyW7t6fSc8fj28uGLKkLt4B7LTe", 0.012, (err, tx) => {
    if(err)
        console.log("Error sending reward:", err);
    else
        console.log("Reward sent in transaction:", tx);
});*/

async function incrementBirdLevel(birdPDA)
{
    console.log("[ORACLE] Incrementing bird level for PDA:", birdPDA);
    const birdPublicKey = new PublicKey(birdPDA);

    const instructionData = Buffer.from([9]);

    const transaction = new Transaction();
    const instruction = new TransactionInstruction({
        keys: [
            { pubkey: FLAPN_ADMIN_KEYPAIR.publicKey, isSigner: true, isWritable: true },
            { pubkey: birdPublicKey, isSigner: false, isWritable: true },
        ],
        programId: new PublicKey(programId),
        data: instructionData,
    });

    transaction.add(instruction);

    // Try to sign this transaction and send it
    try
    {
        transaction.feePayer = FLAPN_ADMIN_KEYPAIR.publicKey;
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.sign(FLAPN_ADMIN_KEYPAIR);

        /* Simulate */
        const simulation = await connection.simulateTransaction(transaction);
        if(simulation.value.err)
        {
            console.log("Simulation error for incrementing bird level:", simulation.value.err);
            return;
        }

        const txId = await connection.sendRawTransaction(transaction.serialize());
        console.log("TX sent with id:", txId);
        const confirmation = await connection.confirmTransaction(txId, "confirmed");
        console.log("TX confirmation:", confirmation);
        if(!confirmation.value.err)
        {
            console.log("Bird level incremented successfully on-chain for PDA:", birdPDA);
        }
    }catch(err)
    {
        console.log("Error signing transaction to increment bird level:", err);
        return;
    }
}

async function getBirdData(birdPDA)
{
    const acct = await connection.getAccountInfo(new PublicKey(birdPDA));
    if (!acct) {
        console.log("Account does not exist on-chain");
    } else {
        console.log("Owner:", acct.owner.toBase58());
        console.log("Data length:", acct.data.length);
        console.log("First 8 bytes (hex):", acct.data.slice(0, 8).toString("hex"));
        console.log("First 8 bytes (ascii):", acct.data.slice(0, 8).toString("ascii"));
    }
}

console.log("[ORACLE] IS MAIN THREAD?", isMainThread);

if(isMainThread)
{
    setInterval(()=>{
        getLatestOraclePrices().then(prices => {
            if(prices)
            {
                console.log(`
                    Latest oracle prices:
                    SOL: $${prices.solPriceUSD.toString()}
                    SKR: $${prices.skrPriceUSD.toString()}
                    FLAPN: $${prices.flapnPriceUSD.toString()}
                `);
            }
        }).catch(err => {
            console.log("Error fetching latest oracle prices:", err);
            console.log("Will try again in 10 seconds");
        });
    }, 10_000);
}
else
{
    // Running on network thread, we ain't updating oracle prices here,
    // this is only used for Bird modifications based on player.js logic
    //incrementBirdLevel("2HYJiBayZ5CL9jRrwgd6Sd8g9vbMcgp8igXCpnd1KKDu");
    //getBirdData("Hc3KDxzhMcE4VhU6k8NYWRaQJNJvcKfFgUiFy8WxBGjD");
}

module.exports = {
    connection,
    createRankedGame,
    getRankedGamePDA,
    startRankedGame,
    finalizeRankedGame,
    addRankedGameToCheck,
    removeRankedGameToCheck,
    submitPayoutTransaction,
    verifyRankedGameJoinTransaction,
    verifyFailedRankedGameJoinTransaction,
    updateOraclePrices,
    RANKED_GAMES_PUBKEYS_TO_CHECK,
    doesWalletHaveSeekerGenesisNFT,
    sendReward,
    incrementBirdLevel
}