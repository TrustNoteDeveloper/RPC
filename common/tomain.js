var fs = require("fs");
data='"use strict";exports.bServeAsHub=false;exports.bLight=true;exports.storage="sqlite";exports.hub="victor.trustnote.org/tn";exports.deviceName="Headless";exports.permanent_pairing_secret="randomstring";exports.control_addresses=["DEVICE ALLOWED TO CHAT"];exports.payout_address="WHERE THE MONEY CAN BE SENT TO";exports.KEYS_FILENAME="keys.json";exports.rpcInterface="127.0.0.1";exports.rpcPort="6332";console.log("finished headless conf");';
fs.writeFile('./conf.js',data,{flag:'w',encoding:'utf-8',mode:'0666'},function(err){
    console.log("mainnet now");
}) 
