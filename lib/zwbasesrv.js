const   express     = require('express');
const   logger      = require('./zwlogger')

const   https       = require('https');
const   http        = require('http');
const   dgram       = require('dgram');
const   LRU         = require("lru-cache");
const   zwrouter    = require('./zwrouter');
const   zwbasectr   = require('./zwbasectr').ctr;
const   Socket      = dgram.Socket;
const   ZWPeerMgr   = require('./zwpeermgr').ZWPeerMgr;
const   ZWRPCData   = require('./zwrpc').ZWRPCData;


class ZWBaseSrv
{
    constructor()
    {
        this.httpsapp       = express();
        this.httpapp        = express();
        this._DBObj         = null;//持有的数据库对象
        logger.cfgFor4JS();

        this._cfg           = {

            /**
            * 0:表示都响应,1:只要https,2:只要http
            */
            needhttps:0,
            /** 
             * 配置的域名
             * 
            */
            domain:'127.0.0.1',
            /**
             *静态资源文件访问入口
             */
            resentry:'/public/',

            /**
             * 资源文件真正的本地目录
             */
            reslocal:'public',
            httpport:80,
            httpsport:443,
            /**
             * 使用UDP 抢占机器锁的端口号
             */
            machine_lock_port:5005,
            /**
             * session缓存 默认1万个
             */
            session_max_cache:10000,
            /**
             * 服务后台任务默认10秒一次
             */
            time_ms:10000,

            /**
             * 是否支持RPC分布式
             */
            canRPC:false,
        };

        /**
         * 所有的路由器对象 
         * @type {Array<zwrouter>}
         */
        this._routers = [];

        /**
         *机器锁抢占状态,true/false 
         */
        this.machine_lock = undefined;

        /**
         * 机器锁的socket
         * @type {Socket}
         */
        this.machine_lock_socket = null; 

        /**
         *全局唯一锁抢占状态,true/false 
         */
        this.global_lock = undefined;

    }
    
    /**
     * 继承修改服务配置
     * @memberof ZWBaseSrv
     */
    srvConfig()
    {

    }

    /**
     * 获取 session cache
     * 自定义,memcache,或者redis之类的 实现get/set方法即可
     * @returns {LRU}
     * @memberof ZWBaseSrv
     */
    ctrGetSessionCache()
    {
        return this._session_cache;
    }
    /**
     * 给ctr调用
     * 获取数据库对象
     * @returns
     * @memberof ZWBaseSrv
     */
    ctrGetDB()
    {
        return this._DBObj;
    }
    //或者服务站点配置等详细信息.比如域名,什么之类的
    /**
     * 给ctr调用
     * 获取配置对象
     * @returns {}
     * @memberof ZWBaseSrv
     */
    ctrGetSrvCfgInfo()
    {
        return Object.assign( {}, this._cfg );
    }

    /**
     *  给ctr调用
     * 获取整个服务的所有路由对象
     * @returns {Array<zwrouter>}
     * @memberof ZWBaseSrv
     */
    ctrGetSrvRouters()
    {
        return [...this._routers];
    }

    /**
     * 获取机器锁状态
     * 
     * @returns {boolean}
     * @memberof ZWBaseSrv
     */
    ctrGetMachineLock()
    {
        return this.machine_lock;
    }

    /**
     * 
     * 获取当前全局锁状态
     * @returns {boolean}
     * @memberof ZWBaseSrv
     */
    ctrGetGlobalLock()
    {
        return this.global_lock;
    }

