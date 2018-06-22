/*jslint node: true */
"use strict";
var WebSocket = process.browser ? global.WebSocket : require('ws');
var socks = process.browser ? null : require('socks'+'');
var db = require('./db.js');
var mutex = require('./mutex.js');
var breadcrumbs = require('./breadcrumbs.js');
var conf = require('./conf.js');
var constants = require('./constants.js');
var eventBus = require('./event_bus.js');
var _ = require('lodash');
var objectHash = require('./object_hash.js');
var ValidationUtils = require("./validation_utils.js");
var myWitnesses = require('./my_witnesses.js');
var storage = require('./storage.js');



var wss = {clients: []};
var arrOutboundPeers = [];
var assocConnectingOutboundWebsockets = {};
var assocKnownPeers = {};
var assocReroutedConnectionsByTag = {};

exports.light_vendor_url = null;
var RESPONSE_TIMEOUT = 300*1000; // after this timeout, the request is abandoned




function sendMessage(ws, type, content) {
    var message = JSON.stringify([type, content]);
    if (ws.readyState !== ws.OPEN)
        return console.log("readyState="+ws.readyState+' on peer '+ws.peer+', will not send '+message);
    console.log("SENDING "+message+" to "+ws.peer);
    ws.send(message);
}

function sendJustsaying(ws, subject, body){
    sendMessage(ws, 'justsaying', {subject: subject, body: body});
}

function sendVersion(ws){
    var libraryPackageJson = require('./package.json');
    sendJustsaying(ws, 'version', {
        protocol_version: constants.version, 
        alt: constants.alt, 
        library: libraryPackageJson.name, 
        library_version: libraryPackageJson.version, 
        program: conf.program, 
        program_version: conf.program_version
    });
}

function sendError(ws, error) {
    sendJustsaying(ws, 'error', error);
}

function sendErrorResponse(ws, tag, error) {
    sendResponse(ws, tag, {error: error});
}

function sendResponse(ws, tag, response){
    delete ws.assocInPreparingResponse[tag];
    sendMessage(ws, 'response', {tag: tag, response: response});
}


// if a 2nd identical request is issued before we receive a response to the 1st request, then:
// 1. its responseHandler will be called too but no second request will be sent to the wire
// 2. bReroutable flag must be the same
function sendRequest(ws, command, params, bReroutable, responseHandler){
    var request = {command: command};
    if (params)
        request.params = params;
    var content = _.clone(request);
    var tag = objectHash.getBase64Hash(request);
    //if (ws.assocPendingRequests[tag]) // ignore duplicate requests while still waiting for response from the same peer
    //    return console.log("will not send identical "+command+" request");
    if (ws.assocPendingRequests[tag]){
        console.log('already sent a '+command+' request to '+ws.peer+', will add one more response handler rather than sending a duplicate request to the wire');
        ws.assocPendingRequests[tag].responseHandlers.push(responseHandler);
    }
    else{
        content.tag = tag;

        var reroute = null;
        var reroute_timer = null;
        var cancel_timer = bReroutable ? null : setTimeout(function(){
            ws.assocPendingRequests[tag].responseHandlers.forEach(function(rh){
                rh(ws, request, {error: "[internal] response timeout"});
            });
            delete ws.assocPendingRequests[tag];
        }, RESPONSE_TIMEOUT);
        ws.assocPendingRequests[tag] = {
            request: request,
            responseHandlers: [responseHandler], 
            reroute: reroute,
            reroute_timer: reroute_timer,
            cancel_timer: cancel_timer
        };
        sendMessage(ws, 'request', content);
    }
}


function findOutboundPeerOrConnect(url, onOpen){
    if (!url)
        throw Error('no url');
    if (!onOpen)
        onOpen = function(){};
    url = url.toLowerCase();
    var ws = getOutboundPeerWsByUrl(url);
    if (ws)
        return onOpen(null, ws);

    console.log("will connect to "+url);
    connectToPeer(url, onOpen);
}



function getHostByPeer(peer){
    var matches = peer.match(/^wss?:\/\/(.*)$/i);
    if (matches)
        peer = matches[1];
    matches = peer.match(/^(.*?)[:\/]/);
    return matches ? matches[1] : peer;
}

