const LAUNCHER_VERSION = "1.0.0";
console.log(`LAUNCHER v${LAUNCHER_VERSION}`);

async function downloadAndInitializeApp(url){
  if(window.location.href.includes("127.0.0.1") || window.location.href.includes("192.168.1.191"))
    url += "?t=" + Date.now(); // Bypass cache for local testing

  const resp = await fetch(url);
  const appCode = await resp.text();
  const appBlob = new Blob([appCode], { type: 'application/javascript' });
  const appUrl = URL.createObjectURL(appBlob);
  const script = document.createElement('script');
  script.src = appUrl;
  document.body.appendChild(script);
}

async function injectCSS(text){
    const style = document.createElement('style');
    style.textContent = text;
    document.head.appendChild(style);
}

function isAndroidOrIOS(){
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;

    // Check for Android
    if (/android/i.test(userAgent)) {
      window.mobileDevice = "android";
      return true;
    }

    // Check for iOS
    if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
      window.mobileDevice = "iOS";
      return true;
    }

    return false;
}

const supportedFiles = [
  "js/mobile/solana-mobile-wallet-adapter.js",
  "js/mobile/mobile-wallet.js",
  "builds/app.css",
  "builds/client-",
];

const requiredFiles = [
  "builds/app.css",
  "builds/client-"
];

async function checkVersion(){
  let downloadURL = "";
  if(window.location.href.includes("127.0.0.1"))
  {
    downloadURL = "http://127.0.0.1/";
  }
  else if(window.location.href.includes("192.168.1.191"))
  {
    downloadURL = "http://192.168.1.191/";
  }
  else
  {
    downloadURL = "https://flapn.fun/";
  }

  // For local network testing with the Seeker (disable when live)
  /*if(window.cordova)
  {
    downloadURL = "http://192.168.1.191/";
  }*/

  try{
    document.getElementById("landing").style.display = "flex";
    document.getElementById("pre-launch").style.display = "none";
  }catch(err){}

  const isMobile = isAndroidOrIOS();
  window.isMobile = isMobile;

  console.log("mobile device:", isMobile);

  const isTemporaryTab = processDeeplink();
  if(isTemporaryTab) // We're just here waiting for the deeplink response and this ain't gonna be the final app tab and should auto close
    return;


  if(isMobile)
  {
    // Require the mobile wallet adapters
    requiredFiles.push(supportedFiles[0], supportedFiles[1]);
  }

  if(window.location.href.includes("127.0.0.1") || window.location.href.includes("192.168.1.191"))
    requiredFiles[0] += "?t=" + Date.now();


  let whereToServeVersionFrom;
  if(window.location.href.includes("127.0.0.1"))
    whereToServeVersionFrom = "http://127.0.0.1/version.txt?t=" + Date.now();
  else if(window.location.href.includes("192.168.1.191"))
    whereToServeVersionFrom = "http://192.168.1.191/version.txt?t=" + Date.now();
  else
    whereToServeVersionFrom = "https://flapn.fun/version.txt?t=" + Date.now();

  const [
    versionResp,
    stylesResp,
    solanaMobileResp,
    mobileWalletResp
  ] = await Promise.all([
    fetch(whereToServeVersionFrom),
    fetch(downloadURL + requiredFiles[0]),
    isMobile ? fetch(downloadURL + requiredFiles[2]) : Promise.resolve(null),
    isMobile ? fetch(downloadURL + requiredFiles[3]) : Promise.resolve(null),
  ]);

  const [
    versionTxt,
    stylesTxt,
    solanaMobileTxt,
    mobileWalletTxt
  ] = await Promise.all([
    versionResp.text(),
    stylesResp.text(),
    isMobile ? solanaMobileResp.text() : Promise.resolve(""),
    isMobile ? mobileWalletResp.text() : Promise.resolve("")
  ]);

  if(isMobile)
  {
    console.log("Injecting mobile wallet adapters...");
    // Download and inject the mobile wallet, and solana mobile wallet adapter
    const solanaMobileWalletAdapterBlob = new Blob([solanaMobileTxt], { type: 'application/javascript' });
    const solanaMobileWalletAdapterUrl = URL.createObjectURL(solanaMobileWalletAdapterBlob);
    const solanaMobileWalletAdapterScript = document.createElement('script');
    solanaMobileWalletAdapterScript.src = solanaMobileWalletAdapterUrl;
    document.body.appendChild(solanaMobileWalletAdapterScript);

    const mobileWalletBlob = new Blob([mobileWalletTxt], { type: 'application/javascript' });
    const mobileWalletUrl = URL.createObjectURL(mobileWalletBlob);
    const mobileWalletScript = document.createElement('script');
    mobileWalletScript.src = mobileWalletUrl;
    document.body.appendChild(mobileWalletScript); 
  }

  let latestVersion = versionTxt;
  requiredFiles[1] += latestVersion + ".js";
  console.log("Latest version on webserver:", latestVersion);

  // Download and inject HTML and JS
  injectCSS(stylesTxt);
  await downloadAndInitializeApp(downloadURL + `builds/client-${latestVersion}.js`);
}

