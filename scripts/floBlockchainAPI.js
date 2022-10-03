(function(EXPORTS) { //floBlockchainAPI v2.3.3b
    /* FLO Blockchain Operator to send/receive data from blockchain using API calls*/
    'use strict';
    const floBlockchainAPI = EXPORTS;

    const DEFAULT = {
        blockchain: floGlobals.blockchain,
        apiURL: {
            FLO: ['https://flosight.duckdns.org/'],
            FLO_TEST: ['https://testnet-flosight.duckdns.org', 'https://testnet.flocha.in/']
        },
        sendAmt: 0.001,
        fee: 0.0005,
        receiverID: floGlobals.adminID
    };

    Object.defineProperties(floBlockchainAPI, {
        sendAmt: {
            get: () => DEFAULT.sendAmt,
            set: amt => !isNaN(amt) ? DEFAULT.sendAmt = amt : null
        },
        fee: {
            get: () => DEFAULT.fee,
            set: fee => !isNaN(fee) ? DEFAULT.fee = fee : null
        },
        defaultReceiver: {
            get: () => DEFAULT.receiverID,
            set: floID => DEFAULT.receiverID = floID
        },
        blockchain: {
            get: () => DEFAULT.blockchain
        }
    });

    if (floGlobals.sendAmt) floBlockchainAPI.sendAmt = floGlobals.sendAmt;
    if (floGlobals.fee) floBlockchainAPI.fee = floGlobals.fee;

    Object.defineProperties(floGlobals, {
        sendAmt: {
            get: () => DEFAULT.sendAmt,
            set: amt => !isNaN(amt) ? DEFAULT.sendAmt = amt : null
        },
        fee: {
            get: () => DEFAULT.fee,
            set: fee => !isNaN(fee) ? DEFAULT.fee = fee : null
        }
    });

    const allServerList = new Set(floGlobals.apiURL && floGlobals.apiURL[DEFAULT.blockchain] ? floGlobals.apiURL[DEFAULT.blockchain] : DEFAULT.apiURL[DEFAULT.blockchain]);

    var serverList = Array.from(allServerList);
    var curPos = floCrypto.randInt(0, serverList.length - 1);

    function fetch_retry(apicall, rm_flosight) {
        return new Promise((resolve, reject) => {
            let i = serverList.indexOf(rm_flosight)
            if (i != -1) serverList.splice(i, 1);
            curPos = floCrypto.randInt(0, serverList.length - 1);
            fetch_api(apicall, false)
                .then(result => resolve(result))
                .catch(error => reject(error));
        })
    }

    function fetch_api(apicall, ic = true) {
        return new Promise((resolve, reject) => {
            if (serverList.length === 0) {
                if (ic) {
                    serverList = Array.from(allServerList);
                    curPos = floCrypto.randInt(0, serverList.length - 1);
                    fetch_api(apicall, false)
                        .then(result => resolve(result))
                        .catch(error => reject(error));
                } else
                    reject("No floSight server working");
            } else {
                let flosight = serverList[curPos];
                fetch(flosight + apicall).then(response => {
                    if (response.ok)
                        response.json().then(data => resolve(data));
                    else {
                        fetch_retry(apicall, flosight)
                            .then(result => resolve(result))
                            .catch(error => reject(error));
                    }
                }).catch(error => {
                    fetch_retry(apicall, flosight)
                        .then(result => resolve(result))
                        .catch(error => reject(error));
                })
            }
        })
    }

    Object.defineProperties(floBlockchainAPI, {
        serverList: {
            get: () => Array.from(serverList)
        },
        current_server: {
            get: () => serverList[curPos]
        }
    });

    //Promised function to get data from API
    const promisedAPI = floBlockchainAPI.promisedAPI = floBlockchainAPI.fetch = function(apicall) {
        return new Promise((resolve, reject) => {
            //console.log(apicall);
            fetch_api(apicall)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    }

    //Get balance for the given Address
    const getBalance = floBlockchainAPI.getBalance = function(addr) {
        return new Promise((resolve, reject) => {
            promisedAPI(`api/addr/${addr}/balance`)
                .then(balance => resolve(parseFloat(balance)))
                .catch(error => reject(error));
        });
    }

    //Send Tx to blockchain 
    const sendTx = floBlockchainAPI.sendTx = function(senderAddr, receiverAddr, sendAmt, privKey, floData = '', strict_utxo = true) {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateASCII(floData))
                return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
            else if (!floCrypto.validateFloID(senderAddr))
                return reject(`Invalid address : ${senderAddr}`);
            else if (!floCrypto.validateFloID(receiverAddr))
                return reject(`Invalid address : ${receiverAddr}`);
            else if (privKey.length < 1 || !floCrypto.verifyPrivKey(privKey, senderAddr))
                return reject("Invalid Private key!");
            else if (typeof sendAmt !== 'number' || sendAmt <= 0)
                return reject(`Invalid sendAmt : ${sendAmt}`);

            getBalance(senderAddr).then(balance => {
                var fee = DEFAULT.fee;
                if (balance < sendAmt + fee)
                    return reject("Insufficient FLO balance!");
                //get unconfirmed tx list
                promisedAPI(`api/addr/${senderAddr}`).then(result => {
                    readTxs(senderAddr, 0, result.unconfirmedTxApperances).then(result => {
                        let unconfirmedSpent = {};
                        for (let tx of result.items)
                            if (tx.confirmations == 0)
                                for (let vin of tx.vin)
                                    if (vin.addr === senderAddr) {
                                        if (Array.isArray(unconfirmedSpent[vin.txid]))
                                            unconfirmedSpent[vin.txid].push(vin.vout);
                                        else
                                            unconfirmedSpent[vin.txid] = [vin.vout];
                                    }
                        //get utxos list
                        promisedAPI(`api/addr/${senderAddr}/utxo`).then(utxos => {
                            //form/construct the transaction data
                            var trx = bitjs.transaction();
                            var utxoAmt = 0.0;
                            for (var i = utxos.length - 1;
                                (i >= 0) && (utxoAmt < sendAmt + fee); i--) {
                                //use only utxos with confirmations (strict_utxo mode)
                                if (utxos[i].confirmations || !strict_utxo) {
                                    if (utxos[i].txid in unconfirmedSpent && unconfirmedSpent[utxos[i].txid].includes(utxos[i].vout))
                                        continue; //A transaction has already used the utxo, but is unconfirmed.
                                    trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                                    utxoAmt += utxos[i].amount;
                                };
                            }
                            if (utxoAmt < sendAmt + fee)
                                reject("Insufficient FLO: Some UTXOs are unconfirmed");
                            else {
                                trx.addoutput(receiverAddr, sendAmt);
                                var change = utxoAmt - sendAmt - fee;
                                if (change > 0)
                                    trx.addoutput(senderAddr, change);
                                trx.addflodata(floData.replace(/\n/g, ' '));
                                var signedTxHash = trx.sign(privKey, 1);
                                broadcastTx(signedTxHash)
                                    .then(txid => resolve(txid))
                                    .catch(error => reject(error))
                            }
                        }).catch(error => reject(error))
                    }).catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        });
    }

    //Write Data into blockchain
    floBlockchainAPI.writeData = function(senderAddr, data, privKey, receiverAddr = DEFAULT.receiverID, options = {}) {
        let strict_utxo = options.strict_utxo === false ? false : true,
            sendAmt = isNaN(options.sendAmt) ? DEFAULT.sendAmt : options.sendAmt;
        return new Promise((resolve, reject) => {
            if (typeof data != "string")
                data = JSON.stringify(data);
            sendTx(senderAddr, receiverAddr, sendAmt, privKey, data, strict_utxo)
                .then(txid => resolve(txid))
                .catch(error => reject(error));
        });
    }

    //merge all UTXOs of a given floID into a single UTXO
    floBlockchainAPI.mergeUTXOs = function(floID, privKey, floData = '') {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateFloID(floID))
                return reject(`Invalid floID`);
            if (!floCrypto.verifyPrivKey(privKey, floID))
                return reject("Invalid Private Key");
            if (!floCrypto.validateASCII(floData))
                return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
            var trx = bitjs.transaction();
            var utxoAmt = 0.0;
            var fee = DEFAULT.fee;
            promisedAPI(`api/addr/${floID}/utxo`).then(utxos => {
                for (var i = utxos.length - 1; i >= 0; i--)
                    if (utxos[i].confirmations) {
                        trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                        utxoAmt += utxos[i].amount;
                    }
                trx.addoutput(floID, utxoAmt - fee);
                trx.addflodata(floData.replace(/\n/g, ' '));
                var signedTxHash = trx.sign(privKey, 1);
                broadcastTx(signedTxHash)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    /**Write data into blockchain from (and/or) to multiple floID
     * @param  {Array} senderPrivKeys List of sender private-keys
     * @param  {string} data FLO data of the txn
     * @param  {Array} receivers List of receivers
     * @param  {boolean} preserveRatio (optional) preserve ratio or equal contribution
     * @return {Promise}
     */
    floBlockchainAPI.writeDataMultiple = function(senderPrivKeys, data, receivers = [DEFAULT.receiverID], preserveRatio = true) {
        return new Promise((resolve, reject) => {
            if (!Array.isArray(senderPrivKeys))
                return reject("Invalid senderPrivKeys: SenderPrivKeys must be Array");
            if (!preserveRatio) {
                let tmp = {};
                let amount = (DEFAULT.sendAmt * receivers.length) / senderPrivKeys.length;
                senderPrivKeys.forEach(key => tmp[key] = amount);
                senderPrivKeys = tmp;
            }
            if (!Array.isArray(receivers))
                return reject("Invalid receivers: Receivers must be Array");
            else {
                let tmp = {};
                let amount = DEFAULT.sendAmt;
                receivers.forEach(floID => tmp[floID] = amount);
                receivers = tmp
            }
            if (typeof data != "string")
                data = JSON.stringify(data);
            sendTxMultiple(senderPrivKeys, receivers, data)
                .then(txid => resolve(txid))
                .catch(error => reject(error))
        })
    }

    /**Send Tx from (and/or) to multiple floID
     * @param  {Array or Object} senderPrivKeys List of sender private-key (optional: with coins to be sent)
     * @param  {Object} receivers List of receivers with respective amount to be sent
     * @param  {string} floData FLO data of the txn
     * @return {Promise}
     */
    const sendTxMultiple = floBlockchainAPI.sendTxMultiple = function(senderPrivKeys, receivers, floData = '') {
        return new Promise((resolve, reject) => {
            if (!floCrypto.validateASCII(floData))
                return reject("Invalid FLO_Data: only printable ASCII characters are allowed");
            let senders = {},
                preserveRatio;
            //check for argument validations
            try {
                let invalids = {
                    InvalidSenderPrivKeys: [],
                    InvalidSenderAmountFor: [],
                    InvalidReceiverIDs: [],
                    InvalidReceiveAmountFor: []
                }
                let inputVal = 0,
                    outputVal = 0;
                //Validate sender privatekeys (and send amount if passed)
                //conversion when only privateKeys are passed (preserveRatio mode)
                if (Array.isArray(senderPrivKeys)) {
                    senderPrivKeys.forEach(key => {
                        try {
                            if (!key)
                                invalids.InvalidSenderPrivKeys.push(key);
                            else {
                                let floID = floCrypto.getFloID(key);
                                senders[floID] = {
                                    wif: key
                                }
                            }
                        } catch (error) {
                            invalids.InvalidSenderPrivKeys.push(key)
                        }
                    })
                    preserveRatio = true;
                }
                //conversion when privatekeys are passed with send amount
                else {
                    for (let key in senderPrivKeys) {
                        try {
                            if (!key)
                                invalids.InvalidSenderPrivKeys.push(key);
                            else {
                                if (typeof senderPrivKeys[key] !== 'number' || senderPrivKeys[key] <= 0)
                                    invalids.InvalidSenderAmountFor.push(key);
                                else
                                    inputVal += senderPrivKeys[key];
                                let floID = floCrypto.getFloID(key);
                                senders[floID] = {
                                    wif: key,
                                    coins: senderPrivKeys[key]
                                }
                            }
                        } catch (error) {
                            invalids.InvalidSenderPrivKeys.push(key)
                        }
                    }
                    preserveRatio = false;
                }
                //Validate the receiver IDs and receive amount
                for (let floID in receivers) {
                    if (!floCrypto.validateFloID(floID))
                        invalids.InvalidReceiverIDs.push(floID);
                    if (typeof receivers[floID] !== 'number' || receivers[floID] <= 0)
                        invalids.InvalidReceiveAmountFor.push(floID);
                    else
                        outputVal += receivers[floID];
                }
                //Reject if any invalids are found
                for (let i in invalids)
                    if (!invalids[i].length)
                        delete invalids[i];
                if (Object.keys(invalids).length)
                    return reject(invalids);
                //Reject if given inputVal and outputVal are not equal
                if (!preserveRatio && inputVal != outputVal)
                    return reject(`Input Amount (${inputVal}) not equal to Output Amount (${outputVal})`);
            } catch (error) {
                return reject(error)
            }
            //Get balance of senders
            let promises = [];
            for (let floID in senders)
                promises.push(getBalance(floID));
            Promise.all(promises).then(results => {
                let totalBalance = 0,
                    totalFee = DEFAULT.fee,
                    balance = {};
                //Divide fee among sender if not for preserveRatio
                if (!preserveRatio)
                    var dividedFee = totalFee / Object.keys(senders).length;
                //Check if balance of each sender is sufficient enough
                let insufficient = [];
                for (let floID in senders) {
                    balance[floID] = parseFloat(results.shift());
                    if (isNaN(balance[floID]) || (preserveRatio && balance[floID] <= totalFee) ||
                        (!preserveRatio && balance[floID] < senders[floID].coins + dividedFee))
                        insufficient.push(floID);
                    totalBalance += balance[floID];
                }
                if (insufficient.length)
                    return reject({
                        InsufficientBalance: insufficient
                    })
                //Calculate totalSentAmount and check if totalBalance is sufficient
                let totalSendAmt = totalFee;
                for (let floID in receivers)
                    totalSendAmt += receivers[floID];
                if (totalBalance < totalSendAmt)
                    return reject("Insufficient total Balance");
                //Get the UTXOs of the senders
                let promises = [];
                for (let floID in senders)
                    promises.push(promisedAPI(`api/addr/${floID}/utxo`));
                Promise.all(promises).then(results => {
                    let wifSeq = [];
                    var trx = bitjs.transaction();
                    for (let floID in senders) {
                        let utxos = results.shift();
                        let sendAmt;
                        if (preserveRatio) {
                            let ratio = (balance[floID] / totalBalance);
                            sendAmt = totalSendAmt * ratio;
                        } else
                            sendAmt = senders[floID].coins + dividedFee;
                        let wif = senders[floID].wif;
                        let utxoAmt = 0.0;
                        for (let i = utxos.length - 1;
                            (i >= 0) && (utxoAmt < sendAmt); i--) {
                            if (utxos[i].confirmations) {
                                trx.addinput(utxos[i].txid, utxos[i].vout, utxos[i].scriptPubKey);
                                wifSeq.push(wif);
                                utxoAmt += utxos[i].amount;
                            }
                        }
                        if (utxoAmt < sendAmt)
                            return reject("Insufficient balance:" + floID);
                        let change = (utxoAmt - sendAmt);
                        if (change > 0)
                            trx.addoutput(floID, change);
                    }
                    for (let floID in receivers)
                        trx.addoutput(floID, receivers[floID]);
                    trx.addflodata(floData.replace(/\n/g, ' '));
                    for (let i = 0; i < wifSeq.length; i++)
                        trx.signinput(i, wifSeq[i], 1);
                    var signedTxHash = trx.serialize();
                    broadcastTx(signedTxHash)
                        .then(txid => resolve(txid))
                        .catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        })
    }

    //Broadcast signed Tx in blockchain using API
    const broadcastTx = floBlockchainAPI.broadcastTx = function(signedTxHash) {
        return new Promise((resolve, reject) => {
            if (signedTxHash.length < 1)
                return reject("Empty Signature");
            var url = serverList[curPos] + 'api/tx/send';
            fetch(url, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: `{"rawtx":"${signedTxHash}"}`
            }).then(response => {
                if (response.ok)
                    response.json().then(data => resolve(data.txid.result));
                else
                    response.text().then(data => resolve(data));
            }).catch(error => reject(error));
        })
    }

    floBlockchainAPI.getTx = function(txid) {
        return new Promise((resolve, reject) => {
            promisedAPI(`api/tx/${txid}`)
                .then(response => resolve(response))
                .catch(error => reject(error))
        })
    }

    //Read Txs of Address between from and to
    const readTxs = floBlockchainAPI.readTxs = function(addr, from, to) {
        return new Promise((resolve, reject) => {
            promisedAPI(`api/addrs/${addr}/txs?from=${from}&to=${to}`)
                .then(response => resolve(response))
                .catch(error => reject(error))
        });
    }

    //Read All Txs of Address (newest first)
    floBlockchainAPI.readAllTxs = function(addr) {
        return new Promise((resolve, reject) => {
            promisedAPI(`api/addrs/${addr}/txs?from=0&to=1`).then(response => {
                promisedAPI(`api/addrs/${addr}/txs?from=0&to=${response.totalItems}0`)
                    .then(response => resolve(response.items))
                    .catch(error => reject(error));
            }).catch(error => reject(error))
        });
    }

    /*Read flo Data from txs of given Address
    options can be used to filter data
    limit       : maximum number of filtered data (default = 1000, negative  = no limit)
    ignoreOld   : ignore old txs (default = 0)
    sentOnly    : filters only sent data
    receivedOnly: filters only received data
    pattern     : filters data that with JSON pattern
    filter      : custom filter funtion for floData (eg . filter: d => {return d[0] == '$'})
    tx          : (boolean) resolve tx data or not (resolves an Array of Object with tx details)
    sender      : flo-id(s) of sender
    receiver    : flo-id(s) of receiver
    */
    floBlockchainAPI.readData = function(addr, options = {}) {
        options.limit = options.limit || 0;
        options.ignoreOld = options.ignoreOld || 0;
        if (typeof options.sender === "string") options.sender = [options.sender];
        if (typeof options.receiver === "string") options.receiver = [options.receiver];
        return new Promise((resolve, reject) => {
            promisedAPI(`api/addrs/${addr}/txs?from=0&to=1`).then(response => {
                var newItems = response.totalItems - options.ignoreOld;
                promisedAPI(`api/addrs/${addr}/txs?from=0&to=${newItems*2}`).then(response => {
                    if (options.limit <= 0)
                        options.limit = response.items.length;
                    var filteredData = [];
                    let numToRead = response.totalItems - options.ignoreOld,
                        unconfirmedCount = 0;
                    for (let i = 0; i < numToRead && filteredData.length < options.limit; i++) {
                        if (!response.items[i].confirmations) { //unconfirmed transactions
                            unconfirmedCount++;
                            if (numToRead < response.items[i].length)
                                numToRead++;
                            continue;
                        }
                        if (options.pattern) {
                            try {
                                let jsonContent = JSON.parse(response.items[i].floData);
                                if (!Object.keys(jsonContent).includes(options.pattern))
                                    continue;
                            } catch (error) {
                                continue;
                            }
                        }
                        if (options.sentOnly) {
                            let flag = false;
                            for (let vin of response.items[i].vin)
                                if (vin.addr === addr) {
                                    flag = true;
                                    break;
                                }
                            if (!flag) continue;
                        }
                        if (Array.isArray(options.sender)) {
                            let flag = false;
                            for (let vin of response.items[i].vin)
                                if (options.sender.includes(vin.addr)) {
                                    flag = true;
                                    break;
                                }
                            if (!flag) continue;
                        }
                        if (options.receivedOnly) {
                            let flag = false;
                            for (let vout of response.items[i].vout)
                                if (vout.scriptPubKey.addresses[0] === addr) {
                                    flag = true;
                                    break;
                                }
                            if (!flag) continue;
                        }
                        if (Array.isArray(options.receiver)) {
                            let flag = false;
                            for (let vout of response.items[i].vout)
                                if (options.receiver.includes(vout.scriptPubKey.addresses[0])) {
                                    flag = true;
                                    break;
                                }
                            if (!flag) continue;
                        }
                        if (options.filter && !options.filter(response.items[i].floData))
                            continue;

                        if (options.tx) {
                            let d = {}
                            d.txid = response.items[i].txid;
                            d.time = response.items[i].time;
                            d.blockheight = response.items[i].blockheight;
                            d.data = response.items[i].floData;
                            filteredData.push(d);
                        } else
                            filteredData.push(response.items[i].floData);
                    }
                    resolve({
                        totalTxs: response.totalItems - unconfirmedCount,
                        data: filteredData
                    });
                }).catch(error => {
                    reject(error);
                });
            }).catch(error => {
                reject(error);
            });
        });
    }


})('object' === typeof module ? module.exports : window.floBlockchainAPI = {});