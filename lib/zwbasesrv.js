const   express     = require('express');
const   logger      = require('./zwlogger');

const   https       = require('https');
const   http        = require('http');
const   zwrouter    = require('./zwrouter');
const   zwbasectr   = require('./zwbasectr').ctr;
const   ZWRPCBridge = require('./zwrpcbridge').ZWRPCBridge;
const   redis       = require("redis");
const   OS          = require('os');
const   dgram       = require('dgram');

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
             * 服务后台任务默认10秒一次
             */
            time_ms:10000,

            /**
             * 是否支持RPC分布式
             */
            canRPC:false,

            /**
             * redis链接参数
             */
            redis_url:'redis://zw:123456@127.0.0.1:6379/0',


            prjPrefix:'zwbase',

            /**
             * 锁的超时时间,默认60秒.
             * 如果持有者60秒内,没有报活,可能被其他进程占用
             */
            lock_timeout:60

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

        /**
         * 用于缓存数据的redis客户端
         */
        this._cache_redis_client  = undefined;

        process.on( 'exit', (c) => {
            this.stopSrv(c);
        });
        
    }
    
    /**
     * 继承修改服务配置
     * @memberof ZWBaseSrv
     */
    srvConfig()
    {

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
     * 获取RPC数据通道
     *
     * @returns {ZWRPCBridge}
     * @memberof ZWBaseSrv
     */
    ctrGetRPCBridge()
    {
        return this._rpcbridge;
    }

    /**
     * 获取用于缓存的redis客户端,
     *
     * @returns
     * @memberof ZWBaseSrv
     */
    ctrGetRedisClient()
    {
        return this._cache_redis_client;
    }

    /**
     * 进程抢占机器锁,使用SOCKET占用端口方式实现
     * 不用维护,进程挂掉自然消失,机器锁无法动态获取,启动的时候一次性获取,然后中途不变化
     * 如果持有者进程挂掉了,需要新启动进程才能重新持有
     * @returns{Promise<boolean>}
     * @memberof ZWBaseSrv
     */
    async robMachineLock()
    {
        if( this.machine_lock != undefined ) return Promise.resolve( this.machine_lock );
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
                        exclusive: true 
                        } ,()=>{
                            this.machine_lock_socket.unref();
                            this.machine_lock = true;
                            resolve(true);
                        });
        });
    }
    /**
     * 释放持有的机器锁
     *
     * @memberof ZWBaseSrv
     */
    async _releaseMachineLock()
    {
        if( this.machine_lock_socket ) this.machine_lock_socket.close();
    }
    async _releaseGlobalLock()
    {
        if( this._lock_timer ) clearInterval( this._lock_timer );
        if( this.global_lock ) this._cache_redis_client.del( this.getGlobalLockKey() );
    }
    /**
     * 获取本机IP地址,
     *
     * @returns {string}
     * @memberof ZWPeerMgr
     */
    getIPv4()
    {
        if( this._localip ) this._localip;
        let i = this.getIPInterface();
        if( !i ) return null;
        this._localip = i.address;
        return this._localip;
    }
    /**
     * 获取当前IP的接口 对象
     *
     * @memberof ZWPeerMgr
     */
    getIPInterface()
    {
        let allips = OS.networkInterfaces();
        for( let oneinterface of Object.values( allips) )
        {
            for( let one of oneinterface )
            {
                if( one.internal || one.family == 'IPv6' ) continue;
                return one;
            }
        }
        return null;
    }

    /**
     * 获取全局锁的KEY,默认返回本项目的KEY,
     *
     * @returns {string}
     * @memberof ZWBaseSrv
     */
    getGlobalLockKey()
    {
        if( !this._global_lock_key )
        {
            this._global_lock_key = 'global_lock_'+ this._cfg.prjPrefix;
        }
        return this._global_lock_key;
    }

    /**
     * 如果持有者进程挂掉了,需要新启动进程才能重新持有
     * @returns{Promise<boolean>}
     * @memberof ZWBaseSrv
     */
    async robGlobalLock()
    {
        if( this.global_lock != undefined ) return Promise.resolve( this.global_lock );
        if( !this._global_lock_val )
        {
            let _v = this.getIPv4();
            if( !_v ) throw new Error('get localip failed');
            _v = _v + '_' + process.pid;
            this._global_lock_val = _v;
        }
        return new Promise((resolve,reject) => {
            this._cache_redis_client.setnx( this.getGlobalLockKey() , this._global_lock_val ,(e,r)=>{
                this.global_lock = r;
                if( r )
                {
                    this._cache_redis_client.expire( this.getGlobalLockKey(), this._cfg.lock_timeout );
                    this._startLockWachter();
                }
                resolve( this.global_lock );
            });
        });
    }
    _startLockWachter()
    {
        if( this._lock_timer ) return;
        this._lock_timer = setInterval(()=>{
            this._cache_redis_client.expire( this.getGlobalLockKey(), this._cfg.lock_timeout );
        }, (this._cfg.lock_timeout*1000)*0.8 );//提前20%的时间去刷新过期时间,防止临界点情况
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

    delRouter()
    {
        for( let r of this._routers )
        {
            r.clear();
        }
        this._routers = [];
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
     * 停止监听HTTP服务端口
     *
     * @memberof ZWBaseSrv
     */
    stopListenHttp()
    {
        if( this._http_forlisten )
        {
            this._http_forlisten.close();
            logger.log('close listen http at:',this._cfg.httpport );
        }
        if( this._https_forlisten )
        { 
            this._https_forlisten.close();
            logger.log('close listen https at:',this._cfg.httpsport );
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

            await this.startDB();

            await this.startRedis();

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
     * 停止服务器,清理资源
     * @memberof ZWBaseSrv
     */
    stopSrv( code )
    {
        logger.log('srv will sotp:',code);
        //1.首先停止HTTP服务
        this.stopListenHttp();

        //2.停止控制器
        let allctr = this.getAllCtrs();
        for( let ctr of allctr )
        { 
            ctr.srvWillStop( code );
        }
        //3.停止RPC数据通道
        this._rpcbridge.stop();

        //4.删除路由
        this.delRouter();

        //5.释放持有的锁
        this._releaseGlobalLock();
        this._releaseMachineLock();
        //6.停止redis客户端
        this.stopRedis();

        //7.停止数据库
        this.stopDB();

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
        if( this._cfg.canRPC )
        {//开始RPC的数据通道
            this._rpcbridge = new ZWRPCBridge( this.getIPv4() );
            await this._rpcbridge.start();
        }

        //尝试抢占机器锁
        await this.robMachineLock();

        //尝试抢占全局唯一锁
        await this.robGlobalLock();

        //通知所有控制器服务启动成功
        let allctr = this.getAllCtrs();
        for( let ctr of allctr )
        { 
            await ctr.srvWillStart();
        }

        return Promise.resolve( );
    }

    /**
     * 处理完成之后必须调用super,
     * 服务启动成功之后默认会通知所有ctr.srvStartOk
     */
    srvDidStarted()
    {
        //启动后台任务
        this.startRuningJob();

        //通知所有控制器服务启动成功
        let allctr = this.getAllCtrs();
        for( let ctr of allctr  )
        {
            ctr.srvStartOk();   
        }
    }

    /**
     * 继承添加启动数据库操作
     * 启动数据库,并且赋值 _DBObj 
     * @memberof ZWBaseSrv
     */
    async startDB()
    {
        this._DBObj = null;
        logger.error('start your db at you subclass');
        throw new Error('please start db frist');
    }
    /**
     * 停止数据库
     *
     * @memberof ZWBaseSrv
     */
    stopDB()
    {
        logger.error('stop your db at you subclass');
    }

    /**
     * 启动redis连接
     *
     * @memberof ZWBaseSrv
     */
    async startRedis()
    {
        return new Promise( (resolve,reject) => {
            this._cache_redis_client = redis.createClient( this._cfg.redis_url );
            this._cache_redis_client.on('ready',()=>{
                if( !this._redis_connected )
                {
                    this._redis_connected = true;
                    resolve(true);
                }
            });
            this._cache_redis_client.on('error',(e)=>{
                if( !this._redis_connected && !this._redis_conn_err )
                {
                    this._redis_conn_err = e;
                    reject(e);
                }
            });
        });
    }
    stopRedis()
    {
        this._cache_redis_client.quit();
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
     * @memberof ZWBaseSrv
     */
    async job_runing()
    {

        setTimeout(()=>{this.job_runing()}, this._cfg.time_ms );
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
     * 服务器有错误,这里没有返回具体错误信息,可以自己修改
     * @param {*} err
     * @param {*} req
     * @param {*} res
     * @param {*} next
     * @memberof ZWBaseSrv
     */
    r_500(err,req,res,next)
    {
        logger.error( 'srv has error:' ,err);
        res.status(500).send('srv has error');
    }
}

module.exports = ZWBaseSrv;