function processDeeplink()
{
  let isOnlyTemporaryTab = false;

  if(window.mobileDevice === "iOS" && !window.phantom)
  {
    window.addEventListener("storage", onLocalStorageUpdated, false)
    const searchParams = new URLSearchParams(window.location.search);
    const phantomPublicKey = searchParams.get('phantom_encryption_public_key');
    const onSignMessage = searchParams.get('onSignMessage');
    const onSignTransaction = searchParams.get('onSignTransaction');
    if(phantomPublicKey)
    {
        // When we get redirected back from Phantom after connecting (this is on a new tab/window)
        const data = searchParams.get('data');
        const nonce = searchParams.get('nonce');
  
        if(data && nonce)
        {
          const decryptedData = decryptPhantomConnectResponse(
            data,
            nonce,
            phantomPublicKey
          );
          const connectedWalletPubkey = decryptedData.public_key;
          const phantomSession = decryptedData.session;
          window.localStorage.setItem("flapn_iOS_connectedWalletData", JSON.stringify({
            publicKey: connectedWalletPubkey,
            session: phantomSession,
            timestamp: Date.now(),
            sourceData: {
              data: data,
              nonce: nonce,
              phantom_encryption_public_key: phantomPublicKey
            }
          }));

          isOnlyTemporaryTab = true;

          setTimeout(()=>{
            // Close the window so we go back to the first tab that launched the app
            window.close();
          }, 250);
        }
        else
        {
          window.alert("Error: Missing data in Phantom response.");
          window.location.href = window.location.origin;
        }
    }

    if(onSignMessage)
    {
        const signRequestNonce = searchParams.get('signRequestNonce');
        const data = searchParams.get('data');
        const nonce = searchParams.get('nonce');
        if(signRequestNonce && data && nonce)
        {
          window.localStorage.setItem(`flapn_signResponse_${signRequestNonce}`, JSON.stringify({
            data: data,
            nonce: nonce,
            timestamp: Date.now()
          }));

          isOnlyTemporaryTab = true;

          setTimeout(()=>{
            // Now close this window and return to the first window
            window.close();
          }, 250);
        }
    }

    if(onSignTransaction)
    {
        const signRequestNonce = searchParams.get('signRequestNonce');
        const data = searchParams.get('data');
        const nonce = searchParams.get('nonce');

        if(signRequestNonce && data && nonce)
        {
          window.localStorage.setItem(`flapn_txSignResponse_${signRequestNonce}`, JSON.stringify({
            data: data,
            nonce: nonce,
            timestamp: Date.now()
          }));

          isOnlyTemporaryTab = true;

          setTimeout(()=>
          {
            // Now close this window and return to the first window
            window.close();
          }, 250);
        }
    }
  }

  return isOnlyTemporaryTab;
}

setTimeout(()=>{
  checkVersion();
}, 1000);






