function addPeerHost(host, onDone){
    db.query("INSERT "+db.getIgnore()+" INTO peer_hosts (peer_host) VALUES (?)", [host], function(){
        if (onDone)
            onDone();
    });
}

function addPeer(peer){
    if (assocKnownPeers[peer])
        return;
    assocKnownPeers[peer] = true;
    var host = getHostByPeer(peer);
    addPeerHost(host, function(){
        console.log("will insert peer "+peer);
        db.query("INSERT "+db.getIgnore()+" INTO peers (peer_host, peer) VALUES (?,?)", [host, peer]);
    });
}


function connectToPeer(url, onOpen) {
    addPeer(url);
    var options = {};
    if (socks && conf.socksHost && conf.socksPort)
        options.agent = new socks.Agent({ proxy: { ipaddress: conf.socksHost, port: conf.socksPort, type: 5 } }, /^wss/i.test(url) );
    var ws = options.agent ? new WebSocket(url,options) : new WebSocket(url);
    assocConnectingOutboundWebsockets[url] = ws;
    setTimeout(function(){
        if (assocConnectingOutboundWebsockets[url]){
            console.log('abandoning connection to '+url+' due to timeout');
            delete assocConnectingOutboundWebsockets[url];
            // after this, new connection attempts will be allowed to the wire, but this one can still succeed.  See the check for duplicates below.
        }
    }, 5000);
    ws.setMaxListeners(20); // avoid warning
    ws.once('open', function onWsOpen() {
        breadcrumbs.add('connected to '+url);
        delete assocConnectingOutboundWebsockets[url];
        ws.assocPendingRequests = {};
        ws.assocInPreparingResponse = {};
        if (!ws.url)
            throw Error("no url on ws");
        if (ws.url !== url && ws.url !== url + "/") // browser implementatin of Websocket might add /
            throw Error("url is different: "+ws.url);
        var another_ws_to_same_peer = getOutboundPeerWsByUrl(url);
        if (another_ws_to_same_peer){ // duplicate connection.  May happen if we abondoned a connection attempt after timeout but it still succeeded while we opened another connection
            console.log('already have a connection to '+url+', will keep the old one and close the duplicate');
            ws.close(1000, 'duplicate connection');
            if (onOpen)
                onOpen(null, another_ws_to_same_peer);
            return;
        }
        ws.peer = url;
        ws.host = getHostByPeer(ws.peer);
        ws.bOutbound = true;
        ws.last_ts = Date.now();
        console.log('connected to '+url+", host "+ws.host);
        arrOutboundPeers.push(ws);
        sendVersion(ws);
        if (conf.myUrl) // I can listen too, this is my url to connect to
            sendJustsaying(ws, 'my_url', conf.myUrl);
        if (onOpen)
            onOpen(null, ws);
        eventBus.emit('connected', ws);
        eventBus.emit('open-'+url);
    });
    ws.on('close', function onWsClose() {
        var i = arrOutboundPeers.indexOf(ws);
        console.log('close event, removing '+i+': '+url);
        if (i !== -1)
            arrOutboundPeers.splice(i, 1);
        cancelRequestsOnClosedConnection(ws);
        if (options.agent && options.agent.destroy)
            options.agent.destroy();
    });
    ws.on('error', function onWsError(e){
        delete assocConnectingOutboundWebsockets[url];
        console.log("error from server "+url+": "+e);
        var err = e.toString();
        // !ws.bOutbound means not connected yet. This is to distinguish connection errors from later errors that occur on open connection
        if (!ws.bOutbound && onOpen)
            onOpen(err);
        if (!ws.bOutbound)
            eventBus.emit('open-'+url, err);
    });
    ws.on('message', onWebsocketMessage);
    console.log('connectToPeer done');
}

function cancelRequestsOnClosedConnection(ws){
    console.log("websocket closed, will complete all outstanding requests");
    for (var tag in ws.assocPendingRequests){
        var pendingRequest = ws.assocPendingRequests[tag];
        clearTimeout(pendingRequest.reroute_timer);
        clearTimeout(pendingRequest.cancel_timer);
        if (pendingRequest.reroute){ // reroute immediately, not waiting for STALLED_TIMEOUT
            if (!pendingRequest.bRerouted)
                pendingRequest.reroute();
            // we still keep ws.assocPendingRequests[tag] because we'll need it when we find a peer to reroute to
        }
        else{
            pendingRequest.responseHandlers.forEach(function(rh){
                rh(ws, pendingRequest.request, {error: "[internal] connection closed"});
            });
            delete ws.assocPendingRequests[tag];
        }
    }
    printConnectionStatus();
}

