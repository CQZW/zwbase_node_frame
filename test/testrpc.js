
const ZWPeerMgr = require('../lib/zwpeermgr').ZWPeerMgr;

let obj  = new ZWPeerMgr(null,5005);
obj.start();
console.log( 
obj.isSameNetArea('192.168.0.2','193.168.0.1') );