// This all is only used for iOS mobile web because the Solana Mobile Wallet Adapter doesn't work in iOS browsers, but it does work in Android browsers and native Android. For iOS mobile web, we have to use deep links to Phantom for signing and connecting wallet
function onLocalStorageUpdated(e)
{
  if(e.key === "flapn_iOS_connectedWalletData")
  {
    const savedData = JSON.parse(e.newValue);
    console.log("iOS Connected Wallet:", savedData.publicKey);

    WALLET_ADDR = savedData.publicKey;
    window.WALLET_ADDR = savedData.publicKey;

    document.getElementById("ranked-notification-popup-join-btn").style.display = "block";

    window.onWalletDeeplinkCallback();
  }
  else if(e.key.startsWith("flapn_signResponse"))
  {
    const requestNonce = e.key.substring("flapn_signResponse_".length);
    const signPromiseObj = window[`flapn_signPromise_${requestNonce}`];
    if(signPromiseObj)
    {
      const savedData = JSON.parse(e.newValue);

      clearTimeout(signPromiseObj.timeout);
      delete window[`flapn_signPromise_${requestNonce}`];

      const connectedWalletData = JSON.parse(window.localStorage.getItem("flapn_iOS_connectedWalletData"));
      if(!connectedWalletData)
      {
        window.alert("Error: No wallet connected. Please connect your wallet first.");
        signPromiseObj.reject(new Error("No wallet connected"));
        return;
      }

      // Decrypt the sign response
      const decryptedData = decryptPhantomSignResponse(
        savedData.data,
        savedData.nonce,
        connectedWalletData.sourceData.phantom_encryption_public_key
      );

      if(decryptedData && decryptedData.signature)
      {
        signPromiseObj.resolve(decryptedData.signature);
      }
    }
  }
  else if(e.key.startsWith("flapn_txSignResponse"))
  {
    const requestNonce = e.key.substring("flapn_txSignResponse_".length);
    const signPromiseObj = window[`flapn_signPromise_${requestNonce}`];
    if(signPromiseObj)
    {
      const savedData = JSON.parse(e.newValue);

      clearTimeout(signPromiseObj.timeout);
      delete window[`flapn_signPromise_${requestNonce}`];

      const connectedWalletData = JSON.parse(window.localStorage.getItem("flapn_iOS_connectedWalletData"));
      if(!connectedWalletData)
      {
        window.alert("Error: No wallet connected. Please connect your wallet first.");
        signPromiseObj.reject(new Error("No wallet connected"));
        return;
      }
      
      // Decrypt the sign transaction response
      const decryptedData = decryptPhantomSignTransactionResponse(
        savedData.data,
        savedData.nonce,
        connectedWalletData.sourceData.phantom_encryption_public_key
      );

      if(decryptedData && decryptedData.transaction)
      {
        signPromiseObj.resolve(decryptedData.transaction);
      }
    }
  }
}

function decryptPhantomConnectResponse(encryptedData, phantomNonce, phantomPublicKey)
{
  try
  {
    let secretKey = window.localStorage.getItem("flapn_phantomSessionSecretKey");
    if(!secretKey)
    {
      window.alert("Error: Missing session secret key for decrypting Phantom response.");
      return null;
    }

    // Decode everything
    secretKey = window.bs58.decode(secretKey);
    const phantomPubkey = window.bs58.decode(phantomPublicKey);
    const data = window.bs58.decode(encryptedData);
    const nonce = window.bs58.decode(phantomNonce);

    const sharedSecret = nacl.box.before(phantomPubkey, secretKey);

    // Decrypt the data now
    const decryptedData = nacl.box.open.after(data, nonce, sharedSecret);

    if(!decryptedData)
    {
      window.alert("Error: Unable to decrypt Phantom response data.");
      return null;
    }

    // Parse decrypted data as JSON
    const decodedString = new TextDecoder().decode(decryptedData);
    const jsonData = JSON.parse(decodedString);

    return jsonData;
  }catch(err)
  {
    window.alert("Error: " + err.toString());
    return null;
  }
}