function printConnectionStatus(){
    console.log(wss.clients.length+" incoming connections, "+arrOutboundPeers.length+" outgoing connections, "+
        Object.keys(assocConnectingOutboundWebsockets).length+" outgoing connections being opened");
}


function onWebsocketMessage(message) {
    var ws = this;
    if (ws.readyState !== ws.OPEN)
        return;
    
    console.log('RECEIVED '+(message.length > 1000 ? message.substr(0,1000)+'...' : message)+' from '+ws.peer);
    ws.last_ts = Date.now();
    
    try{
        var arrMessage = JSON.parse(message);
    }
    catch(e){
        return console.log('failed to json.parse message '+message);
    }
    var message_type = arrMessage[0];
    var content = arrMessage[1];
    
    switch (message_type){
        case 'justsaying':
            return handleJustsaying(ws, content.subject, content.body);
            
        case 'request':
            return handleRequest(ws, content.tag, content.command, content.params);
            
        case 'response':
            return handleResponse(ws, content.tag, content.response);
            
        default: 
            console.log("unknown type: "+message_type);
        //  throw Error("unknown type: "+message_type);
    }
}


function handleJustsaying(ws, subject, body){
    switch (subject){     
        case 'version':
            if (!body)
                return;
            if (body.protocol_version !== constants.version){
                sendError(ws, 'Incompatible versions, mine '+constants.version+', yours '+body.protocol_version);
                ws.close(1000, 'incompatible versions');
                return;
            }
            if (body.alt !== constants.alt){
                sendError(ws, 'Incompatible alts, mine '+constants.alt+', yours '+body.alt);
                ws.close(1000, 'incompatible alts');
                return;
            }
            ws.library_version = body.library_version;
            eventBus.emit('peer_version', ws, body); // handled elsewhere
            break;
        // I'm connected to a hub
        case 'hub/challenge':
        case 'hub/message':
        case 'hub/message_box_status':
            if (!body)
                return;
            eventBus.emit("message_from_hub", ws, subject, body);
            break;

        case 'hub/push_project_number':
            if (!body)
                return;
            if (ws.bLoggingIn || ws.bLoggedIn)
                eventBus.emit('receivedPushProjectNumber', ws, body);
            break;

        case 'info':
            break;

        default:
            console.log('------unhandled justsaying ', subject);
    }
}


function handleRequest(ws, tag, command, params){
    if (ws.assocInPreparingResponse[tag]) // ignore repeated request while still preparing response to a previous identical request
        return console.log("ignoring identical "+command+" request");
    ws.assocInPreparingResponse[tag] = true;
    switch (command){

        case 'subscribe':
            console.log('I\'m light, cannot subscribe you to updates');
            return sendErrorResponse(ws, tag, "I'm light, cannot subscribe you to updates");
            break;
        
        default:
        	console.log('--++unhandledRequest---',command);

    }
}


function handleResponse(ws, tag, response){
    var pendingRequest = ws.assocPendingRequests[tag];
    if (!pendingRequest) // was canceled due to timeout or rerouted and answered by another peer
        //throw "no req by tag "+tag;
        return console.log("no req by tag "+tag);
    pendingRequest.responseHandlers.forEach(function(responseHandler){
        process.nextTick(function(){
            responseHandler(ws, pendingRequest.request, response);
        });
    });
    
    clearTimeout(pendingRequest.reroute_timer);
    clearTimeout(pendingRequest.cancel_timer);
    delete ws.assocPendingRequests[tag];
    
    // if the request was rerouted, cancel all other pending requests
    if (assocReroutedConnectionsByTag[tag]){
        assocReroutedConnectionsByTag[tag].forEach(function(client){
            if (client.assocPendingRequests[tag]){
                clearTimeout(client.assocPendingRequests[tag].reroute_timer);
                clearTimeout(client.assocPendingRequests[tag].cancel_timer);
                delete client.assocPendingRequests[tag];
            }
        });
        delete assocReroutedConnectionsByTag[tag];
    }
}



