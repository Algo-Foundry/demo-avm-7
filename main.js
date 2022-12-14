const algosdk = require("algosdk");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const algodClient = new algosdk.Algodv2(
  process.env.ALGOD_TOKEN,
  process.env.ALGOD_SERVER,
  process.env.ALGOD_PORT
);

const creator = algosdk.mnemonicToSecretKey(process.env.CREATOR_MNEMONIC);
const acc1 = algosdk.mnemonicToSecretKey(process.env.ACC1_MNEMONIC);

const submitAtomicToNetwork = async (txns) => {
  const { txn } = algosdk.decodeSignedTransaction(txns[txns.length - 1]);

  // send txn
  let tx = await algodClient.sendRawTransaction(txns).do();
  console.log("Transaction : " + tx.txId);

  // check results of very last txn
  let confirmedTxn = await algosdk.waitForConfirmation(algodClient, txn.txID(), 30);

  console.log(confirmedTxn);

  return confirmedTxn;
}

const transferAlgos = async (from, to, amount) => {
  const suggestedParams = await algodClient.getTransactionParams().do();

  let txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from,
    to,
    amount,
    suggestedParams
  });

  return txn;
}

const getBasicProgramBytes = async (filename) => {
  // Read file for Teal code
  const filePath = path.join(__dirname, filename);
  const data = fs.readFileSync(filePath);

  // use algod to compile the program
  const compiledProgram = await algodClient.compile(data).do();
  return new Uint8Array(Buffer.from(compiledProgram.result, "base64"));
};

const deployCounterApp = async (creator) => {
  // define application parameters
  const from = creator.addr;
  const onComplete = algosdk.OnApplicationComplete.NoOpOC;
  const approvalProgram = await getBasicProgramBytes("./artifacts/sc_approval.teal");
  const clearProgram = await getBasicProgramBytes("./artifacts/sc_clearstate.teal");
  const numLocalInts = 0;
  const numLocalByteSlices = 0;
  const numGlobalInts = 1; //using global state to store value of "count"
  const numGlobalByteSlices = 0;
  const appArgs = [];

  // get suggested params
  const suggestedParams = await algodClient.getTransactionParams().do();

  // create the application creation transaction
  const createTxn = algosdk.makeApplicationCreateTxn(
    from,
    suggestedParams,
    onComplete,
    approvalProgram,
    clearProgram,
    numLocalInts,
    numLocalByteSlices,
    numGlobalInts,
    numGlobalByteSlices,
    appArgs
  );

  const signedCreateTxn = createTxn.signTxn(creator.sk);
  const confirmedTxn = await submitAtomicToNetwork([signedCreateTxn]);
  
  // read global state
  const appId = confirmedTxn["application-index"];
  console.log("App ID:", appId);
  
  return appId;
}

const appCall = async (sender, appId, appArgs) => {
  // get suggested params
  const suggestedParams = await algodClient.getTransactionParams().do();

  // call the created application
  const callTxn = algosdk.makeApplicationNoOpTxnFromObject({
    from: sender.addr,
    appIndex: appId,
    suggestedParams,
    appArgs 
  });

  return callTxn;
}

const readGlobalState = async (appId) => {
  const app = await algodClient.getApplicationByID(appId).do();
  
  // global state is a key value array
  const globalState = app.params["global-state"];
  const formattedGlobalState = globalState.map(item => {
    // decode from base64 and utf8
    const formattedKey = decodeURIComponent(Buffer.from(item.key, "base64"));

    let formattedValue;
    if (item.value.type === 1) {
      if (formattedKey === "voted") {
        formattedValue = decodeURIComponent(Buffer.from(item.value.bytes, "base64"));
      } else {
        formattedValue = item.value.bytes;
      }
    } else {
      formattedValue = item.value.uint;
    }
    
    return {
      key: formattedKey,
      value: formattedValue
    }
  });

  console.log(formattedGlobalState);
}

(async () => {
  // deploy counter app
  if (process.env.APP_ID !== "") {
    console.log("loading app from env");
    appId = Number(process.env.APP_ID);
  } else {
    console.log("deploying app");
    appId = await deployCounterApp(creator);
  }

  // sender acc is a new acc with no algos
  const sender = algosdk.generateAccount();
  console.log("sender: ", sender.addr);

  // txn1: call application to add counter
  let addAppArgs = [];
  addAppArgs.push(new Uint8Array(Buffer.from("Add")));
  let txn1 = await appCall(sender, appId, addAppArgs);
  txn1.fee = 0;

  // txn2: creator will pay extra fees to cover txn1
  let txn2 = await transferAlgos(creator.addr, acc1.addr, 1000000);
  txn2.fee *= 2;

  // submit atomic
  const txns = algosdk.assignGroupID([txn1, txn2]);
  const signedTxns = [
    txns[0].signTxn(sender.sk),
    txns[1].signTxn(creator.sk)
  ];

  try {
    await submitAtomicToNetwork(signedTxns);
    await readGlobalState(appId);
  } catch (err) {
    console.log(err.message);
  }
})();
