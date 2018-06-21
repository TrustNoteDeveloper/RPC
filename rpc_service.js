/*jslint node: true */

/*
	Accept commands via JSON-RPC API.
	The daemon listens on port 6552 by default.
*/

"use strict";
var headlessWallet = require('./start.js');
var conf = require('./trustnote-common/conf.js');
var eventBus = require('./trustnote-common/event_bus.js');
var db = require('./trustnote-common/db.js');
var mutex = require('./trustnote-common/mutex.js');
var storage = require('./trustnote-common/storage.js');
var constants = require('./trustnote-common/constants.js');
var validationUtils = require("./trustnote-common/validation_utils.js");
var wallet_id;

if (conf.bSingleAddress)
	throw Error('can`t run in single address mode');

function initRPC() {
	var composer = require('./trustnote-common/composer.js');
	var network = require('./trustnote-common/network.js');

	var rpc = require('json-rpc2');
	var walletDefinedByKeys = require('./trustnote-common/wallet_defined_by_keys.js');
	var Wallet = require('./trustnote-common/wallet.js');
	var balances = require('./trustnote-common/balances.js');

	var server = rpc.Server.$create({
		'websocket': true, // is true by default
		'headers': { // allow custom headers is empty by default
			'Access-Control-Allow-Origin': '*'
		}
	});

	/**
	 * Returns information about the current state.
	 * @return { last_mci: {Integer}, last_stable_mci: {Integer}, count_unhandled: {Integer} }
	 */
	server.expose('getinfo', function(args, opt, cb) {
		var response = {};
		storage.readLastMainChainIndex(function(last_mci){
			response.last_mci = last_mci;
			storage.readLastStableMcIndex(db, function(last_stable_mci){
				response.last_stable_mci = last_stable_mci;
				db.query("SELECT COUNT(*) AS count_unhandled FROM unhandled_joints", function(rows){
					response.count_unhandled = rows[0].count_unhandled;
					cb(null, response);
				});
			});
		});
	});

	/**
	 * Creates and returns new wallet address.
	 * @return {String} address
	 */
	server.expose('getnewaddress', function(args, opt, cb) {
		mutex.lock(['rpc_getnewaddress'], function(unlock){
			walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(addressInfo) {
				unlock();
				cb(null, addressInfo.address);
			});
		});
	});
	
	/**
	 * get all wallet address.
	 * @return [String] address
	 */
	server.expose('getalladdress', function(args, opt, cb) {
		if(args.length > 0) {
			var address = args[0];
		}
		mutex.lock(['rpc_getalladdress'], function(unlock){
			walletDefinedByKeys.readAllAddressesAndIndex(wallet_id, function(addressList) {
				unlock();
				if(address) {
					var is_exist = false;
					for (var i in addressList) {
					    if (addressList[i].indexOf(address) > 0) {
						cb(null, addressList[i]);
						is_exist = true;
						break;
					    }
					}
					if(!is_exist)
						cb("unknow address");
				}
				else {
					cb(null, addressList);
				}
			});
		});
	});

	/**
	 * check address is valid.
	 * @return [string] msg
	 */
	server.expose('checkAddress', function(args, opt, cb) {
		var address = args[0];
		if(address) {
			if(validationUtils.isValidAddress(address)) {
				cb(null, "ok");
			}
			else {
				cb("invalid address");
			}
		}
		else {
			cb("invalid address");
		}
	});

	/**
	 * Returns address balance(stable and pending).
	 * If address is invalid, then returns "invalid address".
	 * If your wallet doesn`t own the address, then returns "address not found".
	 * @param {String} address
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 *
	 * If no address supplied, returns wallet balance(stable and pending).
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getbalance', function(args, opt, cb) {
		var address = args[0];
		if (address) {
			if (validationUtils.isValidAddress(address))
				db.query("SELECT COUNT(*) AS count FROM my_addresses WHERE address = ?", [address], function(rows) {
					if (rows[0].count)
						db.query(
							"SELECT asset, is_stable, SUM(amount) AS balance \n\
							FROM outputs JOIN units USING(unit) \n\
							WHERE is_spent=0 AND address=? AND sequence='good' AND asset IS NULL \n\
							GROUP BY is_stable", [address],
							function(rows) {
								var balance = {
									base: {
										stable: 0,
										pending: 0
									}
								};
								for (var i = 0; i < rows.length; i++) {
									var row = rows[i];
									balance.base[row.is_stable ? 'stable' : 'pending'] = row.balance;
								}
								cb(null, balance);
							}
						);
					else
						cb("address not found");
				});
			else
				cb("invalid address");
		}
		else
			Wallet.readBalance(wallet_id, function(balances) {
				cb(null, balances);
			});
	});

	/**
	 * Returns wallet balance(stable and pending) without commissions earned from headers and witnessing.
	 *
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getmainbalance', function(args, opt, cb) {
		balances.readOutputsBalance(wallet_id, function(balances) {
			cb(null, balances);
		});
	});

	/**
	 * Returns transaction list.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address or {since_mci: {Integer}, unit: {String}}
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{Integer},"my_address":{String},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 *
	 * If no address supplied, returns wallet transaction list.
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{Integer},"my_address":{String},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 */
	server.expose('listtransactions', function(args, opt, cb) {
		if (Array.isArray(args) && typeof args[0] === 'string') {
			var address = args[0];
			if (validationUtils.isValidAddress(address))
				Wallet.readTransactionHistory({address: address}, function(result) {
					cb(null, result);
				});
			else
				cb("invalid address");
		}
		else{
			var opts = {wallet: wallet_id};
			if (args.unit && validationUtils.isValidBase64(args.unit, constants.HASH_LENGTH))
				opts.unit = args.unit;
			else if (args.since_mci && validationUtils.isNonnegativeInteger(args.since_mci))
				opts.since_mci = args.since_mci;
			else
				opts.limit = 200;
			Wallet.readTransactionHistory(opts, function(result) {
				cb(null, result);
			});
		}

	});

	/**
	 * Send funds to address.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} token (unit)
	 * @param {String} address
	 * @param {Integer} amount
	 * @return {String} status
	 */
	server.expose('sendtoaddress', function(args, opt, cb) {
		var asset = args[0]
		var toAddress = args[1];
		var amount = args[2];

		if (amount && toAddress) {
			if (validationUtils.isValidAddress(toAddress))
				headlessWallet.issueChangeAddressAndSendPayment(asset, amount, toAddress, null, function(err, unit) {
					cb(err, err ? undefined : unit);
				});
			else
				cb("invalid address");
		}
		else
			cb("wrong parameters");
	});

	/**
	 * Get funds of address.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address
	 * @return {Object} info
	 */
	server.expose('getaddressinfo', function(args, opt, cb) {
		var response = {};
		let addressHelper = require('./common/address_helper');
		let address = args[0];
		if(address) {
			if(validationUtils.isValidAddress(address)) {
				 addressHelper.getAddressInfo(address, function(objTransactions, unspent, objBalance, end, definition, newLastInputsROWID, newLastOutputsROWID) {
						cb(null, {
							address: address,
							objTransactions: objTransactions,
							unspent: unspent,
							objBalance: objBalance,
							end: end,
							definition: definition,
							newLastInputsROWID: newLastInputsROWID,
							newLastOutputsROWID: newLastOutputsROWID
						});
				});
			} else {
				cb("invalid address");
			}
		} else {
			cb("invalid address");
		}
	});

	/**
	 * @return {Object} objBalance
	 */
	server.expose('getaddressbalance', function(args, opt, cb) {
		var response = {};
		let addressHelper = require('./common/address_helper');
		let address = args[0];
		if(address) {
			if(validationUtils.isValidAddress(address)) {
				 addressHelper.getAddressInfo(address, function(objTransactions, unspent, objBalance, end, definition, newLastInputsROWID, newLastOutputsROWID) {
						cb(null, {
							address: address,
							objBalance: objBalance,
						});
				});
			} else {
				cb("invalid address");
			}
		} else {
			cb("invalid address");
		}
	});

	/**
	 * @return {Array} witnesses
	 */
	server.expose('getwitnesses', function(args, opt, cb) {
		var myWitnesses = require('./trustnote-common/my_witnesses.js');
		myWitnesses.readMyWitnesses(function(arrWitnesses){
			cb(null, arrWitnesses)
		}, 'wait');
	});

	//light/get_history
	server.expose('lightgethistory', function(args, opt, cb) {
		const url = conf.WS_PROTOCOL + conf.hub; 
		var myWitnesses = require('./trustnote-common/my_witnesses.js');
		var network = require('./trustnote-common/network');
		if (!Array.isArray(args)) {
			cb('params  must be a array');
			return;
		}
		let addresses = args;
		myWitnesses.readMyWitnesses(function(arrWitnesses){
			var objRequest = {
		        witnesses: arrWitnesses,
		        addresses: addresses,
		        last_stable_mci: 0
	        	// known_stable_units: ["5qQHxiyuv9IiN6wjQm0HhuUN9L93aZPyrLmeKn/CYiU="] 
    		};
    	    network.findOutboundPeerOrConnect(url, function (err, ws){
			    network.sendRequest(ws, 'light/get_history', objRequest, false, function(ws, request, response){ 
			    	cb(null,response);
			    });
			});
		}, 'wait');
	});

	server.expose('light/get_parents_and_last_ball_and_witness_list_unit', function(args, opt, cb) {
		const url = conf.WS_PROTOCOL + conf.hub;
		var myWitnesses = require('./trustnote-common/my_witnesses.js');
		var network = require('./trustnote-common/network');
		myWitnesses.readMyWitnesses(function(arrWitnesses){
			var objRequest = {
		        witnesses: arrWitnesses
    		};
    		network.findOutboundPeerOrConnect(url, function (err, ws){
			    network.sendRequest(ws, 'light/get_parents_and_last_ball_and_witness_list_unit', objRequest, false, function(ws, request, response){ 
			    	cb(null,response);
			    });
			});
		}, 'wait');
	});

	headlessWallet.readSingleWallet(function(_wallet_id) {
		wallet_id = _wallet_id;
		// listen creates an HTTP server on localhost only
		server.listen(conf.rpcPort, conf.rpcInterface);
	});
}

eventBus.on('headless_wallet_ready', initRPC);