function decryptPhantomSignResponse(encryptedData, phantomNonce, phantomPublicKey) {
  try {
    let secretKey = window.localStorage.getItem("flapn_phantomSessionSecretKey");
    if (!secretKey) {
      window.alert("Error: Missing session secret key for decrypting Phantom response.");
      return null;
    }

    // Decode everything
    secretKey = window.bs58.decode(secretKey);
    const phantomPubkey = window.bs58.decode(phantomPublicKey);
    const data = window.bs58.decode(encryptedData);
    const nonce = window.bs58.decode(phantomNonce);

    const sharedSecret = window.nacl.box.before(phantomPubkey, secretKey);

    // Decrypt the data
    const decryptedData = window.nacl.box.open.after(data, nonce, sharedSecret);

    if (!decryptedData) {
      window.alert("Error: Unable to decrypt Phantom sign response.");
      return null;
    }

    // Parse decrypted data as JSON
    const decodedString = new TextDecoder().decode(decryptedData);
    const jsonData = JSON.parse(decodedString);
    return jsonData;
  } catch (err) {
    window.alert("Error: " + err.toString());
    return null;
  }
}

function decryptPhantomSignTransactionResponse(encryptedData, phantomNonce, phantomPublicKey) {
  try {
    let secretKey = window.localStorage.getItem("flapn_phantomSessionSecretKey");
    if (!secretKey) {
      window.alert("Error: Missing session secret key for decrypting Phantom response.");
      return null;
    }

    // Decode everything
    secretKey = window.bs58.decode(secretKey);
    const phantomPubkey = window.bs58.decode(phantomPublicKey);
    const data = window.bs58.decode(encryptedData);
    const nonce = window.bs58.decode(phantomNonce);
    const sharedSecret = window.nacl.box.before(phantomPubkey, secretKey);

    // Decrypt the data
    const decryptedData = window.nacl.box.open.after(data, nonce, sharedSecret);
    if (!decryptedData) {
      window.alert("Error: Unable to decrypt Phantom transaction sign response.");
      return null;
    }

    // Parse decrypted data as JSON
    const decodedString = new TextDecoder().decode(decryptedData);
    const jsonData = JSON.parse(decodedString);
    return jsonData;
  } catch (err) {
    window.alert("Error: " + err.toString());
    return null;
  }
}

function encryptPayload(payload, nonce, sharedSecret)
{
  const payloadJSON = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJSON);

  const nonceBytes = window.bs58.decode(nonce);

  const encryptedPayload = window.nacl.secretbox(payloadBytes, nonceBytes, sharedSecret);

  const encryptedPayloadBS58 = window.bs58.encode(encryptedPayload);
  return encryptedPayloadBS58;
}

function signMessageWithDeeplink(message) {
  /*const phantomSession = decryptedData.session;
          window.localStorage.setItem("flapn_iOS_connectedWalletData", JSON.stringify({
            publicKey: connectedWalletPubkey,
            session: phantomSession,
            timestamp: Date.now(),
            sourceData: {
              data: data,
              nonce: nonce,
              phantom_encryption_public_key: phantomPublicKey
            }
          }));*/
  /*
            window.localStorage.setItem("flapn_phantomSessionPublicKey", sessionPubkey);
          window.localStorage.setItem("flapn_phantomSessionSecretKey", sessionSecretkey); */
  
  const connectedWalletData = JSON.parse(window.localStorage.getItem("flapn_iOS_connectedWalletData"));
  if(!connectedWalletData)
  {
    window.alert("Error: No wallet connected. Please connect your wallet first.");
    return Promise.reject(new Error("No wallet connected"));
  }

  const phantomSessionPubkey = window.localStorage.getItem("flapn_phantomSessionPublicKey");
  const phantomSessionSecretkey = window.localStorage.getItem("flapn_phantomSessionSecretKey");
  if(!phantomSessionPubkey || !phantomSessionSecretkey)
  {
    window.alert("Error: Missing Phantom session keys for signing message.");
    return Promise.reject(new Error("Missing Phantom session keys"));
  }

  // Generate unique nonce for this request
  const requestNonce = window.nacl.randomBytes(24);
  const requestNonceBS58 = window.bs58.encode(requestNonce);
  
  // Encode the message to base58
  const messageBytes = new TextEncoder().encode(message);
  const encodedMessage = window.bs58.encode(messageBytes);

  const payload = {
    message: encodedMessage,
    session: connectedWalletData.session,
    display: 'utf8'
  };

  const sharedSecret = window.nacl.box.before(window.bs58.decode(connectedWalletData.sourceData.phantom_encryption_public_key), window.bs58.decode(phantomSessionSecretkey));

  const encryptedPayload = encryptPayload(
    payload,
    requestNonceBS58,
    sharedSecret
  );

  const redirectURL = new URL(window.location.href);
  redirectURL.searchParams.append("onSignMessage", "true");
  redirectURL.searchParams.append("signRequestNonce", requestNonceBS58);

  const params = new URLSearchParams({
    dapp_encryption_public_key: phantomSessionPubkey,
    nonce: requestNonceBS58,
    redirect_link: redirectURL.toString(),
    payload: encryptedPayload,
  });

  // Store the request ID
  window.localStorage.setItem(`flapn_signRequest_${requestNonceBS58}`, JSON.stringify({
    message: message,
    timestamp: Date.now()
  }));

  // Return a promise
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.localStorage.removeItem(`flapn_signRequest_${requestNonceBS58}`);
      reject(new Error("Sign message timeout"));
    }, 5 * 60 * 1000);
    
    window[`flapn_signPromise_${requestNonceBS58}`] = { resolve, reject, timeout };
    
    // Trigger deep link
    const deepLink = `https://phantom.app/ul/v1/signMessage?${params.toString()}`;
    window.location.href = deepLink;
  });
}

