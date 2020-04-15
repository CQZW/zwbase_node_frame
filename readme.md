# a srv frame base on express
### 1.服务(SRV)-路由器-控制器(CTR)使用
    ctr 注册到 router ,router 注册到 srv,router可以注册到router生成二级路径
    SRV:实现HTTP 创建,监听,加载路由和控制器,提供RPC节点管理器,机器唯一锁,后台任务循环
    CTR:响应请求通用化,加密/解密,RPC 方法管理,后台任务循环
calss TestSrv ....

    cfgRouter(routers)
    {
        let tarr = routers||[];
        let apirouter = new zwbase.ZWRouter( '/api/v1' );

        //下面具体设置 这个 路由的规则
        let ctr = new testCtr( this );
        apirouter.regCtr( '/testctr' , ctr );
        tarr.push( apirouter );
        super.cfgRouter( tarr );
        //http://127.0.0.1/api/v1/testctr.getinfo 就可以请求到 ctr_getinfo 方法里面
        //请求返回:
            {
            "code":0,
            "msg":"操作成功",
            "data":
                {
                    "info:":"i am cq zw ,test ctr "
                }
            }
    }
class testCtr ...

    //ctr_ 开头的方法就是响应方法
    async ctr_getinfo( param )
    {
        let retobj = { 'info:':'i am cq zw ,test ctr ' };
        return this.rr( retobj );
    }
***
### 2.线程类,模拟线程概念而已,任何一段异步代码可以模拟线程
    ZWQPSCtr:限定并发请求,如果请求太快就会sleep
    //比如QPS=1,每秒请求不超过1次请求
    let testqps = new ZWQPSCtr(1);
    let f2 = async function()
    {
        while(1)
        {
            await testqps.checkQPS();
            console.log('do job at:',new Date() );
        }
    }
    f2();
    //do job at: 2020-03-18T03:56:46.721Z
    //do job at: 2020-03-18T03:56:47.724Z
    //do job at: 2020-03-18T03:56:48.724Z

    ZWSignalObject:用于同步等待信号事件,和events类似,就是同步版本
    let obj = null;
    let ff =  async function()
    {
        obj = new ZWSignalObject(-1);
        console.log('wait...');
        let waitsome = await obj.wait();
        console.log( 'wait obj:',waitsome );
    }
    ff();
    setTimeout( ()=>{
        obj.notify({a:1}).then( (r)=>{
        console.log('notif:',r);
        })
    },2000);
    //2020-03-18T04:30:31.104Z wait...
    //2020-03-18T04:30:33.115Z wait obj: { a: 1 }
    //2020-03-18T04:30:33.116Z notif: true

    ZWJobArrayThread:异步任务队列线程,
    let threafunc = async function( in_job )
    {
        let out_job = {};
        console.log('in_job:',in_job.a);
        out_job.a = in_job.a + 1;
        console.log('out_job:',out_job.a);
        return Promise.resolve( out_job );
    }
    //生成一个自定义任务方法的线程
    let testarr = new ZWJobArrayThread(threafunc);
    testarr.start();
    
    //添加任务
    testarr.addOneJob( { a:2 } ).then( (r)=>{
        console.log('addjob ok?:',r);
    });
    //添加任务并等待任务执行完成
    testarr.addOneJobAndWait( {a:3} ).then( (jobresult)=>{
        console.log('and job and wait :',jobresult);
    });
    //in_job: 2
    //out_job: 3
    //addjob ok?: true
    //in_job: 3
    //out_job: 4
    //add job and wait: { r: true, d: { a: 4 } }

***
### 3.简单分布式调用,节点发现基于内网UDP广播,数据流走基于CTR的HTTP
    ZWRPCMgr:为CTR 方法/变量.方法 提供无缝RPC化,会自动将目标函数hook到RPC流程
    CTR代码:
    //注册需要RPC的方法,这样可以将ctr_getinfo RPC化
    this.regRPC( this, this.ctr_getinfo );
     
    //这行代码会将参数发送到其他机器的同等路由,的CTR里面的 ctr_getinfo 执行,并返回数据到这里
    this.ctr_getinfo();

    ZWPeerMgr:提供节点发现管理,使用内网UDP广播
    目前内置于服务(SRV),一个服务只提供一个节点管理器,如果使用cluster启动多进程,会使用SRV的机器锁
    区分主/从进程,主进程和其他机器通讯广播节点,从进程只和本机主进程通讯拷贝主进程的节点.

    节点管理有简单熔断处理,见 _checkPeer 方法.


这里还有一个封装mongodb的ORM模型库 [zworm](https://www.npmjs.com/package/zworm)
