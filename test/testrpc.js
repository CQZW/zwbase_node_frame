
const ZWPeerMgr = require('../lib/zwpeermgr').ZWPeerMgr;

let obj  = new ZWPeerMgr(null,5005);
obj.start();
obj.on( 'ipc_data' , (x)=>{ 
    x.data.ret_data = {'info':'ipc ret data from:'+process.pid};
    obj.resbDataIPC( x.ack,x.data,null);
 } );

obj.iCanResbThisFunc( '/api/v1/testctr+this+ctr_testipc', process.pid );