 
 const zwthread = require('../lib/zwthread');

 const signalobj = zwthread.ZWSignalObject;
 const QPS      = zwthread.ZWQPSCtr;
 const JobThread =zwthread.ZWJobArrayThread;

 let obj = null;

 let ff =  async function()
 {
    obj = new signalobj(-1);
    console.log('wait...');
    let getnoif = await obj.wait(1000);
    console.log( 'wait obj',getnoif );
 }

 ff();
 setTimeout( ()=>{

    obj.notify({a:1}).then( (r)=>{
        console.log('notif:',r);
    } )

 },2000);


 let testqps = new QPS(1);

 let f2 = async function()
 {
    while(1)
    {
        await testqps.checkQPS();
        console.log('do job at:',new Date() );
    }
 }
 //f2();

 let threafunc = async function( in_job )
 {
     let out_job = {};
     console.log('in_job:',in_job.a);
     out_job.a = in_job.a + 1;
     console.log('out_job:',out_job.a);
     return Promise.resolve( out_job );
 }
 let testarr = new JobThread(threafunc);
 testarr.start();
 
 testarr.addOneJob( { a:2 } ).then( (r)=>{
    console.log('addjob ok?:',r);
 });

 testarr.addOneJobAndWait( {a:3} ).then( (jobrelsout)=>{
     console.log('job wait:',jobrelsout);
 } );


 const zwrotuer = require('../lib/zwrouter');
 const zwctr = require('../lib/zwbasectr').ctr;
 let rootrouter = new zwrotuer('/api/v1');

 let ctruser = new zwctr();
 let ctrorder = new zwctr();

 rootrouter.regCtr('/user',ctruser);
 rootrouter.regCtr('/order',ctrorder);

 let subrouter = new zwrotuer('/other/old');
 let ctr1 = new zwctr();
 let ctr2 = new zwctr();

 subrouter.regCtr('/user',ctr1);
 subrouter.regCtr('/order',ctr2);
 
 rootrouter.regCtr( subrouter.getPathPrefix(),subrouter );


 

 console.log( 'ctr path:', ctrorder.getRouterPath() ,' :',ctr2.getRouterPath() );
 console.log( 'ctr import:', ctrorder.importCtr('./user').getRouterPath() , ': ',ctrorder.importCtr('./other/old/user').getRouterPath() );
 console.log( 'ctr import:',ctr1.importCtr('/user').getRouterPath(),' ',ctr2.importCtr('../order').getRouterPath() )
 


 let abddd = new Set();
 abddd.toJSON = function()
 {
     return 'a';
 }
 abddd.add( Symbol('aa'));

 console.log(JSON.stringify( {abcd:abddd} ) );

let objj  = {};
objj.a = new Set();

objj.a.add('abcd');

let funccc = function()
{
    try
    {
        return 1;
    }
    catch(e)
    {
        console.log(2);
    }
    finally
    {
        console.log('finally'+1);
    }
}

funccc()
