# How to use RPC for trustnote light wallet?

1、install

```
git clone https://github.com/TrustNoteDevelopers/RPC.git
cd RPC
npm install
```

2、run RPC server
```
node rpc_server.js
```

## API


The node works as usual, plus it listens on port 6332 of loopback interface (configured in [conf.js](../blob/master/conf.js) or conf.json) for JSON-RPC commands.  The commands are `getnewaddress`, `getbalance`, `listtransactions`, `sendtoaddress`, `getaddressinfo`, `getaddressbalance`.

## getinfo

The command returns information about the current state of the DAG.
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"getinfo", "params":{} }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":{"last_mci":253151,"last_stable_mci":253120,"count_unhandled":0},"id":1}
```
The command has no parameters and returns and object with 3 keys:
* `last_mci`: the highest known main chain index (MCI)
* `last_stable_mci`: last stable MCI
* `count_unhandled`: number of unhandled units in the queue.  Large number indicates that sync is still in progress, 0 or small number means that the node is synced (it can occasionally go above 0 when new units are received out of order).

## checkAddress
The command returns information about the current address validity.
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"checkAddress", "params":["QZEM3UWTG5MPKYZYRMUZLNLX5AL437O3"] }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":{"ok"},"id":1}
```

## getalladdress
The command returns information about the addresses of wallet.
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"getalladdress", "params":{} }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":["0-0-QZEM3UWTG5MPKYZYRMUZLNLX5AL437O3"],"id":1}
```

## getnewaddress

This command generates a new TrustNote address in your wallet.  You will likely want to use it to create a new deposit address and bind it to a user account.

Example usage:
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"getnewaddress", "params":{} }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":"QZEM3UWTG5MPKYZYRMUZLNLX5AL437O3","id":1}
```
The command has no parameters and the response is a newly generated TrustNote address (32-character string).

## getbalance

Returns the balance of the specified address or the entire wallet.

Example usage for querying wallet balance:
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"getbalance", "params":{} }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":{"base":{"stable":8000,"pending":0}},"id":1}
```
Querying balance of an individual address:
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"getbalance", "params":["QZEM3UWTG5MPKYZYRMUZLNLX5AL437O3"] }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":{"base":{"stable":5000,"pending":0}},"id":1}
```
To query the balance of the entire wallet, parameters must be empty.  To query the balance of an individual address, pass it as the only element of the params array.

The response is an object, keyed by asset ID ("base" for notes).  For each asset, there is another nested object with keys `stable` and `pending` for stable and pending balances respectively.  Balances are in the smallest units (notes for the native currency), they are always integers.

If the queried address is invalid, you receive error "invalid address".  If the address does not belong to your wallet, you receive error "address not found".

## listtransactions

Use it to get the list of transactions on the wallet or on a specific address.

Example request for transactions on the entire wallet (all addresses):
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"listtransactions", "params":[] }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":[
  {"action":"received","amount":3000,"my_address":"YA3RYZ6FEUG3YEIDIJICGVPD6PPCTIZK","arrPayerAddresses":["EENED5HS2Y7IJ5HACSH4GHSCFRBLA6CN"],"confirmations":0,"unit":"sALugOU8fjVyUvtfKPP0pxlE74GlPqOJxMbwxA1B+eE=","fee":588,"time":"1490452729","level":253518},
  {"action":"received","amount":5000,"my_address":"QZEM3UWTG5MPKYZYRMUZLNLX5AL437O3","arrPayerAddresses":["UOOHQW4ZKPTII4ZEE4ENAM5PC6LWAQHQ"],"confirmations":1,"unit":"vlt1vzMtLCIpb8K+IrvqdpNLA9DkkNAGABJ420NvOBs=","fee":541,"time":"1490452322","level":253483}
],"id":1}
```
On individual address:
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"listtransactions", "params":["QZEM3UWTG5MPKYZYRMUZLNLX5AL437O3"] }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":[
  {"action":"received","amount":5000,"my_address":"QZEM3UWTG5MPKYZYRMUZLNLX5AL437O3","arrPayerAddresses":["UOOHQW4ZKPTII4ZEE4ENAM5PC6LWAQHQ"],"confirmations":0,"unit":"vlt1vzMtLCIpb8K+IrvqdpNLA9DkkNAGABJ420NvOBs=","fee":541,"time":"1490452322","level":253483}
],"id":1}
```
To query the transactions on an individual address, pass it as the only element of the `params` array.  If the passed address is invalid, you receive error "invalid address".