function signTransactionWithDeeplink(transactionObject) {
  const connectedWalletData = JSON.parse(window.localStorage.getItem("flapn_iOS_connectedWalletData"));
  if(!connectedWalletData)
  {
    window.alert("Error: No wallet connected. Please connect your wallet first.");
    return Promise.reject(new Error("No wallet connected"));
  }

  const phantomSessionPubkey = window.localStorage.getItem("flapn_phantomSessionPublicKey");
  const phantomSessionSecretkey = window.localStorage.getItem("flapn_phantomSessionSecretKey");
  if(!phantomSessionPubkey || !phantomSessionSecretkey)
  {
    window.alert("Error: Missing Phantom session keys for signing message.");
    return Promise.reject(new Error("Missing Phantom session keys"));
  }

  // Generate unique nonce for this request
  const requestNonce = window.nacl.randomBytes(24);
  const requestNonceBS58 = window.bs58.encode(requestNonce);

  const serializedTx = transactionObject.serialize({
    requireAllSignatures: false,
    verifySignatures: false
  });
  const transactionBS58 = window.bs58.encode(serializedTx);

  const payload = {
    transaction: transactionBS58,
    session: connectedWalletData.session,
  };

  const sharedSecret = window.nacl.box.before(window.bs58.decode(connectedWalletData.sourceData.phantom_encryption_public_key), window.bs58.decode(phantomSessionSecretkey));
  const encryptedPayload = encryptPayload(
    payload,
    requestNonceBS58,
    sharedSecret
  );

  const redirectURL = new URL(window.location.href);
  redirectURL.searchParams.append("onSignTransaction", "true");
  redirectURL.searchParams.append("signRequestNonce", requestNonceBS58);

  const params = new URLSearchParams({
    dapp_encryption_public_key: phantomSessionPubkey,
    nonce: requestNonceBS58,
    redirect_link: redirectURL.toString(),
    payload: encryptedPayload,
  });

  // Store the request ID
  window.localStorage.setItem(`flapn_signRequest_${requestNonceBS58}`, JSON.stringify({
    transaction: transactionBS58,
    timestamp: Date.now()
  }));

  // Return a promise
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.localStorage.removeItem(`flapn_signRequest_${requestNonceBS58}`);
      reject(new Error("Sign transaction timeout"));
    }, 5 * 60 * 1000);

    window[`flapn_signPromise_${requestNonceBS58}`] = { resolve, reject, timeout };

    // Trigger deep link
    const deepLink = `https://phantom.app/ul/v1/signTransaction?${params.toString()}`;
    window.location.href = deepLink;
  });
}