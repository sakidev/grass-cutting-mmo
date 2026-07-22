window.mobileWalletAuthToken = null;
window.mobileWalletInfo = null;
window.mobileWalletEncoder = new TextEncoder();
window.mobileWalletDecoder = new TextDecoder();

function base64ToArray(str) {
    const binaryString = atob(str);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
}
window.base64ToArray = base64ToArray;

window.mobileWalletConnect = async function(){

    if(window.cordova && window.navigator && window.navigator.vibrate)
        window.navigator.vibrate(100);

    try{
        const result = await window.SolanaMobileWalletAdapter.connectWallet();
        if (result) {
            window.mobileWalletAuthToken = result.auth_token;
            window.mobileWalletInfo = result;
            //console.log('Connected to mobile wallet:', window.mobileWalletInfo);
            window.mobileWalletAddress = window.bs58.encode(base64ToArray(window.mobileWalletInfo.accounts[0].address));
            window.mobileWalletAddressRAW = window.mobileWalletInfo.accounts[0].address;
            console.log('Connected to mobile wallet pubkey:', window.mobileWalletAddress);

            return true;
        }
        else{
            console.error('Failed to connect to mobile wallet');

            return false;
        }
    }catch(err)
    {
        console.error('Error connecting to mobile wallet:', err);
        
        return false;
    }
};

window.mobileWalletSignMessage = async function(message) {
    const encoded = btoa(message);

    console.log('Signing message:', message, 'Encoded:', encoded, 'Auth Token:', window.mobileWalletAuthToken);

    const signedMessages = await window.SolanaMobileWalletAdapter.transact(async (wallet) => {
        const authorizationResult = await wallet.reauthorize({
            auth_token: window.mobileWalletAuthToken,
            identity: {
                name: 'FLAPN',
                uri: 'https://flapn.fun',
                icon: 'favicon.ico'
            }
        });

        console.log('Authorization result:', authorizationResult);

        const signedMessages = await wallet.signMessages({
            addresses: [window.mobileWalletAddressRAW],
            payloads: [encoded],
        });

        return signedMessages;
    });

    console.log('Signed messages:');

    signedMessages.signed_payloads.forEach(element => {
        console.log(' -', element);
        console.log("as an array for checking with tweetnacl:", base64ToArray(element));
    });

    return base64ToArray(signedMessages.signed_payloads[0]);
}

window.mobileWalletSignTransaction = async function(txs) {
    console.log('Signing transactions with mobile wallet:', txs);

    const txArray = Array.isArray(txs) ? txs : [txs];

    const encodedTransactions = txArray.map(tx => {
        if(tx instanceof Uint8Array) {
            return btoa(String.fromCharCode.apply(null, tx));
        } else if(typeof tx === 'string') {
            return btoa(tx);
        }else{
            console.error('Unsupported transaction format:', tx);
            return null;
        }
    });

    console.log('Signing transactions:', encodedTransactions, 'Auth Token:', window.mobileWalletAuthToken);

    try{
        const signedTransactions = await window.SolanaMobileWalletAdapter.transact(async (wallet) => {
            const authResult = await wallet.authorize({
                cluster: window.PRODUCTION ? 'mainnet-beta' : 'devnet',
                identity: {
                    name: 'FLAPN',
                    uri: "https://flapn.fun",
                    icon: 'favicon.ico'
                }
            });

            return await wallet.signTransactions({
                addresses: [authResult.accounts[0].address],
                payloads: encodedTransactions
            });
        });
    
        console.log('Signed transactions:', signedTransactions);
    
        const results = signedTransactions.signed_payloads.map((element, index) => {
            const decoded = base64ToArray(element);
            
            return {
                decoded: decoded,
            };
        });
    
        console.log('Transaction signing results:');
        results.forEach(result => {
            console.log('   Signature:', result.decoded);
        });
    
        return results[0];
    }catch(err){
        if(err.toString.includes("authorization"))
        {
        
            window.alert("Authorization error during transaction signing. Please reconnect your wallet.");

        console.log(">>> AUTHORIZATION RESULT", authResult);
        }
        else
        {
            console.error(">>>>>>>>>>>>>>> Error during transaction signing:", err);
            return {
                error: err.toString()
            };
        }
    }
}