    /**
     * 获取RPC节点管理器
     *
     * @returns {ZWPeerMgr}
     * @memberof ZWBaseSrv
     */
    ctrGetPeerMgr()
    {
        return this._rpcpeermgr;
    }
    /**
     * 抢占机器锁,这里使用一个socket端口来实现,谁先抢占就行
     * 这里机器锁使用的 socket 会被用于 RPC 节点发现,如果启用了 RPC 不要 动态重新获取机器锁
     * 因为 zwpeermgr 是单例使用,不能动态切换 主/从 ,如果要自己修改
     * @param {boolean} [forceRob=false] 是否重新抢占
     * @returns{Promise<boolean>}
     * @memberof ZWBaseSrv
     */
    async robMachineLock( forceRob = false )
    {
        if( this._cfg.canRPC && forceRob ) logger.log('RPC using machinlock can not rob force');
        if( this.machine_lock != undefined && !forceRob ) return Promise.resolve( this.machine_lock );
        return new Promise( (resolve,reject)=>{
            this.machine_lock_socket = dgram.createSocket('udp4');
            this.machine_lock_socket.on( 'error',(err)=>{
                //if( err.code == 'EADDRINUSE' ) resolve( false );
                this.machine_lock_socket = null;
                this.machine_lock = false;
                resolve( false );
            });
            this.machine_lock_socket.bind( {
                        //address: '127.0.0.1',//不指定就绑定所有地址
                        port: this._cfg.machine_lock_port,
                        exclusive: true } ,()=>{
                            this.machine_lock = true;
                             
                            resolve(true);
                        });
        });
    }

    /**
     * 抢占全局锁
     * @param {boolean} [forceRob=false] 是否重新抓取
     * @returns{Promise<boolean>}
     * @memberof ZWBaseSrv
     */
    async robGlobalLock( forceRob = false )
    {
        //继承实现,比如用redis实现
        this.global_lock = false;
        return Promise.resolve( this.global_lock );
    }

    /**
     * 内部方法,获取express对象
     * @param {boolean} 默认获取https对象
     * @returns {express}
     * @memberof ZWBaseSrv
     */
    getApp( https = true)
    {
        if( https ) return this.httpsapp;
        return this.httpapp;
    }
    
    /**
     * 配置 Express 中间件
     * @memberof ZWBaseSrv
     */
    cfgExpress()
    {
        //支持的content-type...
        // parse application/x-www-form-urlencoded
        this.getApp().use(express.urlencoded({limit:5242880, extended: false }));
        this.getApp(false).use(express.urlencoded({limit:5242880, extended: false }));

        // parse application/json
        this.getApp().use(express.json({limit:5242880}));
        this.getApp(false).use(express.json({limit:5242880}));


        //处理xml 如果要处理 微信支付回调 需要这个
        this.getApp().use(express.raw({limit:5242880,type:'text/xml'}));
        this.getApp(false).use(express.raw({limit:5242880,type:'text/xml'}));

        this.getApp().use(logger.connectLogger());
        this.getApp(false).use(logger.connectLogger());

        //公开文件,资源文件等等
        this.getApp().use( this._cfg.resentry ,express.static( this._cfg.reslocal ,
        {
            cacheControl:true,
            maxAge:(1000*3600*24)
        }));
        this.getApp(false).use( this._cfg.resentry ,express.static( this._cfg.reslocal ,
        {
            cacheControl:true,
            maxAge:(1000*3600*24)
        }));
    }

    /**
     * 配置路由
     * 
     * 继承添加路由配置 必须调用在最后调用super
     * @param {Array<zwrouter} routers 
     * @memberof ZWBaseSrv
     */
    cfgRouter( routers = [] )
    {//express是按顺序使用路由的,最后都会到这里,继承必须调用super,到这里
        //关于路由,见这里说明
        //http://www.expressjs.com.cn/4x/api.html#router
        //比如这种...
        //app.use( '/api/v1' ,routerapiv1 );
        //app.use( '/api/v2' ,routerapiv2 );

        for( let r of routers )
        {
            this.getApp().use( r.getPathPrefix(),r.getRouter() );
            this.getApp(false).use( r.getPathPrefix(),r.getRouter() );
            this._routers.push( r );
        }

        //如果路由 走到这里,说明之前设置的路由全部都没有接住,,那么最后这3个处理下了,否则就失败了
        this.getApp().all('/',this.r_root);
        this.getApp().all('*',this.r_404);
        this.getApp().use(this.r_500);

        this.getApp(false).all('/',this.r_root);
        this.getApp(false).all('*',this.r_404);
        this.getApp(false).use(this.r_500);

    }