To query the list of transactions since a particular main chain index (MCI), specify `since_mci` property in the `params` object: `"params": {"since_mci":254000}`.  The full list of matching transactions will be returned, however large it is.

To query an individual transaction, specify its unit in the `params` object: `"params": {"unit":"vlt1vzMtLCIpb8K+IrvqdpNLA9DkkNAGABJ420NvOBs="}`.

To query the 200 most recent transactions on your wallet, leave the parameters empty.

The response is an array of transactions in reverse chronological order.

Each transaction is described by an object with the following fields:
* `action`: string, one of `invalid`, `received`, `sent`, `moved`.
* `amount`: integer, amount of the transaction in the smallest units
* `my_address`: string, the address that belongs to your wallet and received funds (for `received` and `moved` only)
* `arrPayerAddresses`: array of payer addresses (for `received` only)
* `confirmations`: integer 0 (pending) or 1 (final), shows confirmation status of the transaction
* `unit`: string, unit of the transaction (also known as transaction id)
* `fee`: integer, fee in notes
* `time`: integer, seconds since the Epoch
* `level`: integer, level of the unit in the DAG
* `mci`: integer, MCI of the unit.  It can change while the unit is still pending and becomes immutable after the unit gets final

To operate an exchange, you'll want to wait for deposits by periodically calling `listtransactions` without parameters, looking for transactions with `action`s `received` and `moved` (you need `moved` in case one user withdraws to a deposit address of another user) and identifying the user by `my_address`.

# sendtoaddress

Use this command to withdraw notes.  Example usage:
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"sendtoaddress", "params":["BVVJ2K7ENPZZ3VYZFWQWK7ISPCATFIW3", 1000] }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":"vuudtbL5ASwr0LJZ9tuV4S0j/lIsotJCKifphvGATmU=","id":1}


$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"sendtoaddress", "params":["R2CJ353CPFT6ZB372H324A5VYOGPVOKI", 5,"QXZVREFQWR0pM0qrZ+d+HIeJTEyMkd/rgB7/Syp6Ufk="] }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":"ggg5kDOUBz43x4WOiOPI7Ku+rx1UiTzEqw6swwYGGEs=","id":1}
```

When there are two parameters to this command: destination address (string) and amount in notes (integer), The third parameter is your publish token, defalut is TTT's token,  On success, the response is the unit of the spending transaction (string).  If the command failed, an error message is returned.  It is possible that the command returns error due to lack of confirmed funds, in this case you should retry the command in a few minutes.

If the destination address is invalid, the command returns error "invalid address".  To avoid this, it is recommended to validate user-entered withdrawal address using [TrustNote-common](../../trustnote-common) library:
```
var validationUtils = require("common/validation_utils.js");
if (!validationUtils.isValidAddress(address)){
  // notify user that the entered TrustNote address is invalid
}
```

## getaddressinfo

Returns the balance and transactions  of the specified address or the entire wallet.

Example usage for querying wallet balance:
```
$ curl --data '{"jsonrpc":"2.0", "id":1, "method":"getaddressinfo", "params":["AC32OSLNT64L2B2GARP7SNFDPR3WDNZZ"] }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":{ "objTransactions":{ ... }, "objBalance":{ ...}, id":1} }};
```


## getaddressbalance

Only returns  the balance and transactions  of the specified address;

```
curl --data '{"jsonrpc":"2.0", "id":1, "method":"getaddressbalance", "params": ["AC32OSLNT64L2B2GARP7SNFDPR3WDNZZ"] }' http://127.0.0.1:6332
{"jsonrpc":"2.0","result":{"address":"AC32OSLNT64L2B2GARP7SNFDPR3WDNZZ","objBalance":{"bytes":0,"QXZVREFQWR0pM0qrZ+d+HIeJTEyMkd/rgB7/Syp6Ufk=":10000}},"id":1}
```

# 中文版使用方法：
https://github.com/TrustNoteDevelopers/RPC/wiki/%E5%A6%82%E4%BD%95%E4%BD%BF%E7%94%A8RPC
