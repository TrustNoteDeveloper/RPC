'use strict'

const url = 'http://127.0.0.1:6332';
const request = require('request-promise-native');

async function test () {
    let opt = {
        url : url,
        method : 'POST'
    };

    let body = {};
    body.jsonrpc = "2.0";
    body.id = "1";

    // body.method = 'getaddressbalance';
    body.params = ['AC32OSLNT64L2B2GARP7SNFDPR3WDNZZ'];
    
    // body.method =  'getbalance';
    // body.method =  'getalladdress';
    // body.method = 'getnewaddress';
    // body.method = 'listtransactions';
    body.method = 'getaddressinfo';
    
    opt.body = JSON.stringify(body);
    let ret  = await request(opt);
    ret = JSON.parse(ret);

    console.log(JSON.stringify(ret, null, 3));
    if (ret.result) {
        console.log('list transactions count:', ret.result.length);
    }
}

test();

//curl --data '{"jsonrpc":"2.0", "id":1, "method":"getnewaddress", "params":{} }' http://127.0.0.1:6332
//curl --data '{"jsonrpc":"2.0", "id":1, "method":"sendtoaddress", "params":["R2CJ353CPFT6ZB372H324A5VYOGPVOKI", 5] }' http://127.0.0.1:8090
//curl --data '{"jsonrpc":"2.0", "id":1, "method":"getbalance", "params":{} }' http://127.0.0.1:6332
//curl --data '{"jsonrpc":"2.0", "id":1, "method":"getaddressbalance", "params": ["AC32OSLNT64L2B2GARP7SNFDPR3WDNZZ"] }' http://127.0.0.1:6332
//curl --data '{"jsonrpc":"2.0", "id":1, "method":"sendtoaddresswithmemo", "params":["JG5HQIFERIMWW27GIND3SSUDO3VN434M", 5 , '输入你的text'] }' http://127.0.0.1:6332