    createHttp()
    {
        if( this._cfg.needhttps == 0 || this._cfg.needhttps == 2 )
            this._http_forlisten =  http.createServer(this.httpapp);
        else 
            this._https_forlisten = https.createServer(this.getHttpsOptions(), this.httpsapp);
    }

    /**
     * 开始监听端口,开始服务,
     * 放到后面,是等配置路由都搞定了,才开始服务
     * @memberof ZWBaseSrv
     */
    listenHttp()
    {
        if( this._http_forlisten )
        {
            this._http_forlisten.listen( this._cfg.httpport );
            logger.log('listen http at:',this._cfg.httpport );
        }
        if( this._https_forlisten )
        { 
            this._https_forlisten.listen( this._cfg.httpsport );
            logger.log('listen https at:',this._cfg.httpsport );
        }
    }
    
    /**
     * 继承修改,如果需要https,
     * http证书配置,
     * @returns {{}}
     * @memberof ZWBaseSrv
     */
    getHttpsOptions()
    {
        logger.error('get your key cfg for https');
        /*
        let options = {};
        options.key = fs.readFileSync( './xxx.com.key' );
        options.cert = fs.readFileSync( './xxx.com.cer' );
        options.ca = fs.readFileSync( './xxxx.com_ca.crt' );
        return options;
        */
        return null;
    }
    
    /**
     * 启动服务
     * @returns
     * @memberof ZWBaseSrv
     */
    async start()
    {
        try
        {
            this.srvConfig();

            this._session_cache = new LRU( this._cfg.session_max_cache );

            this._DBObj = await this.startDB();

            this.createHttp();

            this.cfgExpress();

            this.cfgRouter();

            await this.srvWillStart();

            this.listenHttp();

            logger.log('srv start listen');
            this.srvDidStarted();
            logger.log('srv start ok');

            return Promise.resolve( true );
        }
        catch( error)
        {
            logger.error('start srv failed,',error);
            process.exit( 101 );
        }
    }

    /**
     * 获取一个控制器,用于处理通用的操作
     * 因为通常会有basectr,通用的逻辑在这里,所以随便获取一个即可
     * @returns {zwbasectr}
     * @memberof ZWBaseSrv
     */
    getOneCtr()
    {
        for( let one of this._routers )
        {
            let t = one.getAllCtrs();
            for( let ctr of t )
            {
                return ctr;
            }
        }
        return null;
    }
    /**
     * 获取所有注册的控制器
     *
     * @returns{Array<zwbasectr>}
     * @memberof ZWBaseSrv
     */
    getAllCtrs()
    {
        let a = [];
        for( let one of this._routers )
        {
            let t = one.getAllCtrs();
            a = a.concat( t );
        }
        return a;
    }

    /**
     * 子类处理完成之后必须调用super,
     * 服务器即将开始监听端口接受请求
     * @returns
     * @memberof ZWBaseSrv
     */
    async srvWillStart()
    {
        //尝试抢占机器锁
        await this.robMachineLock();

        //尝试抢占全局唯一锁
        await this.robGlobalLock();

        //通知所有控制器服务启动成功
        let once = false;
        let allctr = this.getAllCtrs();
        for( let ctr of allctr )
        { 
            await ctr.srvWillStart();
            if( !once )
            {//一次性的操作
                await ctr.loadAllSessionToCache();
                once = true;
            }
        }

        return Promise.resolve( );
    }
    /**
     * 收到节点管理器的IPC数据,
     * 继承这里进行了业务处理,尽快执行 resbDataIPC,
     * @param {*} recvobj
     * @memberof ZWBaseSrv
     */
    async peermgr_ipc_data( recvobj )
    {
        if( recvobj.subtype == 0 )
        {//IPC 之间的 RPC 调用
            
            /**
             * @type ZWRPCData
             */
            let rpcdata = recvobj.data;
            //func_unique_id 规则 见 zwprc._makeFuncUniqueId 方法
            let ctrpath = rpcdata.func_unique_id.split('+')[0];
            /**
             * @type zwbasectr
             */
            let ctr = null;
            for( let one of this._routers )
            {
                ctr = one.getCtr( ctrpath );
                if( ctr )break;
            }
            if( !ctr ) return this._rpcpeermgr.resbDataIPC( recvobj.ack , null , '无法响应的IPC-RPC请求:'+ rpcdata.func_unique_id );
            
            let fake_param = {};
            fake_param.data = rpcdata;
            let r = await ctr.ctr_rpc( fake_param );
            if( r.code == 0 )
            {
                return this._rpcpeermgr.resbDataIPC( recvobj.ack , r.data, null );
            }
            else
            {
                return this._rpcpeermgr.resbDataIPC( recvobj.ack , null , r.msg );
            }
        }
    }