function requestFromLightVendor(command, params, responseHandler){
    if (!exports.light_vendor_url){
        console.log("light_vendor_url not set yet");
        return setTimeout(function(){
            requestFromLightVendor(command, params, responseHandler);
        }, 1000);
    }
    findOutboundPeerOrConnect(exports.light_vendor_url, function(err, ws){
        if (err)
            return responseHandler(null, null, {error: "[connect to light vendor failed]: "+err});
        sendRequest(ws, command, params, false, responseHandler);
    });
}

function requestProofsOfJoints(arrUnits, onDone){
    if (!onDone)
        onDone = function(){};
    myWitnesses.readMyWitnesses(function(arrWitnesses){
        var objHistoryRequest = {witnesses: arrWitnesses, requested_joints: arrUnits};
        requestFromLightVendor('light/get_history', objHistoryRequest, function(ws, request, response){
            if (response.error){
                console.log(response.error);
                return onDone(response.error);
            }
            light.processHistory(response, {
                ifError: function(err){
                    sendError(ws, err);
                    onDone(err);
                },
                ifOk: function(){
                    onDone();
                }
            });
        });
    }, 'wait');
}



function requestProofsOfJointsIfNewOrUnstable(arrUnits, onDone){
    if (!onDone)
        onDone = function(){};
    storage.filterNewOrUnstableUnits(arrUnits, function(arrNewOrUnstableUnits){
        if (arrNewOrUnstableUnits.length === 0)
            return onDone();
        requestProofsOfJoints(arrUnits, onDone);
    });
}


function addLightWatchedAddress(address){
    if (!conf.bLight || !exports.light_vendor_url)
        return;
    findOutboundPeerOrConnect(exports.light_vendor_url, function(err, ws){
        if (err)
            return;
        sendJustsaying(ws, 'light/new_address_to_watch', address);
    });
}


// sent by light clients to their vendors
function postJointToLightVendor(objJoint, handleResponse) {
    console.log('posing joint identified by unit ' + objJoint.unit.unit + ' to light vendor');
    requestFromLightVendor('post_joint', objJoint, function(ws, request, response){
        handleResponse(response);
    });
}



function getOutboundPeerWsByUrl(url){
    console.log("outbound peers: "+arrOutboundPeers.map(function(o){ return o.peer; }).join(", "));
    for (var i=0; i<arrOutboundPeers.length; i++)
        if (arrOutboundPeers[i].peer === url)
            return arrOutboundPeers[i];
    return null;
}



// if not using a hub and accepting messages directly (be your own hub)
var my_device_address;
var objMyTempPubkeyPackage;

function setMyDeviceProps(device_address, objTempPubkey){
    my_device_address = device_address;
    objMyTempPubkeyPackage = objTempPubkey;
}


function initWitnessesIfNecessary(ws, onDone){
    onDone = onDone || function(){};
    myWitnesses.readMyWitnesses(function(arrWitnesses){
        if (arrWitnesses.length > 0) // already have witnesses
            return onDone();
        sendRequest(ws, 'get_witnesses', null, false, function(ws, request, arrWitnesses){
            if (arrWitnesses.error){
                console.log('get_witnesses returned error: '+arrWitnesses.error);
                return onDone();
            }
            myWitnesses.insertWitnesses(arrWitnesses, onDone);
        });
    }, 'ignore');
}



exports.findOutboundPeerOrConnect = findOutboundPeerOrConnect;
exports.sendRequest = sendRequest;
exports.setMyDeviceProps = setMyDeviceProps;
exports.addPeer = addPeer;
exports.sendJustsaying = sendJustsaying;
exports.sendError = sendError;
exports.initWitnessesIfNecessary = initWitnessesIfNecessary;
exports.requestFromLightVendor = requestFromLightVendor;
exports.requestProofsOfJointsIfNewOrUnstable = requestProofsOfJointsIfNewOrUnstable;
exports.addLightWatchedAddress = addLightWatchedAddress;
exports.postJointToLightVendor = postJointToLightVendor;

