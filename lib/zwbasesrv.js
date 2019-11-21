const   express     = require('express');
const   logger      = require('./zwlogger')

const   https       = require('https');
const   http        = require('http');

const   ZWRouter    = require('./zwrouter');

class ZWBaseSrv
{
    constructor()
    {
        this.httpsapp       = express();
        this.httpapp        = express();
        this._DBObj         = null;//持有的数据库对象
        logger.cfgFor4JS();

        //是否启用https
        this.needhttps      = true;
        this._cfg           = {
            domain:'127.0.0.1',
            resentry:'/public/',//访问资源文件的入口
            reslocal:'public',      //资源文件真正的目录
            httpport:80,
            httpsport:443
        };
        this.srvConfig();
    }
    
    /**
     * 继承修改服务配置
     * 
     * @returns {},配置map
     * @memberof ZWBaseSrv
     */
    srvConfig()
    {
        return this._cfg;
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
     * 内部方法,获取express对象
     * @returns
     * @memberof ZWBaseSrv
     */
    getApp()
    {
        if( this.needhttps ) return this.httpsapp;
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
        // parse application/json
        this.getApp().use(express.json({limit:5242880}));

        //处理xml 如果要处理 微信支付回调 需要这个
        this.getApp().use(express.raw({limit:5242880,type:'text/xml'}));

        this.getApp().use(logger.connectLogger());

        //公开文件,资源文件等等
        this.getApp().use( this._cfg.resentry ,express.static( this._cfg.reslocal ,
        {
            cacheControl:true,
            maxAge:(1000*3600*24)
        }));
    }

    /**
     * 配置路由
     * 
     * 继承添加路由配置 必须调用super
     * @param {[]} routers [ZWRouter]
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
        }

        //如果路由 走到这里,说明之前设置的路由全部都没有接住,,那么最后这3个处理下了,否则就失败了
        this.getApp().all('/',this.r_root);
        this.getApp().all('*',this.r_404);
        this.getApp().use(this.r_500);

    }

    createHttp()
    {
        http.createServer(this.httpapp).listen( this._cfg.httpport );
        if( this.needhttps )
        {
            //默认情况把所有http的流量都转到 https,自己实习一个跳转方法

            this.httpapp.all('*',(req,res,next) => {
                this.r_http_redirect(req,res,next);
            });

            https.createServer(this.getHttpsOptions(), this.httpsapp).listen( this._cfg.httpsport );
        }
        logger.log('start http srv ok');
    }
    
    /**
     * 继承修改,如果需要https,
     * http证书配置,
     * @returns opt{ key cert ca }
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
            this._DBObj = await this.startDB();

            this.createHttp();

            this.cfgExpress();

            this.cfgRouter();

            this.srvDidStarted();

            return Promise.resolve();
        }
        catch( error)
        {
            logger.error('start srv failed,',error);
            process.exit( 101 );
        }
    }

    /**
     * 处理完成之后必须调用super,
     * 服务启动成功之后
     */
    srvDidStarted()
    {

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
        res.status(404).send('srv has error');
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
    /**
     * 可继承修改
     * http直接重定向到哪儿
     * @param {*} req 
     * @param {*} res 
     * @param {*} next 
     */
    r_http_redirect(req,res,next)
    {
        logger.log('cfg your http redir');
        res.redirect( 'https://' + this._cfg.domain + '/' );
    }
}

module.exports = ZWBaseSrv;