    /**
     * 处理完成之后必须调用super,
     * 服务启动成功之后默认会通知所有ctr.srvStartOk
     */
    srvDidStarted()
    {
        //启动后台任务
        this.startRuningJob();


        if( this._cfg.canRPC )
        {//服务真正启动之后才开始处理RPC
            this._rpcpeermgr = new ZWPeerMgr( this.machine_lock_socket , this._cfg.machine_lock_port );
            this._rpcpeermgr.on( 'ipc_data' , (x)=>{ this.peermgr_ipc_data( x ) } );
            this._rpcpeermgr.start().then( (x)=>{
                if( !x ) throw new Error('start peer mgr failed');
            });
        }
        
        //通知所有控制器服务启动成功
        let allctr = this.getAllCtrs();
        for( let ctr of allctr  )
        {
            ctr.srvStartOk();   
        }
    }

    /**
     * 继承添加启动数据库操作
     * 启动数据库
     * @memberof ZWBaseSrv
     */
    async startDB()
    {
        logger.error('start your db at you subclass');
        throw new Error('please start db frist');
    }
    
    /**
     * 启动后台循环任务
     * 服务默认会开启后台任务
     * @param {number} [time_ms]
     * @memberof ZWBaseSrv
     */
    startRuningJob( time_ms )
    {
        if( time_ms ) this._cfg.time_ms = time_ms;
        setTimeout(()=>{this.job_runing()}, this._cfg.time_ms );
    }

    /**
     * 子类继承之后,调用super可以继续执行下次循环任务,否则不会继续执行任务
     * 这里做了session dump操作,可以继承修改,如果不需要
     * @memberof ZWBaseSrv
     */
    async job_runing()
    {
        //缓存里面所有的session 尝试入库
        let all = this.ctrGetSessionCache().values();
        let i = 0;
        for( let one of all )
        {
            if( await one.dumpSession() ) i++;
        }
        logger.log('dump sesssion:',i);
        setTimeout(()=>{this.job_runing()}, this._cfg.time_ms );
        return Promise.resolve();
    }

    /**
     * 可继承修改
     * 路由 根目录,
     * @param {*} req
     * @param {*} res
     * @param {*} next
     * @memberof ZWBaseSrv
     */
    r_root(req,res,next)
    {
        res.send('Hello...');
    }

    /**
     * 可继承修改
     * 找不到路由情况,404处理
     * @param {*} req
     * @param {*} res
     * @param {*} next
     * @memberof ZWBaseSrv
     */
    r_404( req,res,next)
    {
        logger.log( 'not find any router' );
        res.status(404).send('not find');
    }

    /**
     * 可继承修改,
     * 服务器有错误处理
     * @param {*} err
     * @param {*} req
     * @param {*} res
     * @param {*} next
     * @memberof ZWBaseSrv
     */
    r_500(err,req,res,next)
    {
        logger.log( 'srv has error:' ,err);
        res.status(500).send('srv has error');
    }
}

module.exports = ZWBaseSrv;